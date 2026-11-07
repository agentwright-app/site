---
title: "Half-price Claude calls for work nobody waits for: the Message Batches API in a SaaS background job"
description: "When to move Claude calls from the request path to the Message Batches API at 50% of the standard price: which jobs fit, a Postgres table to track batches, a cron job that submits and collects results by custom_id, how to handle errored and expired requests, and how to meter batch usage per user."
date: 2026-12-07
slug: message-batches-claude-background-jobs
tags: [claude, postgres, typescript, cost]
---

<p class="lede">Some of the Claude calls in an AI SaaS have no user waiting for them: nightly summaries, tagging new documents, re-running evals, generating weekly reports. Sending those through the normal Messages API means paying full price for speed nobody needs. The Message Batches API runs the same requests asynchronously at half the price. This post shows which jobs fit, and a small Postgres-backed job that submits batches and collects the results.</p>

The API details below follow Anthropic's Message Batches documentation and the TypeScript SDK, checked on 2026-11-07.

## What the Batches API gives you

- **50% of the standard price** on input and output tokens, for every model.
- **The same request shape** as `messages.create`: system prompt, tools, images, documents, prompt caching.
- **Up to 100,000 requests or 256 MB per batch.**
- **Most batches finish within an hour; the limit is 24 hours.** Requests not done by then expire.
- **Results stay available for 29 days**, and come back in any order, keyed by a `custom_id` you choose.

The trade-off is latency: you do not know when a given request will finish, only that it will be within 24 hours or expire.

## Which jobs fit

A good rule: if the result is shown to a user later rather than right now, it can be a batch.

- **Good fits:** nightly or weekly digests, classifying or tagging new records, extracting fields from uploaded documents when the user is not watching, regenerating stored summaries after a prompt change, [eval](/blog/evals-for-claude-agents-typescript/) runs, backfills.
- **Poor fits:** chat, anything streamed, agent loops with tools you execute (each turn would wait up to a day), and anything with a deadline under 24 hours that you cannot miss.

Multi-turn tool use does not fit batches well, because every tool round trip would be a new batch. Batch single-shot calls: one prompt in, one answer out.

## A table to track batch work

Treat each request as a job row. The batch is just how rows travel.

```sql
CREATE TABLE llm_batch_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  kind         text NOT NULL,              -- 'weekly_digest', 'tag_document', ...
  params       jsonb NOT NULL,             -- the Messages API params
  status       text NOT NULL DEFAULT 'queued', -- queued, submitted, done, failed
  batch_id     text,                       -- msgbatch_... once submitted
  attempts     int NOT NULL DEFAULT 0,
  result       jsonb,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz
);

CREATE INDEX llm_batch_jobs_status_idx ON llm_batch_jobs (status);
```

The job's `id` becomes the `custom_id`. That is the only link between a result and the row that asked for it, so never rely on result order.

## Submitting queued jobs

A cron job (every 15 minutes is plenty) collects queued rows and sends them as one batch:

```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();

export async function submitQueued() {
  const jobs = await db.query(
    `SELECT id, params FROM llm_batch_jobs
     WHERE status = 'queued' ORDER BY created_at LIMIT 10000
     FOR UPDATE SKIP LOCKED`
  );
  if (jobs.rows.length === 0) return;

  const batch = await client.messages.batches.create({
    requests: jobs.rows.map((j) => ({ custom_id: j.id, params: j.params })),
  });

  await db.query(
    `UPDATE llm_batch_jobs
     SET status = 'submitted', batch_id = $1, attempts = attempts + 1
     WHERE id = ANY($2)`,
    [batch.id, jobs.rows.map((j) => j.id)]
  );
}
```

Run the select and update in one transaction. `FOR UPDATE SKIP LOCKED` keeps two overlapping cron runs from submitting the same rows, the same pattern as the [Postgres job queue post](/blog/background-agent-jobs-postgres-skip-locked/).

Store the full params when the job is queued, including the model id. If you change a prompt later, jobs already queued keep the version they were created with, which makes results easier to explain.

## Collecting results

A second cron job checks submitted batches and reads results once a batch has ended:

```ts
export async function collectResults() {
  const { rows } = await db.query(
    `SELECT DISTINCT batch_id FROM llm_batch_jobs WHERE status = 'submitted'`
  );

  for (const { batch_id } of rows) {
    const batch = await client.messages.batches.retrieve(batch_id);
    if (batch.processing_status !== "ended") continue;

    for await (const item of await client.messages.batches.results(batch_id)) {
      const jobId = item.custom_id;
      switch (item.result.type) {
        case "succeeded":
          await markDone(jobId, item.result.message);
          await recordUsage(jobId, item.result.message.usage, { batch: true });
          break;
        case "errored":
          await markFailedOrRetry(jobId, item.result.error);
          break;
        case "expired":
        case "canceled":
          await requeue(jobId);
          break;
      }
    }
  }
}
```

Three result types need different handling:

- **`errored` with an invalid request error:** the params are wrong. Retrying will fail the same way, so mark the job failed and log the error for yourself.
- **`errored` for other reasons** (server errors): requeue, with a cap on `attempts`.
- **`expired` or `canceled`:** the request never ran. Requeue it; nothing was billed for it.

Make `markDone` idempotent (`UPDATE ... WHERE id = $1 AND status = 'submitted'`) so a cron run that crashes halfway can read the same results again safely.

## Metering batch usage

Batch results carry the same `usage` object as a normal response. Record it in your [usage table](/blog/meter-claude-api-costs-per-user-nextjs/) like any other call, with one change: apply the batch price, half the standard rate. If you [snapshot prices on each usage row](/blog/snapshot-llm-prices-per-request/), store the discounted unit prices, or add a `batch` flag and apply the 0.5 factor when computing cost. Otherwise your per-user cost reports will show twice the real spend for batch work.

If batch jobs count against a user's [spend limit](/blog/per-user-spend-limits-in-dollars/), reserve the estimated cost when the job is queued, not when results arrive, or a user can queue far more work than their plan allows.

## What it saves

Take a weekly digest: 10,000 users, each digest about 6,000 input tokens and 800 output tokens on Claude Sonnet 5.5 ($2 input, $10 output per million tokens, prices checked 2026-11-07).

- Standard: 60M input tokens × $2 + 8M output tokens × $10 = $120 + $80 = **$200 a week**.
- Batch: **$100 a week**.

$400 a month back for moving one job to a cron. Check the numbers for your own case with the [cost calculator](/tools/claude-api-cost-calculator/).

## Things to watch

- **Show the delay in the product.** "Your report will be ready within a few hours" is fine; a spinner that runs for an hour is not.
- **Alert on stuck batches.** If a batch is still not `ended` after 25 hours, something is wrong in your collector, not at Anthropic.
- **Rate limits are separate.** Batches have their own limits from your normal requests, so a large batch does not slow down your chat traffic.
- **Keep a fallback.** If a user asks for a report now, run that one request through the normal API at full price.

## Summary

- Use the Batches API for single-shot work nobody waits for; it costs half the standard price.
- Track each request as a Postgres row whose id is the `custom_id`; never depend on result order.
- One cron submits queued rows with `SKIP LOCKED`, another collects ended batches.
- Fail invalid requests, retry server errors with a cap, requeue expired ones.
- Meter batch usage at the discounted price so per-user costs stay correct.

<!-- site-only -->

*Agentwright Starter records one usage row per model call with a price snapshot, which is where a batch flag fits. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's API documentation before publishing.*

<!-- /site-only -->
