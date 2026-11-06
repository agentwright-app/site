---
title: "Trace every Claude agent run in Postgres: the two tables that answer why it was slow, wrong or expensive"
description: "A lightweight tracing setup for an AI agent SaaS without an observability vendor: one row per agent run and one per step (model call or tool call) with timings, tokens, stop reasons, errors and the API request id, plus the SQL for p95 latency, slow tools and failing tools, and what not to log."
date: 2026-12-06
slug: trace-claude-agent-runs-postgres
tags: [postgres, claude, monitoring, typescript]
---

<p class="lede">A user writes "the assistant took a minute and then gave a wrong answer". To help, you need to know what happened in that run: which model calls it made, which tools it called, how long each took, what failed, and what it cost. Usage rows tell you the cost; they do not tell you the story. This post adds two small tables that do, so you can answer support questions and find slow or broken tools with SQL, before you decide whether you need a tracing product.</p>

The API details below (response headers, usage fields, stop reasons) follow Anthropic's API documentation and the TypeScript SDK, checked on 2026-11-06.

## Runs and steps

An agent **run** is one user message and everything the agent does to answer it. A run has **steps**: each call to the Claude API, and each tool call.

```sql
CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL,
  conversation_id uuid NOT NULL,
  route           text NOT NULL,                 -- 'chat', 'summarize', ...
  started_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  status          text NOT NULL DEFAULT 'running', -- 'ok', 'error', 'cancelled', 'limit'
  turns           int NOT NULL DEFAULT 0,
  cost_micro_usd  bigint NOT NULL DEFAULT 0,
  error           text
);

CREATE TABLE agent_steps (
  id            bigserial PRIMARY KEY,
  run_id        uuid NOT NULL REFERENCES agent_runs(id),
  seq           int NOT NULL,
  kind          text NOT NULL,                   -- 'model' or 'tool'
  name          text NOT NULL,                   -- model id or tool name
  started_at    timestamptz NOT NULL,
  duration_ms   int NOT NULL,
  ok            boolean NOT NULL,
  stop_reason   text,                            -- model steps
  input_tokens  int, output_tokens int, cache_read_tokens int,
  request_id    text,                            -- Anthropic request id, for support tickets
  error         text
);
CREATE INDEX ON agent_steps (run_id, seq);
CREATE INDEX ON agent_steps (kind, name, started_at);
CREATE INDEX ON agent_runs (user_id, started_at DESC);
```

This is deliberately boring. No spans of spans, no attributes JSON at first. You can add a `meta jsonb` column when you need something the columns don't hold.

## Recording a model step

Wrap the API call, time it, and keep the request id. Every API response carries a `request-id` header, and the TypeScript SDK exposes it on the returned message as `_request_id`. If you ever contact Anthropic support about a specific failure, that id is what they ask for.

```ts
async function tracedModelCall(run: Run, params: Anthropic.MessageCreateParams) {
  const started = new Date();
  try {
    const msg = await client.messages.create(params, { signal: run.signal });
    await step(run, {
      kind: "model", name: params.model, started, ok: true,
      stopReason: msg.stop_reason, requestId: msg._request_id ?? null,
      inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens,
      cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
    });
    return msg;
  } catch (err) {
    await step(run, {
      kind: "model", name: params.model, started, ok: false,
      requestId: err instanceof Anthropic.APIError ? (err.requestID ?? null) : null,
      error: errorSummary(err),
    });
    throw err;
  }
}
```

For streaming calls, take the same fields from the final message once the stream ends (and from the last events you saw if it was cancelled, as in the [Stop button post](/blog/cancel-claude-agent-runs-abortcontroller/)).

## Recording a tool step

```ts
async function tracedTool(run: Run, call: Anthropic.ToolUseBlock, ctx: Ctx) {
  const started = new Date();
  try {
    const out = await tools[call.name].run(call.input, ctx);
    await step(run, { kind: "tool", name: call.name, started, ok: true });
    return out;
  } catch (err) {
    await step(run, { kind: "tool", name: call.name, started, ok: false, error: errorSummary(err) });
    throw err;   // the loop turns it into an is_error tool_result
  }
}
```

`step()` computes `duration_ms` from `started` and inserts the row with the next `seq`. When the loop ends, update the run with `ended_at`, `status`, `turns` and the summed cost.

Writing a row per step adds a few milliseconds per step. If that matters, collect the steps in memory and insert them in one statement when the run ends, inside a `finally` block so failed runs are still recorded.

## What not to store here

Do **not** put prompts, tool inputs or tool outputs in these tables. They contain user data, sometimes secrets, and they are large. The conversation itself is already stored once, in your [append-only conversation tables](/blog/store-agent-conversations-append-only/); link to it by `conversation_id` and look it up there when you need the content, under the same access rules as the rest of the user's data.

`error` should be a short summary: the error class, HTTP status and message, cut to a few hundred characters. Not a full response body.

## The questions it answers

**What happened in this run?** The support question, answered in one query:

```sql
SELECT seq, kind, name, duration_ms, ok, stop_reason, input_tokens, output_tokens, request_id, error
FROM agent_steps WHERE run_id = $1 ORDER BY seq;
```

A run that took a minute usually shows one of three patterns: one slow tool (a web fetch with no timeout), many turns (the model kept searching), or a long model step with a large `input_tokens`, meaning the conversation has grown and needs [compaction](/blog/long-agent-conversations-compaction-context-editing/).

**How slow are we?** p50 and p95 run duration per route, last 7 days:

```sql
SELECT route,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY extract(epoch FROM ended_at - started_at)) AS p50_s,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM ended_at - started_at)) AS p95_s,
       count(*) AS runs
FROM agent_runs
WHERE started_at > now() - interval '7 days' AND ended_at IS NOT NULL
GROUP BY route ORDER BY p95_s DESC;
```

**Which tools are slow or failing?**

```sql
SELECT name, count(*) AS calls,
       round(100.0 * avg((NOT ok)::int), 1) AS error_pct,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
FROM agent_steps
WHERE kind = 'tool' AND started_at > now() - interval '7 days'
GROUP BY name ORDER BY error_pct DESC, p95_ms DESC;
```

A tool with a high error rate is often a description problem, not a code problem: the model keeps sending inputs the schema rejects. Look at a few failing runs before you change the code.

**How do runs end?** `SELECT status, count(*) FROM agent_runs WHERE started_at > now() - interval '7 days' GROUP BY 1;`. A rising share of `limit` means users are hitting turn or spend limits; a rising share of model steps with `stop_reason = 'max_tokens'` means your `max_tokens` is too low for what users ask (see [stop reasons](/blog/handle-claude-stop-reasons-agent/)).

## Keeping it small

Steps grow quickly: ten steps per run times thousands of runs a day. Delete steps older than 30 to 90 days with a nightly job, and keep `agent_runs` longer for trends. Your [usage rows](/blog/meter-claude-api-costs-per-user-nextjs/) remain the permanent record for billing, so tracing data can expire without losing money information.

## When to move to a tracing product

These tables are enough while one person looks at traces now and then. Consider OpenTelemetry and a hosted tracing tool when you need traces across several services, live dashboards for a team, or sampling at high volume. The run and step structure maps directly onto traces and spans, so the instrumentation points you added here stay the same.

## Summary

- One row per run, one per step (model call or tool call), with timing, tokens, stop reason, errors and the Anthropic request id.
- Wrap the model call and each tool call; record failures in the same way as successes.
- Don't store prompts or tool data in trace tables; link to the conversation instead.
- Use SQL for the run timeline, p95 per route, slow and failing tools, and how runs end.
- Expire old steps; keep runs and usage rows longer.

<!-- site-only -->

*Agentwright Starter's agent loop already records one usage row per model call and returns tool errors to the model, which are the two places to add these trace rows. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's API documentation before publishing.*

<!-- /site-only -->
