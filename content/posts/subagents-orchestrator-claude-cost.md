---
title: "Subagents in a Claude agent SaaS: when one agent should hand work to another, and what it costs"
description: "When splitting an agent into an orchestrator and subagents helps (large reading jobs, parallel research, isolated context) and when it only adds cost; how to build it as a tool that runs a second loop, pick a cheaper model for workers, cap their turns and output, and meter the whole tree per user."
date: 2026-12-28
slug: subagents-orchestrator-claude-cost
tags: [ai, architecture, typescript, llm]
---

<p class="lede">"Multi-agent" sounds like an upgrade. In practice, a second agent is a second loop with its own context and its own bill, and it is worth it only for certain jobs. This post explains when a subagent helps, how to build one as an ordinary tool in your existing loop, and the limits that keep a tree of agents from costing ten times one agent.</p>

## When a subagent helps

A subagent is a separate model loop that the main agent starts, gives a task to, and gets a short result back from. Three situations justify it:

1. **Big reading, small answer.** "Read these 30 support tickets and tell me the three most common complaints." Reading 30 tickets in the main conversation puts every ticket into its context for the rest of the conversation. A subagent reads them in its own context and returns a 200-token summary; the main conversation only ever sees the summary.
2. **Independent parallel work.** "Compare these four vendors' pricing pages." Four subagents can work at the same time, each with a clean context, and the main agent combines four short reports.
3. **A cheaper model for routine steps.** The main agent needs judgement; extracting fields from 50 documents does not. A worker on a smaller model does the routine part.

If none of these apply, one agent with good tools is simpler, cheaper and easier to debug. Most requests in most products are one-agent requests.

## When it hurts

- **Small tasks.** Each subagent has its own system prompt, tool definitions and at least one round trip. For a task one tool call could do, that overhead is pure cost and latency.
- **Tasks that need the whole conversation.** A subagent only knows what you put in its task. If the job depends on what the user said ten turns ago, the main agent must restate it, and often restates it badly.
- **Chains of agents passing work along.** Each hand-off loses detail. Prefer one orchestrator with workers that report back, never workers that start further workers.

## Build it as a tool

The simplest design needs no framework: a subagent is a tool whose `run` function starts a second loop and returns its final text.

```ts
defineTool({
  name: "delegate_research",
  description:
    "Hand a self-contained reading or research task to a helper that works in its own context " +
    "and returns a short report. Use it when the task needs reading a lot of material (many " +
    "documents, pages or records) and only the conclusion matters. Do not use it for tasks a " +
    "single tool call can do. The helper does not see this conversation: put everything it " +
    "needs in the task, including what the report should contain.",
  schema: z.object({
    task: z.string().max(4000),
    report_format: z.string().max(500).describe("What the report must contain, e.g. 'top 3 complaints with ticket ids'"),
  }),
  run: async ({ task, report_format }, ctx) => {
    const result = await runAgent({
      userId: ctx.userId,                      // metered to the same user
      parentRunId: ctx.runId,                  // linked in traces
      model: "claude-haiku-5-5",
      effort: "low",
      maxTurns: 8,
      maxTokens: 4000,
      system: WORKER_SYSTEM,                   // stable text, cached like the main prompt
      tools: workerTools(),                    // read-only tools only
      messages: [{ role: "user", content: `${task}\n\nReport format: ${report_format}\nKeep the report under 300 words.` }],
      signal: ctx.signal,                      // cancelling the parent cancels the worker
    });
    return finalText(result).slice(0, 4000);
  },
});
```

The important parts:

- **The worker goes through the same `runAgent`**, so it is metered, rate limited and capped like any other call. A subagent that calls the SDK directly would be an unmetered side door.
- **Read-only tools only.** Workers that can send email or write records multiply the places a [prompt injection](/blog/prompt-injection-defenses-agent-tools/) can do damage. Side effects stay with the main agent, behind its [approval gates](/blog/approval-gates-for-agent-tool-calls/).
- **Hard limits on turns, tokens and report length.** The main agent pays to read whatever the worker returns.
- **The parent's abort signal**, so a user who [cancels](/blog/cancel-claude-agent-runs-abortcontroller/) stops the whole tree.

Because the main loop runs [parallel tool calls](/blog/parallel-tool-calls-claude-agent-loop/) concurrently, the main agent can start four `delegate_research` calls in one turn and they run at the same time.

## What it costs

Take the 30-ticket example, about 45,000 tokens of tickets.

**Without a subagent**, on Claude Sonnet 5.5: the tickets enter the main conversation as a tool result. Writing them to cache costs 45,000 × $2.50/M ≈ $0.11, and each of, say, five later turns reads them from cache at $0.10/M, about $0.0045 each. Roughly **$0.13**, and the conversation is 45,000 tokens heavier for the rest of its life.

**With a Haiku 5.5 worker**: the worker reads the tickets at $0.10 per million input tokens (≈ $0.0045, plus a few cached re-reads across its turns) and writes a report of about 400 tokens. The main agent reads a 400-token result. Together roughly **$0.01**, and the main conversation stays small.

The saving comes from two places: the cheaper model for reading, and not carrying the raw material through the main conversation. When the task is small, neither applies and the subagent costs more than doing it inline. Measure both on real tasks with your [evals](/blog/evals-for-claude-agents-typescript/) before making delegation the default.

## Meter and trace the tree

Give every run a `run_id` and a `parent_run_id`. Then the cost of one user request is one query, however many workers it started:

```sql
WITH RECURSIVE tree AS (
  SELECT id FROM agent_runs WHERE id = $1
  UNION ALL
  SELECT r.id FROM agent_runs r JOIN tree t ON r.parent_run_id = t.id
)
SELECT count(*) AS runs, sum(u.cost_micro_usd) / 1e6 AS cost_usd
FROM tree JOIN usage_events u ON u.run_id = tree.id;
```

Show the tree in your [traces](/blog/trace-claude-agent-runs-postgres/) too: when an answer is wrong, the worker's report is often where it went wrong.

Also limit fan-out: a cap of four or five workers per turn and one level of depth (workers do not get the delegate tool) keeps a confused orchestrator from starting 40 workers.

## Hosted alternatives

If you would rather not run this yourself, Anthropic's Managed Agents (beta) can run multi-agent work on Anthropic's side, and the Claude Agent SDK supports subagents in its own harness. Both are reasonable; the tool-based design above has the advantage that everything goes through the metering and limits you already have.

## Summary

- Use subagents for big reading with small answers, independent parallel work, or routine steps on a cheaper model.
- Build a subagent as a tool that runs your existing loop, metered to the same user.
- Give workers read-only tools, low effort, hard turn and token limits, and a short report format.
- Link runs with a parent id so one query gives the cost of the whole tree; cap fan-out and depth.
- Measure against the single-agent version before making delegation the default.

<!-- site-only -->

*Agentwright Starter's agent loop is one `runAgent` function that meters every call to the signed-in user and runs a turn's tool calls in parallel; it has no subagent tool, and its tools do not receive the user id or run id that this post's worker needs. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
