---
title: "Run long Claude agent jobs in the background with a Postgres queue (FOR UPDATE SKIP LOCKED)"
description: "When an agent task is too long for a request, move it to a job table: a Postgres queue with SKIP LOCKED, leases that recover from crashed workers, retries that do not repeat tool calls, progress the UI can poll, and when the Batch API's half price is the better fit."
date: 2026-11-17
slug: background-agent-jobs-postgres-skip-locked
tags: [postgres, agents, typescript, architecture]
---

<p class="lede">Chat fits in a request: the user waits, the answer streams, done. "Research these 40 companies", "review this repository" or "draft replies to yesterday's tickets" does not. Those runs take minutes, can outlive a serverless function's time limit, and should survive a deploy. The usual answer is a job queue, and if you already run Postgres you do not need a new service for it. This post builds a small, correct queue for agent jobs.</p>

The SQL is plain Postgres (`FOR UPDATE SKIP LOCKED` has been available since 9.5). The worker is TypeScript.

## When to move a task out of the request

Move it to a job when any of these is true:

- It regularly takes longer than your platform's request timeout.
- The user does not need to watch it happen; a notification at the end is fine.
- It is triggered by a schedule or a webhook, not by a person.
- Losing it halfway (a deploy, a crash) would be expensive or confusing.

Keep it in the request when the user is reading the answer as it streams. A queue adds a polling or notification layer, and for chat that is pure latency.

## The table

```sql
CREATE TABLE agent_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,                       -- 'research', 'ticket_drafts', ...
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued',    -- queued | running | done | failed | cancelled
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  run_after timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  messages jsonb NOT NULL DEFAULT '[]',     -- the agent's conversation so far (checkpoint)
  progress text,                            -- short, human-readable: "Searched 12 of 40"
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX agent_jobs_ready_idx ON agent_jobs (run_after) WHERE status IN ('queued', 'running');
```

The `messages` column is what makes agent jobs different from ordinary background jobs. It holds the conversation after every completed turn, so a retry continues from there instead of starting over.

## Claiming a job: SKIP LOCKED plus a lease

Several workers can poll the same table. `FOR UPDATE SKIP LOCKED` makes each one take a different row without waiting on the others:

```sql
UPDATE agent_jobs SET
  status = 'running',
  attempts = attempts + 1,
  locked_until = now() + interval '10 minutes'
WHERE id = (
  SELECT id FROM agent_jobs
  WHERE run_after <= now()
    AND (status = 'queued' OR (status = 'running' AND locked_until < now()))
    AND attempts < max_attempts
  ORDER BY run_after
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```

The `locked_until` lease is the part tutorials often skip. If a worker crashes or is killed by a deploy, its job stays `running` forever without it. With a lease, the job becomes claimable again once the lease expires, and the next worker picks it up from the last checkpoint. A worker that is still alive extends its lease after each turn.

Jobs whose attempts ran out need a final status. A small periodic statement handles it:

```sql
UPDATE agent_jobs SET status = 'failed', finished_at = now(),
  error = coalesce(error, 'gave up after ' || attempts || ' attempts')
WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts;
```

## The worker

```ts
async function workOnce(): Promise<boolean> {
  const job = await claimJob();               // the UPDATE ... RETURNING above
  if (!job) return false;
  try {
    const messages = job.messages.length ? job.messages : initialMessages(job);
    const finalMessages = await runAgent({
      userId: job.user_id,
      system: SYSTEM_PROMPTS[job.kind],
      messages,
      onTurn: async (_msg, history) => {
        // Checkpoint + extend the lease after every completed turn.
        await db.execute(sql`
          UPDATE agent_jobs SET messages = ${JSON.stringify(history)}::jsonb,
            locked_until = now() + interval '10 minutes',
            progress = ${describeProgress(history)}
          WHERE id = ${job.id}`);
      },
    });
    await markDone(job.id, extractResult(finalMessages));
  } catch (e) {
    await scheduleRetry(job, e);
  }
  return true;
}

// Poll with a short sleep when the queue is empty.
while (!shuttingDown) {
  if (!(await workOnce())) await sleep(2000);
}
```

The `onTurn` callback here receives the history so far; adapt it to your loop. The rule is the same as in a request: **append to history only after a turn completes, and never re-run a tool call inside a retry.** Our post on [Claude API errors in an agent loop](/blog/claude-api-errors-retries-agent-loop/) explains why, and why the `tool_use` id makes a good idempotency key for tools that write somewhere.

## Retries with backoff, and errors you should not retry

```ts
async function scheduleRetry(job: Job, e: unknown) {
  const permanent =
    e instanceof Anthropic.BadRequestError ||
    e instanceof Anthropic.AuthenticationError ||
    (e as any)?.code === "CAP_REACHED";
  const delaySeconds = Math.min(60 * 2 ** job.attempts, 3600);
  await db.execute(sql`
    UPDATE agent_jobs SET
      status = ${permanent ? "failed" : "queued"},
      run_after = now() + make_interval(secs => ${delaySeconds}),
      locked_until = NULL,
      error = ${String((e as Error).message ?? e).slice(0, 1000)},
      finished_at = ${permanent ? sql`now()` : null}
    WHERE id = ${job.id}`);
}
```

A 400 or a budget limit will fail the same way every time, so retrying it only wastes a slot. Rate limits and overloads are worth waiting for, which is what the exponential backoff is for.

## Limits per user

A queue removes the natural limit a request had: one user can enqueue a thousand jobs. Add two rules at enqueue time: a maximum number of queued or running jobs per user (by plan), and a budget check on the expected cost. If you price by usage, check the same dollar budget you use for chat (see [per-user spend limits in dollars](/blog/per-user-spend-limits-in-dollars/)), and check it again before every turn inside the job.

For fairness between users, order by `run_after` but skip users who already have a running job, or give each user a small concurrency limit. Otherwise one large customer can fill every worker.

## Progress the UI can show

Write a short `progress` string at every checkpoint and let the UI poll `GET /api/jobs/:id` every few seconds. Polling is boring and reliable; you can switch to server-sent events or a notification later. When the job finishes, send an email or an in-app notification. Long jobs are fire-and-forget for the user, so the end is the moment they come back.

Cancellation is a status: set `status = 'cancelled'`, and have the worker check it at each checkpoint and stop.

## When the Batch API is the better fit

If the job is many *independent* requests, not one agent conversation (classify 5,000 tickets, summarise every document in an account), the Message Batches API is often better than your own queue:

- It costs **half** the normal price.
- You submit up to thousands of requests at once and collect results later; most batches finish well within the 24-hour window.
- Results come back in any order, keyed by the `custom_id` you set on each request, so store them by that id.

The Batch API does not run your tools between turns, so it suits single-shot requests, not multi-turn agents. A common combination is both: your Postgres queue holds the job, and the job's worker submits one batch and polls it until `processing_status` is `ended`.

## Summary

- Move long, unattended agent work to a job table; keep chat in the request.
- Claim jobs with `FOR UPDATE SKIP LOCKED` and a `locked_until` lease so crashed workers do not strand jobs.
- Checkpoint the conversation after every turn; retries continue, they do not restart.
- Do not retry 400s and budget errors; back off on 429 and 5xx.
- Limit queued jobs per user, show progress, and use the Batch API for large sets of independent requests.

<!-- site-only -->

*Agentwright Starter does not include a job queue; its agent loop already returns the full history and reports each turn through a callback, which is what a worker like this one builds on. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the PostgreSQL documentation and Anthropic's Message Batches documentation before publishing.*

<!-- /site-only -->
