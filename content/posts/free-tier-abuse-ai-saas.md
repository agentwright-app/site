---
title: "A free tier for an AI SaaS without paying for abuse: caps, signup checks and the numbers"
description: "How to offer a free plan on a Claude-based product without it becoming free model access for scripts: size the free cap in dollars, use the cheapest model that converts, require a verified sign-in, limit accounts per person and per IP, detect duplicate signups, and watch free-tier cost weekly."
date: 2026-12-21
slug: free-tier-abuse-ai-saas
tags: [saas, ai, postgres, security]
---

<p class="lede">A free plan is how most people will try your product, and for an AI product every free request has a real cost. Without limits, the free tier gets found by people who want free model access, not your product: one script, fifty email addresses, and your monthly API bill. This post sizes a free tier in dollars and adds the few checks that stop most abuse without annoying real users.</p>

## Start with a number: free cost per signup

Decide what one free user may cost you per month, then derive everything else from it. For example:

- You are willing to spend **$0.30 per free user per month**.
- Your free route uses Claude Haiku 5.5 ($0.10 per million input tokens, $0.50 output).
- A typical request is 6,000 input tokens (mostly cached system prompt and tools) and 600 output tokens.

Without caching that request costs 6,000 × $0.10/M + 600 × $0.50/M = $0.0006 + $0.0003 = $0.0009. With most of the prefix cached it is lower still. So $0.30 buys roughly 300 requests a month, which is a generous trial. On Claude Sonnet 5.5 ($2 / $10) the same request is about $0.018, and $0.30 buys about 16 requests.

That comparison is the first decision: does the free plan need the same model as paid plans? Often a free plan on Haiku 5.5 shows the product well enough, and paid plans unlock the larger model. Test it with your [evals](/blog/evals-for-claude-agents-typescript/) on the free route's typical tasks before deciding. [Choosing a model per route](/blog/choose-claude-model-per-route/) makes this a configuration change.

## Cap in dollars, not only in requests

A request cap is easy to explain ("50 messages a month"), but one request can cost 100 times another: a long conversation, a big file, many tool calls. Keep both:

- A visible cap users understand (messages per day or month).
- A hidden dollar ceiling per free user per month, from the [spend limits post](/blog/per-user-spend-limits-in-dollars/), set a bit above the expected cost.
- Tighter turn and `max_tokens` limits on free routes, so a single request cannot run 30 tool turns.

When a free user hits the ceiling, the message says what happened and what upgrading gives them. That is the moment free users convert, so make it a good page, not an error.

## Make accounts cost something to create

Most free-tier abuse is many accounts. Each account must take a little real effort:

1. **Verified sign-in.** GitHub OAuth or a [magic link](/blog/magic-link-sign-in-authjs-resend/) proves an inbox or an account. No password signups with unverified email.
2. **Block disposable email domains.** Public lists of throwaway domains exist; check the signup domain against one, and refresh the list monthly.
3. **Normalise addresses.** `jane+1@gmail.com`, `j.ane@gmail.com` and `jane@gmail.com` are one Gmail inbox. Store a normalised form and allow one free account per normalised address.
4. **Limit signups per IP.** A handful of new free accounts per IP per day is plenty for an office; fifty is a script. Count them in Postgres like any other [rate limit](/blog/rate-limit-llm-endpoints-postgres/).

```ts
export function normaliseEmail(email: string) {
  const [local, domain] = email.trim().toLowerCase().split("@");
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.split("+")[0].replaceAll(".", "")}@gmail.com`;
  }
  return `${local.split("+")[0]}@${domain}`;
}
```

Plus-addressing rules differ between providers; stripping `+tag` is a reasonable default for a free-tier check, as long as you send email to the address the user typed.

## Watch the free tier as one number

Once a week, look at one query: what did free users cost, and how is it spread?

```sql
SELECT count(DISTINCT u.user_id)                              AS free_users,
       round(sum(u.cost_micro_usd) / 1e6, 2)                 AS free_cost_usd,
       round(sum(u.cost_micro_usd) / 1e6 / NULLIF(count(DISTINCT u.user_id), 0), 4) AS per_user_usd,
       round(max(per.cost) / 1e6, 2)                         AS top_user_usd
FROM usage_events u
JOIN users s ON s.id = u.user_id AND s.plan = 'free'
JOIN LATERAL (
  SELECT sum(cost_micro_usd) AS cost FROM usage_events WHERE user_id = u.user_id
    AND created_at > now() - interval '7 days'
) per ON true
WHERE u.created_at > now() - interval '7 days';
```

Healthy: cost per free user near your target, top user a small multiple of the median. Not healthy: a few users with costs many times the rest, or many new accounts from one IP range. The [most expensive users query](/blog/find-most-expensive-users-sql/) and the [anomaly alerts](/blog/spend-anomaly-alerts-llm-costs-sql/) turn this into an alert instead of a weekly chore.

## Things that are usually not worth it on day one

- **Credit card for a free trial.** It stops abuse almost completely and also most signups. Consider it only if abuse costs more than the lost signups.
- **Phone verification.** Costs money per SMS, excludes some countries, and is easy to buy around.
- **Device fingerprinting.** Complex, privacy-sensitive, and easy to get wrong. Rate limits and email checks come first.

## When you find abuse

Block the accounts with one switch (a `blocked_at` column, as in the [kill switches post](/blog/kill-switches-ai-agent-models-tools/)), keep their rows for your records, and tighten the check that let them in. Do not announce new limits on the free plan to everyone because of five accounts.

## Summary

- Set a target cost per free user per month and size caps from it.
- Consider a cheaper model for the free route; measure with evals first.
- Cap visible requests and a hidden dollar ceiling, with tighter turn limits.
- Verified sign-in, disposable domain block, normalised email, signups per IP.
- Review free-tier cost weekly as one number, and alert on outliers.

<!-- site-only -->

*Agentwright Starter seeds a free plan next to paid plans, signs users in with GitHub or a magic link, and checks a per-user rate limit and monthly token cap before every agent request. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
