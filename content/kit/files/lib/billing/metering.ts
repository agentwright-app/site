import { db } from "@/lib/db";
import { modelPrices, usageEvents, users, plans } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { costFromPrice, selectPrice, type PriceRow, type Usage } from "./pricing";

export { costMicroUsd, costFromPrice, selectPrice, BUILTIN_PRICES, PRICE_PER_MTOK } from "./pricing";
export type { Usage, PriceRow } from "./pricing";

/**
 * The price table changes a few times a year, so it is read once and kept in memory
 * for PRICE_CACHE_MS instead of being queried on every request. Rows inserted with a
 * future `effective_from` take effect on their date without a restart, because the
 * selection happens per request against the cached rows.
 */
const PRICE_CACHE_MS = 60_000;
let priceCache: { rows: PriceRow[]; loadedAt: number } | undefined;

async function loadPrices(): Promise<PriceRow[]> {
  if (priceCache && Date.now() - priceCache.loadedAt < PRICE_CACHE_MS) return priceCache.rows;
  const rows = await db.select().from(modelPrices);
  priceCache = { rows, loadedAt: Date.now() };
  return rows;
}

/** Drop the in-memory price table, e.g. after inserting a price row in the same process. */
export function invalidatePriceCache() {
  priceCache = undefined;
}

export class MissingPriceError extends Error {
  readonly code = "MISSING_PRICE";
  constructor(model: string, at: Date) {
    super(
      `No model_prices row for ${model} at ${at.toISOString()}. Add one (see docs/pricing.md) or run \`npm run db:seed\`.`,
    );
  }
}

/** The `model_prices` row in effect for this model, request size and time. Throws MissingPriceError. */
export async function currentPrice(model: string, u: Usage = { input: 0, output: 0 }, at = new Date()): Promise<PriceRow> {
  const price = selectPrice(await loadPrices(), model, u, at);
  if (!price) throw new MissingPriceError(model, at);
  return price;
}

/**
 * Fails before the API call when the model has no price, so a request is never made
 * that could not be recorded. `runAgent` calls this once per run.
 */
export async function assertPriced(model: string): Promise<void> {
  await currentPrice(model);
}

/**
 * Records one API response: raw token counts, the cost computed now, and the id of
 * the price row used. Totals are sums of `cost_micro_usd`, so later price changes
 * never rewrite history; `price_id` explains every individual charge.
 */
export async function recordUsage(userId: string, model: string, u: Usage, at = new Date()) {
  const price = await currentPrice(model, u, at);
  const costMicroUsd = costFromPrice(price, u);
  await db.insert(usageEvents).values({
    userId,
    model,
    inputTokens: u.input,
    outputTokens: u.output,
    cacheReadTokens: u.cacheRead ?? 0,
    cacheWriteTokens: u.cacheWrite ?? 0,
    costMicroUsd,
    priceId: price.id,
    createdAt: at,
  });
  return { priceId: price.id, costMicroUsd };
}

/** Thrown by `assertWithinCap` when the user or their plan row is not in the database. */
export class MeteringSetupError extends Error {
  constructor(
    readonly code: "NO_USER" | "NO_PLAN",
    message: string,
  ) {
    super(message);
  }
}

/**
 * Throws `CAP_REACHED` when the user's plan has no overage and the user has already
 * used `plans.monthly_token_cap` tokens this month. What it counts:
 *
 * - input + output tokens from `usage_events`, since 00:00 UTC on the 1st of the
 *   current UTC month. Cache read and cache write tokens are not counted (they are
 *   still charged in `cost_micro_usd`).
 * - `runAgent` calls it before each model turn, with the usage recorded so far. A
 *   turn that starts under the cap is not stopped, so a single turn (and the tokens
 *   of turns already running in parallel requests) can take the total past the cap.
 *   The next turn is then refused.
 *
 * Throws `NO_USER` when `userId` is not in `users`, and `NO_PLAN` when the user's
 * `plan` has no row in `plans` (usually because `npm run db:seed` has not been run).
 */
export async function assertWithinCap(userId: string): Promise<void> {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [user] = await db.select({ plan: users.plan }).from(users).where(eq(users.id, userId));
  if (!user) {
    throw new MeteringSetupError("NO_USER", `User ${userId} not found in the users table, so the plan cap cannot be checked.`);
  }
  const [plan] = await db.select().from(plans).where(eq(plans.id, user.plan));
  if (!plan) {
    throw new MeteringSetupError(
      "NO_PLAN",
      `Plan "${user.plan}" (user ${userId}) has no row in the plans table. Run \`npm run db:seed\` to create the default plans, or insert a row for "${user.plan}".`,
    );
  }
  const [{ used }] = await db
    .select({ used: sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)` })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, monthStart)));

  if (Number(used) >= plan.monthlyTokenCap && !plan.overageAllowed) {
    const err = new Error("Monthly token cap reached. Upgrade your plan to continue.");
    (err as any).code = "CAP_REACHED";
    throw err;
  }
}
