# Model prices and price snapshots

Every `usage_events` row stores three things about a request:

| Column | Why |
|---|---|
| raw token counts (input, output, cache read, cache write) | The facts. They never change, so you can re-price on purpose. |
| `cost_micro_usd`, computed when the request happens | The number you bill and cap on. Monthly totals are sums of it, so they never move. |
| `price_id` → `model_prices.id` | Which rates produced that cost, so every charge can be explained. |

Rows recorded before 0.4.0 have `price_id = NULL` (prices were not versioned then). Their
stored cost is still correct for totals; `/usage` lists them as "before price snapshots".

## The price table

`model_prices` holds one row per model, price tier and effective date. Rates are
integers in micro-USD per million tokens (`$2/MTok = 2_000_000`), so all cost math is
integer math. A row is never edited once usage points at it.

```
id                                 model              min_prompt_tokens  effective_from
claude-fable-5-2@2026-11-11        claude-fable-5-2   0                  2026-11-11
claude-fable-5-1@2026-11-01        claude-fable-5-1   0                  2026-11-01
claude-opus-5-5@2026-11-01         claude-opus-5-5    0                  2026-11-01
claude-sonnet-5-5@2026-11-01       claude-sonnet-5-5  0                  2026-11-01
claude-haiku-5-5@2026-11-01        claude-haiku-5-5   0                  2026-11-01
claude-haiku-5-5@2026-11-01+long   claude-haiku-5-5   100001             2026-11-01
```

`recordUsage` picks the row with the latest `effective_from` that is not in the future,
and within that date the highest `min_prompt_tokens` the request reaches (prompt size =
input + cache read + cache write tokens). That is how Haiku 5.5 prompts over 100,000
tokens get their higher price.

Rates per million tokens in the built-in catalog (cache write = 5-minute tier):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| `claude-fable-5-2` | $8 | $40 | $0.20 | $10 |
| `claude-fable-5-1` | $10 | $50 | $0.25 | $12.50 |
| `claude-opus-5-5` | $4 | $20 | $0.20 | $5 |
| `claude-sonnet-5-5` | $2 | $10 | $0.10 | $2.50 |
| `claude-haiku-5-5` (prompt up to 100,000 tokens) | $0.10 | $0.50 | $0.01 | $0.125 |
| `claude-haiku-5-5` (prompt over 100,000 tokens) | $0.50 | $2.50 | $0.05 | $0.625 |

The catalog lives in `BUILTIN_PRICES` in `lib/billing/pricing.ts`. Migration
`0002_price_snapshots` inserts the rows that existed in 0.4.0, and `npm run db:seed`
inserts any rows that are missing, such as `claude-fable-5-2` (added in 0.4.2). It never
overwrites an existing id and warns if the code and the database disagree. The eval
runner prices against `BUILTIN_PRICES` directly, without a database.

The app reads the table once a minute per process, not once per request. A model
without a price row fails before the API call (`MISSING_PRICE`), so no request is ever
made that could not be recorded.

Cache write rates are the 5-minute tier. If you use 1-hour cache writes, batch, fast
mode or US-only inference (`inference_geo`), add your own rows or tiers for those rates.

## Changing a price

Add a row with a later `effective_from`, for every tier of that model, and touch
nothing else. Either add it to `BUILTIN_PRICES` and run `npm run db:seed`, or insert it
directly:

```sql
insert into model_prices
  (id, model, min_prompt_tokens, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, effective_from, source)
values
  ('claude-sonnet-5-5@2027-01-15', 'claude-sonnet-5-5', 0, 1500000, 7500000, 75000, 1875000,
   '2027-01-15 00:00:00', 'pricing page, checked 2027-01-15');
```

(Hypothetical numbers.) Requests before January 15 keep their old cost and old
`price_id`; requests after use the new row. You can insert the row in advance when a
change is announced and it takes effect on its date by itself, within a minute.

## Re-pricing on purpose

If a price row was wrong, fix history with an explicit, reviewable migration. Insert a
corrected row, then:

```sql
begin;
-- totals before
select user_id, sum(cost_micro_usd) from usage_events where price_id = 'claude-sonnet-5-5@2026-11-01' group by 1;

update usage_events u
set cost_micro_usd = round((
      u.input_tokens        * p.input_per_mtok
    + u.output_tokens       * p.output_per_mtok
    + u.cache_read_tokens   * p.cache_read_per_mtok
    + u.cache_write_tokens  * p.cache_write_per_mtok
  ) / 1e6),
  price_id = p.id
from model_prices p
where u.price_id = 'claude-sonnet-5-5@2026-11-01'
  and p.id = 'claude-sonnet-5-5@2026-11-01-fixed';

-- totals after; compare, then commit or rollback
commit;
```

If invoices were already sent, keep the original rows and record an adjustment
instead, so your records match what customers paid.

## Check against your real bill

Once a month, compare `sum(cost_micro_usd)` for all users with the cost in the Claude
Console for the same period. A small gap is normal (rounding, failed requests, your own
test traffic). A large gap usually means a missing cache column, a model without a
row, or an out-of-date price.

Official prices: https://platform.claude.com/docs/en/about-claude/pricing
