---
title: "Postgres row-level security for a multi-tenant AI agent SaaS: a second lock behind your WHERE clauses"
description: "How to add Postgres row-level security to a Next.js agent app so one user's conversations, usage and files can never leak to another, even when a query or an agent tool forgets its WHERE user_id = ...: policies, a non-owner app role, set_config inside a transaction, connection poolers, and what to test."
date: 2026-11-29
slug: postgres-row-level-security-multi-tenant-agent-saas
tags: [postgres, security, saas, typescript]
---

<p class="lede">Every multi-tenant app filters by user: <code>WHERE user_id = $1</code> on every query. That works until one query forgets it. In an agent app the risk is higher than usual, because some queries are written by tools the model chooses to call, with arguments the model chooses. Postgres row-level security (RLS) adds a second lock: even a query with no filter only sees the current user's rows. This post sets it up for a typical Next.js + Postgres agent SaaS.</p>

The behaviour below follows the PostgreSQL documentation for row security policies, checked on 2026-11-06. It applies to Postgres 15 and later, including Neon.

## What RLS does, in one paragraph

You enable RLS on a table and write a policy, a boolean expression Postgres adds to every query on that table. With a policy `user_id = current_setting('app.user_id')::uuid`, a `SELECT * FROM conversations` returns only the current user's conversations, an `UPDATE` cannot touch anyone else's rows, and an `INSERT` with someone else's `user_id` fails. Your application code does not change; the database enforces it.

## Step 1: a role that RLS applies to

RLS is skipped for superusers, for roles with `BYPASSRLS`, and for the table's owner. The role that runs your migrations usually owns the tables, so if the app connects as that same role, your policies do nothing. Create a separate role for the app:

```sql
CREATE ROLE app_user LOGIN PASSWORD '...';            -- no BYPASSRLS, not superuser
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

Use the owner role's connection string only for migrations, and `app_user`'s in the running app. As an extra guard, `ALTER TABLE ... FORCE ROW LEVEL SECURITY` makes the policies apply to the owner as well (superusers still bypass).

## Step 2: enable RLS and write the policies

Start with the tables that hold user data: conversations, messages, usage rows, uploaded files, API keys.

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

CREATE POLICY own_rows ON conversations
  USING      (user_id = current_setting('app.user_id', true)::uuid)
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
```

- `USING` filters the rows a query can see, update or delete.
- `WITH CHECK` validates new and updated rows, so nobody can insert or move a row into another user's account.
- The `true` in `current_setting('app.user_id', true)` returns `NULL` instead of an error when the setting is missing. `user_id = NULL` is never true, so a connection that forgot to set the user sees **no rows**, which is the safe failure.

Child tables like `messages` can carry their own `user_id` column (simplest, and fast to filter) or use a policy with a subquery on the parent. A copied `user_id` column is easier to index and to reason about; we recommend it.

Once RLS is enabled on a table, a role with no matching policy sees nothing. That is why enabling it is safe to roll out table by table: a mistake shows up as missing data in testing, not as leaked data in production.

## Step 3: set the user per transaction

Each request has to tell Postgres who the user is. Use `set_config` with its third argument `true`, which scopes the value to the current transaction:

```ts
export async function asUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

// in a route handler
const session = await requireUser();
const rows = await asUser(session.userId, (tx) =>
  tx.select().from(conversations).orderBy(desc(conversations.updatedAt)).limit(20),
);
```

The transaction scope is the important part. Serverless apps connect through a pooler (Neon's pooled connection string runs PgBouncer in transaction mode), so two requests can share one server connection. A plain `SET app.user_id` would stay on that connection and could leak into the next request. A transaction-local setting ends with the transaction, which is exactly the unit a transaction-mode pooler hands out. Pass `userId` as a bound parameter, as above, never by string concatenation.

Take `userId` from the authenticated session only. Never from the request body, and never from anything the model produced.

## Step 4: agent tools run inside the same scope

This is where RLS pays for itself in an agent app. Run every tool that touches the database inside `asUser`, with the user from the session that started the agent run:

```ts
async function runTool(call: Anthropic.ToolUseBlock, ctx: Ctx) {
  return asUser(ctx.userId, (tx) => tools[call.name].run(call.input, { ...ctx, tx }));
}
```

Now a tool like `search_notes` that builds a query from the model's input can at worst return the wrong rows **of this user**. If a prompt injection convinces the model to ask for "all notes, including other accounts", the database answers with this user's notes. Keep the input checks and narrow tool designs from the [prompt injection post](/blog/prompt-injection-defenses-agent-tools/); RLS is the layer that still holds when those miss something.

Background jobs need the same treatment. A [job worker](/blog/background-agent-jobs-postgres-skip-locked/) claims a job with an admin connection, then runs the agent's work with `asUser(job.userId, ...)`.

## Step 5: the places that need to see everything

Some code legitimately reads across users: the admin page, the nightly cost report, [finding your most expensive users](/blog/find-most-expensive-users-sql/), webhook handlers that look up a user by a customer ID. Give these a separate connection with a role that has `BYPASSRLS`, and keep its use small and named:

```ts
export const adminDb = drizzle(process.env.DATABASE_URL_ADMIN!);   // BYPASSRLS role, server-only
```

Grep for `adminDb` in code review. If it appears in an agent tool, that is a bug.

## Performance

A policy is a filter Postgres adds to the query, so the usual index on `user_id` makes it cheap. Two details:

- Cast once and compare to an indexed column, as in the policy above. `current_setting(...)` is evaluated once per query, not per row.
- Composite indexes that start with `user_id`, such as `(user_id, updated_at DESC)`, serve both the policy and the common "latest conversations" query.

## Test it

Write two tests per table and keep them in CI:

```ts
test("user B cannot read user A's conversations", async () => {
  const a = await createUser(); const b = await createUser();
  await asUser(a.id, (tx) => tx.insert(conversations).values({ userId: a.id, title: "secret" }));
  const seen = await asUser(b.id, (tx) => tx.select().from(conversations));
  expect(seen).toHaveLength(0);
});

test("user B cannot insert rows for user A", async () => {
  const a = await createUser(); const b = await createUser();
  await expect(asUser(b.id, (tx) => tx.insert(conversations).values({ userId: a.id, title: "x" })))
    .rejects.toThrow(/row-level security/);
});
```

Run the tests as `app_user`, not as the owner, or they pass for the wrong reason. A third useful test: query with no user set and expect zero rows.

## Summary

- RLS makes Postgres add `user_id = current user` to every query, so one forgotten filter or one manipulated tool call cannot leak another user's data.
- Connect the app as a role that is not the table owner and has no `BYPASSRLS`; add `FORCE ROW LEVEL SECURITY`.
- Write `USING` and `WITH CHECK` policies on `current_setting('app.user_id', true)`; a missing setting returns no rows.
- Set the user with `set_config(..., true)` inside a transaction, which is safe behind a transaction-mode pooler.
- Run agent tools and background jobs inside that scope; keep a small, named admin connection for cross-user work.
- Test cross-user reads and writes as the app role.

<!-- site-only -->

*Agentwright Starter stores conversations and usage rows with a `user_id` in Postgres and passes the signed-in user into the agent loop, so the policies above can be added table by table. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the PostgreSQL documentation before publishing.*

<!-- /site-only -->
