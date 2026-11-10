---
title: "Every Claude stop_reason, and what a production agent loop should do with each"
description: "A 200 response is not always a finished answer. How to handle end_turn, tool_use, max_tokens, stop_sequence, pause_turn and refusal in a Claude agent loop, including truncated tool calls, server-side refusal fallbacks on the 5.5 models, and what to meter."
date: 2026-11-20
slug: handle-claude-stop-reasons-agent
tags: [claude, agents, typescript, reliability]
---

<p class="lede">Last week we covered the requests that fail with an error status: 429s, 529s, dropped streams. This post is about the quieter case: the request succeeds with a 200, and the response is still not what your code assumed. Every Claude response carries a <code>stop_reason</code> that says why the model stopped. Most tutorial loops check for one value, <code>tool_use</code>, and treat everything else as "done". Here is what each value means and what an agent loop should do with it.</p>

Behaviour below was checked against Anthropic's Messages API and refusal handling documentation on 2026-11-05. The companion post on [errors and retries](/blog/claude-api-errors-retries-agent-loop/) covers the non-200 cases.

## The values

| `stop_reason` | Meaning | Loop action |
|---|---|---|
| `end_turn` | The model finished its answer | Return to the user |
| `tool_use` | The model wants to call one or more tools | Run them, send results, continue |
| `max_tokens` | Output hit your `max_tokens` limit | Depends on what was cut off; never run a cut-off tool call |
| `stop_sequence` | Output hit one of your `stop_sequences` | Treat as done (you asked for it) |
| `pause_turn` | The model paused a long turn (server tools) | Send the response back as-is to let it continue |
| `refusal` | The model declined, for safety reasons | Show a clear message; optionally fall back to another model |

Write the loop as a `switch` with a `default` branch that throws. If a new value appears in a future API version, you want an error in your logs, not a silent "done".

## The loop

```ts
for (let turn = 0; turn < MAX_TURNS; turn++) {
  const final = await client.messages.stream({ model, max_tokens, system, tools, messages }).finalMessage();
  await recordUsage(userId, model, final.usage);   // every response, whatever the stop reason
  messages.push({ role: "assistant", content: final.content });

  switch (final.stop_reason) {
    case "end_turn":
    case "stop_sequence":
      return { status: "done", messages };

    case "tool_use":
      messages.push({ role: "user", content: await runTools(final.content) });
      continue;

    case "pause_turn":
      continue;  // send the same history again; the model resumes where it paused

    case "max_tokens":
      return handleMaxTokens(final, messages);

    case "refusal":
      return { status: "refused", details: final.stop_details, messages };

    default:
      throw new Error(`Unhandled stop_reason: ${final.stop_reason}`);
  }
}
return { status: "turn_limit", messages };
```

Note the order: usage is recorded **before** branching. Every response that reached you was billed, including refusals and truncated ones.

## `max_tokens`: find out what was cut off

`max_tokens` means the model was still writing when it reached your limit. What to do depends on the last content block:

- **The last block is `text`.** The user got a partial answer. For chat, you can show it with a "the answer was cut off" note and a *continue* button. To continue, append a user message such as "Please continue" and call again; current models do not accept an assistant prefill, so you cannot ask the model to resume mid-sentence by sending its own partial text as the last message.
- **The last block is `tool_use`.** The tool call's input is probably incomplete. **Do not run it.** Running a tool with half its arguments is how you send an email with no body. Retry the turn with a higher `max_tokens`, or drop that turn and ask the model to try again with a smaller step.

```ts
function handleMaxTokens(final: Anthropic.Message, messages: Anthropic.MessageParam[]) {
  const last = final.content.at(-1);
  if (last?.type === "tool_use") {
    // Remove the truncated assistant turn; retry with more room.
    messages.pop();
    return { status: "retry_with_more_tokens", messages };
  }
  return { status: "truncated", messages };
}
```

Remember that thinking counts toward `max_tokens` too. On models that think by default, a limit that was fine for plain answers can be too small once the model reasons first. If `max_tokens` shows up often, raise the limit (with streaming, large values are safe from request timeouts) or lower the effort for that route.

## `pause_turn`: send it back unchanged

`pause_turn` appears when a turn that uses server-side tools (such as web search or code execution) runs long and the API pauses it. The response is valid; it is just not finished. Append the assistant content exactly as received and make the same request again, and the model continues. Do not add a new user message in between and do not edit the content. Count pauses in your turn limit so a misbehaving turn cannot loop forever.

If your agent uses only your own tools, you will not see `pause_turn`, but keep the branch. It costs nothing and protects you when someone adds web search later.

## `refusal`: tell the user, and decide on a fallback

A refusal comes back as a normal 200 with `stop_reason: "refusal"`. The `stop_details` object explains why:

```ts
if (final.stop_reason === "refusal" && final.stop_details) {
  log.warn("refusal", { category: final.stop_details.category, explanation: final.stop_details.explanation });
}
```

The category is an open set (examples include `cyber` and `bio`), and it can be `null`. Store it; it tells you whether refusals cluster on one feature of your product.

Three rules for refusals:

1. **Do not retry the identical request.** It will usually be declined again, and you pay for each attempt.
2. **Show the user something honest.** "The assistant can't help with this request" with a link to support is better than a generic error, and much better than an empty reply.
3. **Do not read `content` as an answer.** It may be empty or partial. Structured output schemas are not guaranteed on a refusal either.

### Server-side fallbacks on the 5.5 models

Safety classifiers sometimes decline legitimate requests, especially in security or medical products. For Claude Opus 5.5 and Claude Sonnet 5.5, the Claude API can re-run a declined request on a fallback model inside the same call:

```ts
const final = await client.beta.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",   // the API picks the fallback by refusal category
  system, tools, messages,
});
```

With `fallbacks: "default"` you do not maintain a model list. The response includes a `fallback` block where the switch happened, and `final.model` tells you which model actually answered; meter with that model's prices, not the one you requested. If the fallback model also declines, the final `stop_reason` is still `refusal`, so the handling above stays.

Availability differs by model and platform. On Sonnet 5.5 only the `"default"` form is supported, and only on the Claude API. Claude Haiku 5.5 has no server-side fallback, and sending `fallbacks` to it is a 400. Check the refusal documentation for your platform before you rely on it.

## Turn limits are a stop reason too

Your own code adds one more way to stop: the maximum number of turns. When the loop hits it, return a distinct status (`turn_limit` above) rather than an error, keep the history, and tell the user the task was too long to finish in one go. A run that hits the limit regularly is a signal: the task should be a background job (see [background agent jobs](/blog/background-agent-jobs-postgres-skip-locked/)), or the agent is stuck repeating a tool call, which your evals should catch.

## What to show in the UI

Map each outcome to one clear state:

| Outcome | User sees |
|---|---|
| `done` | The answer |
| `truncated` | The answer so far, a "cut off" note and a continue button |
| `retry_with_more_tokens` | Nothing different; retry once automatically |
| `refused` | A short, honest message and a support link |
| `turn_limit` | What was done so far and an option to continue |
| Error (non-200) | "The AI service is busy, your message was not lost" |

## Summary

- Branch on every `stop_reason`, with a `default` that throws.
- Record usage before branching; every response was billed.
- On `max_tokens`, never run a truncated tool call; continue text with a new user message.
- On `pause_turn`, send the content back unchanged and call again.
- On `refusal`, do not retry the same request; show an honest message, log the category, and consider `fallbacks: "default"` on Opus 5.5 and Sonnet 5.5.

<!-- site-only -->

*Agentwright Starter's agent loop records usage on every response before it looks at the stop reason, raises a typed `AgentRefusedError` with the `stop_details` on a refusal, and stops at a fixed turn limit. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's Messages API and refusal documentation before publishing.*

<!-- /site-only -->
