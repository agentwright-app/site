---
title: "Haiku, Sonnet or Opus? Choosing a Claude model per route in an AI SaaS"
description: "A practical way to pick Claude Haiku 5.5, Sonnet 5.5 or Opus 5.5 for each part of your product: cost per request with current prices, effort defaults, the API differences that bite when you switch, and why per-route beats per-message routing."
date: 2026-11-14
slug: choose-claude-model-per-route
tags: [claude, pricing, architecture, llm]
---

<p class="lede">Most AI products start with one model for everything, usually the one the tutorial used. A few weeks later the bill arrives and somebody suggests "use the cheap model for easy questions". That instinct is right, but routing per message is the hard way to do it. This post shows the easier way: pick a model per route, from the cost of a typical request on each route, and check the API differences before you switch.</p>

Prices are Anthropic's list prices per million tokens, checked on 2026-11-04. Model behaviour notes come from Anthropic's model documentation.

## The three current models

| Model | Input | Output | Cache read | Default effort |
|---|---|---|---|---|
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 | $0.01 | `medium` |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2.00 | $10.00 | $0.10 | `high` |
| Claude Opus 5.5 (`claude-opus-5-5`) | $4.00 | $20.00 | $0.20 | `medium` |

All three have a 1M-token context window. Haiku 5.5's price applies to prompts up to 100K tokens; above that it is $0.50 input and $2.50 output.

Two things in this table are easy to miss. First, the gap between Haiku and Sonnet (20×) is much larger than the gap between Sonnet and Opus (2×). Second, the default effort differs: Opus 5.5 and Haiku 5.5 default to `medium`, Sonnet 5.5 to `high`. If you compare models without setting effort explicitly, you are comparing two settings at once.

## Cost per request, not per token

Per-million prices are hard to reason about. Turn them into the cost of one typical request on each route. Take a request with 3,000 input tokens and 600 output tokens (thinking counts as output):

```
Haiku 5.5:   3,000 × $0.10/1e6 + 600 × $0.50/1e6  = $0.0006
Sonnet 5.5:  3,000 × $2.00/1e6 + 600 × $10.00/1e6 = $0.0120
Opus 5.5:    3,000 × $4.00/1e6 + 600 × $20.00/1e6 = $0.0240
```

At 10,000 requests a month that is $6, $120 or $240. Whether $120 matters depends on what the route earns, which is why the decision is per route. Prompt caching moves these numbers a lot, often more than the model choice does: see [prompt caching in an agent loop](/blog/prompt-caching-claude-agent-loop/).

<!-- site-only -->

To try your own token counts, the [Claude API cost calculator](/tools/claude-api-cost-calculator/) compares all three models side by side, and the [AI SaaS margin calculator](/tools/ai-saas-margin-calculator/) turns that into margin per plan.

<!-- /site-only -->

## A starting point for common routes

These are defaults to measure against, not rules:

| Route | Start with | Why |
|---|---|---|
| Classify, tag, route, detect language | Haiku 5.5 | Short outputs, high volume, quality saturates early |
| Extract fields into JSON | Haiku 5.5, Sonnet 5.5 if your evals fail | Structured outputs keep the format; the model only needs to find the values |
| Summaries and titles for history | Haiku 5.5 | The user rarely reads them closely |
| Main chat or support agent with tools | Sonnet 5.5 | Good tool use at half Opus's price |
| Long multi-step agent tasks, code generation, hard reasoning | Opus 5.5 | Fewer wrong turns; judge it by cost per *completed* task |
| Background jobs where nobody waits | Any of the above via the Batch API | Half price, results arrive later |

The last column of the Opus row is the important one. A cheaper model that needs three extra tool calls and a retry to finish the job is not cheaper. Measure cost per completed task on real requests before you downgrade a route.

## Try lower effort before a cheaper model

Effort (`output_config.effort`: `low`, `medium`, `high`, `xhigh`, `max`) controls how much the model thinks and how many tool calls it makes. It is often a better lever than switching models:

```ts
await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 16000,
  output_config: { effort: "low" }, // chat routes often hold quality at low
  messages,
});
```

Lowering effort keeps one model, so your prompt cache, your evals and your edge-case handling stay the same. Switching models resets all three. A reasonable order is: cache first, then effort, then model.

## The API differences that bite when you switch

The three models share most of the API, but not all of it. These are the ones we see break code that "just changed the model string":

- **Thinking cannot be turned off on Opus 5.5.** `thinking: { type: "disabled" }` returns a 400 at every effort level. Lower the effort instead.
- **Sonnet 5.5 turns thinking off differently.** `{ type: "disabled" }` is a 400; send `thinking: { type: "between_tools" }` (only at effort `high` or below), or keep thinking on at a lower effort.
- **Forced tool use is rejected on Opus 5.5 and Sonnet 5.5.** `tool_choice: { type: "any" }` or `{ type: "tool", name }` returns a 400. Use `{ type: "auto" }` and say in the prompt which tool to call, add `strict: true` to the tool for schema-valid input, or use structured outputs if the forced call only existed to get JSON back.
- **Sampling parameters are gone.** Opus 5.5 rejects `temperature`, `top_p` and `top_k` outright; Sonnet 5.5 and Haiku 5.5 reject non-default values. Remove them.
- **No assistant prefill.** A request that ends with an assistant message returns a 400. Use structured outputs or instructions instead.

Run your eval suite on every model a route might use before switching it. If you do not have one yet, [evals for Claude agents](/blog/evals-for-claude-agents-typescript/) shows a small runner.

## Why per route, not per message

Routing each message ("is this question hard?") sounds efficient, but it has three costs that are easy to underestimate:

1. **The classifier is another request.** It adds latency to every message and can be wrong in both directions.
2. **Caches are per model.** Alternating models inside one conversation means each model warms its own cache, and a switch pays full input price for the whole history.
3. **Behaviour changes mid-conversation.** Users notice when the tone or format shifts from one reply to the next.

Per route avoids all three. Make the model a setting of the route, store it on every usage row, and change it with a deploy:

```ts
export const MODEL_FOR = {
  chat: "claude-sonnet-5-5",
  extract: "claude-haiku-5-5",
  title: "claude-haiku-5-5",
  research: "claude-opus-5-5",
} as const satisfies Record<string, Anthropic.Model>;
```

If you do want an escalation path, make it explicit and rare: a "think harder" button, or a retry on a stronger model after the cheaper one fails a check you can verify in code.

## Summary

- Compare cost per request on each route, with caching on.
- Haiku for high-volume short tasks, Sonnet for the main agent, Opus where cost per completed task is lower.
- Set effort explicitly; try lower effort before a cheaper model.
- Check the thinking, `tool_choice` and sampling differences before switching, and run evals.
- Route per route, not per message, and record the model on every usage row.

<!-- site-only -->

*Agentwright Starter's agent loop takes the model as an option on each call (default set by `AGENT_MODEL`), prices every usage row with the rate for that exact model, and runs its evals against any model you pass. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's pricing and model documentation before publishing.*

<!-- /site-only -->
