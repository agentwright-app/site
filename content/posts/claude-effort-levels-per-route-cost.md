---
title: "Claude effort levels in an agent SaaS: set them per route and measure cost per finished task"
description: "What the effort parameter does on current Claude models, the defaults that differ between Opus 5.5, Sonnet 5.5 and Haiku 5.5, why thinking tokens are output tokens, how to pick a level per route with a small eval, and how to meter the result."
date: 2026-12-25
slug: claude-effort-levels-per-route-cost
tags: [ai, llm, typescript, performance]
---

<p class="lede">On current Claude models you no longer set a thinking budget in tokens. You set an effort level, and the model decides how much to think. That one parameter moves both quality and cost more than most prompt changes, and its default is not the same on every model. This post explains what effort does, what the defaults are, and a simple way to choose a level for each route of your product.</p>

## What effort controls

`effort` sits in `output_config` and takes `low`, `medium`, `high`, `xhigh` or `max`:

```ts
const response = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 16000,
  output_config: { effort: "medium" },
  messages,
  tools,
});
```

Higher effort means more thinking before answering, more careful tool use and usually more thorough answers. Lower effort means fewer and more consolidated tool calls, less preamble and shorter confirmations. Thinking itself is adaptive: you do not give it a token budget, the model decides per request. The old `thinking: { type: "enabled", budget_tokens: N }` form is rejected with a 400 on the Claude 5 generation, so effort is the dial.

## The defaults differ, so set it explicitly

If you leave `effort` out, you get the model's default, and they are not the same:

- **Claude Opus 5.5:** default `medium`. Thinking cannot be turned off; lower effort is the way to make it lighter.
- **Claude Sonnet 5.5:** default `high`.
- **Claude Haiku 5.5:** default `medium`.

That means switching a route from Sonnet 5.5 to Opus 5.5 also quietly lowers effort from `high` to `medium`, and switching back raises it. If you change models with a [kill switch](/blog/kill-switches-ai-agent-models-tools/) or [per route](/blog/choose-claude-model-per-route/), store effort next to the model so the pair moves together:

```ts
const ROUTES = {
  chat:      { model: "claude-sonnet-5-5", effort: "low" },
  agentTask: { model: "claude-sonnet-5-5", effort: "medium" },
  hardTask:  { model: "claude-opus-5-5",   effort: "high" },
  title:     { model: "claude-haiku-5-5",  effort: "low" },
} as const;
```

## Thinking tokens are output tokens

Thinking is billed as output, at the output price, even when you do not display it (on current models the thinking text is omitted from the response by default, but the tokens are still counted). On Claude Sonnet 5.5, output costs $10 per million tokens, five times the input price. A task that writes a 400-token answer after 3,000 tokens of thinking pays for 3,400 output tokens:

- `low` effort, say 300 thinking + 400 answer: 700 × $10/M = **$0.007**
- `high` effort, say 3,000 thinking + 400 answer: 3,400 × $10/M = **$0.034**

These are illustrative numbers, not measurements; the real split depends on your tasks, which is the point of measuring. They do show why effort belongs in your margin calculation: on short answers, thinking can be most of the output bill. Thinking tokens count toward `max_tokens` too, so a high effort level with a small `max_tokens` can end in `stop_reason: "max_tokens"` before the answer is complete. Give high-effort routes room, and stream them.

## Choose per route with a small eval

Do not pick one effort level for the whole product. Chat replies, short classifications and simple lookups often do as well at `low`. Multi-step tool work and anything with code or numbers often needs `medium` or `high`. The way to know is a small sweep on each route:

1. Take 20 to 50 real tasks from the route (from your [traces](/blog/trace-claude-agent-runs-postgres/)), with a pass/fail check for each, as in the [evals post](/blog/evals-for-claude-agents-typescript/).
2. Run them at `low`, `medium` and `high`. Record pass rate, total cost (input + output, from `usage`) and time.
3. Compute **cost per passed task**: total cost divided by passed tasks.

| effort | pass rate | cost / task | cost / passed task |
|---|---|---|---|
| low | 82% | $0.011 | $0.0134 |
| medium | 94% | $0.016 | $0.0170 |
| high | 95% | $0.031 | $0.0326 |

(An example table to show the method, not our results.) Here `medium` is the choice: a big quality step from `low`, and `high` adds a point for twice the cost. A cheap level that fails more often is not cheaper once the user retries or a human has to fix the result, which is why the measure is cost per passed task, not per request.

Before building a cascade of models, try the stronger model at a lower effort. Lower effort on a newer model often matches a higher effort on an older or smaller one, and one model means one prompt cache.

## Changing effort mid-conversation

Effort is part of the request, so you can change it between turns. Be aware that changing the top-level `effort` in the middle of a conversation invalidates the cached messages; if you switch often, look at the per-message effort option (beta) on current models, which avoids the cache reset. For most products, one effort per route is simpler and enough.

## Meter it

Record `effort` on each usage row next to the model. When cost per user moves, you can then tell whether it was traffic, a model change or an effort change, instead of guessing. Your [per-user metering](/blog/meter-claude-api-costs-per-user-nextjs/) already has the token counts; output tokens there include thinking.

## Summary

- Effort (`low` to `max`) replaces thinking budgets on current models; set it in `output_config`.
- Defaults differ: Opus 5.5 `medium`, Sonnet 5.5 `high`, Haiku 5.5 `medium`. Set it explicitly and store it with the model.
- Thinking tokens are billed as output and count toward `max_tokens`.
- Pick a level per route by cost per passed task on a small eval.
- Record effort on usage rows so cost changes are explainable.

<!-- site-only -->

*Agentwright Starter does not set an effort level yet: its loop sends the model from `AGENT_MODEL` with the model's default effort, and records input and output tokens per call, so an effort setting per route is a small change to `lib/agent/loop.ts`. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
