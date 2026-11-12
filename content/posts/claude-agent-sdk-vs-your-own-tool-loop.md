---
title: "Claude Agent SDK vs rolling your own tool loop: which one for your product?"
description: "Three ways to run a Claude agent: a hand-written loop on the Messages API, the Anthropic SDK's Tool Runner, and the Claude Agent SDK. Runnable TypeScript for each, measured token usage, and a decision table."
date: 2026-11-03
slug: claude-agent-sdk-vs-your-own-tool-loop
tags: [claude, agents, typescript, architecture]
---

You have decided your product needs an agent: Claude should call tools, look at the results and decide what to do next. Before you write any code there is a choice that shapes everything after it. Do you write the tool loop yourself, let the Anthropic SDK run it for you, or embed the Claude Agent SDK and get Claude Code's whole harness as a library?

This post is a decision guide, not a review. Each option is the right answer for some products. Below is runnable TypeScript for all three, what each one leaves you in control of, the token usage we measured when running them, and a table at the end that maps "what you are building" to an option.

Facts and code were checked against the official docs and run against the live API on 2026-11-03 with `@anthropic-ai/sdk` 1.4.0 and `@anthropic-ai/claude-agent-sdk` 0.3.317.

## The three options

1. **Your own loop on the Messages API.** You call `client.messages.create()`, check `stop_reason`, run the tools Claude asked for, send the results back, repeat. About 50 lines. You own every request.
2. **The Tool Runner in the Anthropic SDK.** Same API, same tools you define, but `client.beta.messages.toolRunner()` runs the loop. You write tool functions, it calls them and feeds the results back until Claude is done. It is a beta helper.
3. **The Claude Agent SDK.** Claude Code packaged as a library (`@anthropic-ai/claude-agent-sdk`). It ships built-in tools for reading, writing and editing files, running shell commands and searching the web, plus permissions, hooks, subagents and sessions. You call `query()` with a prompt and options.

The common confusion: the Tool Runner and the Agent SDK sound alike but are different products. The Tool Runner lives in the regular API SDK and only loops over tools you define. The Agent SDK runs the Claude Code binary (the npm package bundles it) with its own tools and its own system prompt. Neither hosts anything for you; both run wherever your code runs.

## Option 1: your own loop

The example is a support agent with one tool that looks up an order. In a real product the tool would query your database.

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";

const tools: Anthropic.Tool[] = [
  {
    name: "get_order",
    description: "Look up an order by id. Returns status and total in USD.",
    input_schema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
      additionalProperties: false,
    },
    strict: true,
  },
];

async function runTool(name: string, input: unknown): Promise<string> {
  if (name === "get_order") {
    const { order_id } = input as { order_id: string };
    return JSON.stringify({ order_id, status: "shipped", total_usd: 99 });
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function agent(prompt: string, maxTurns = 10) {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: "You are a support agent for an online shop.", cache_control: { type: "ephemeral" } }],
      tools,
      messages,
    });
    console.log(`turn ${turn}`, res.stop_reason, res.usage); // meter here: one row per request

    messages.push({ role: "assistant", content: res.content });
    if (res.stop_reason !== "tool_use") return res;

    // Run every tool call from this turn, then send ALL results back in ONE user message.
    const calls = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results: Anthropic.ToolResultBlockParam[] = await Promise.all(
      calls.map(async (c) => {
        try {
          return { type: "tool_result", tool_use_id: c.id, content: await runTool(c.name, c.input) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: c.id, content: String(err), is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  throw new Error("Agent hit maxTurns without finishing");
}

const final = await agent("Where is order A-1042 and how much was it?");
console.log(final.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
```

Four details in those lines are easy to get wrong:

- **Return all tool results in one user message.** Claude can ask for several tools in one turn. If you split their results across several messages, it learns to stop making parallel calls.
- **Report failures, do not drop them.** A failed tool still gets a `tool_result`, with `is_error: true`, so Claude can recover or explain.
- **Guard the turn count.** Without `maxTurns`, a confused model and a tool that keeps failing can loop until your bill notices.
- **`strict: true`** makes the API guarantee that the tool input matches your schema, so the cast in `runTool` is safe.

The loop treats any `stop_reason` other than `tool_use` as the end. In production you also want explicit branches for `max_tokens` (the answer was cut off) and `refusal`, and for `pause_turn` if you add server tools such as web search.

## Option 2: the Tool Runner

Same tool, same model, no loop code. Tools are defined with Zod and carry their own `run` function.

```ts
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const client = new Anthropic();
const MODEL = process.env.MODEL ?? "claude-sonnet-5-5";

const getOrder = betaZodTool({
  name: "get_order",
  description: "Look up an order by id. Returns status and total in USD.",
  inputSchema: z.object({ order_id: z.string() }),
  run: async ({ order_id }) => JSON.stringify({ order_id, status: "shipped", total_usd: 99 }),
});

const runner = client.beta.messages.toolRunner({
  model: MODEL,
  max_tokens: 4096,
  max_iterations: 10,
  system: "You are a support agent for an online shop.",
  tools: [getOrder],
  messages: [{ role: "user", content: "Where is order A-1042 and how much was it?" }],
});

// Each iteration yields one API response, so you can still meter per request.
for await (const message of runner) {
  console.log(message.stop_reason, message.usage);
}
const final = await runner.done();
console.log(final.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
```

Iterating over the runner gives you each API response as it arrives, which is where per-request metering, logging and approval checks go. If you only want the answer, `await runner.runUntilDone()` does it in one line. Approval gates do not need a manual loop either: check inside the tool's `run` and return "the user declined" as the result.

The trade-off is that this is a beta surface. Pin the SDK version and read the changelog before upgrading.

## Option 3: the Claude Agent SDK

Here the task is different on purpose, because this is what the Agent SDK is built for: work on files. No tool code at all; the agent uses its built-in `Glob`, `Grep` and `Read`.

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "List every TODO comment under src/ with file and line number.",
  options: {
    model: process.env.MODEL ?? "claude-sonnet-5-5",
    cwd: process.env.REPO_DIR ?? process.cwd(),
    allowedTools: ["Read", "Glob", "Grep"], // read-only: no Edit, no Bash
    maxTurns: 10,
  },
})) {
  if (message.type === "result") {
    console.log(message.subtype === "success" ? message.result : message.subtype);
    console.log({ turns: message.num_turns, cost_usd: message.total_cost_usd, usage: message.usage });
  }
}
```

It reads `ANTHROPIC_API_KEY` from the environment (it does not load `.env` files) and needs Node.js 18.14 or later. The final `result` message reports the turn count, the token usage and a cost estimate in dollars, so you do not have to compute it yourself.

One option name is a trap. `allowedTools` only pre-approves tools so they run without a permission prompt; it does not remove the others from Claude's context. To limit which tools exist at all, use the `tools` option, or `disallowedTools` to remove specific ones.

## What we measured

We ran each of the three examples once on Claude Haiku 5.5 (`MODEL=claude-haiku-5-5`), the cheapest current model, and read `usage` from the responses.

| | Requests | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Own loop | 2 | under 1,000 | 134 | under $0.0002 |
| Tool Runner | 2 | about 1,000 | 114 | under $0.0002 |
| Agent SDK | 2 | 86,630 (43,487 cache write, 43,139 cache read) | 483 | $0.0095 |

Haiku 5.5 list prices on 2026-11-03, per million tokens: $0.10 input, $0.20 for a 1-hour cache write, $0.01 for a cache read, $0.50 output ([official pricing](https://platform.claude.com/docs/en/about-claude/pricing)).

The two tasks are different, so read the table for its shape, not its ratio. The shape is clear: **the Agent SDK sends about 43,000 tokens of its own system prompt and tool definitions with every request.** The SDK caches that prefix with a 1-hour cache, so after the first request it is billed at the cache-read price. On Haiku it barely matters. On Claude Sonnet 5.5 ($2 input, $4 one-hour cache write, $0.10 cache read) the same prefix costs about $0.17 to write once per hour and about $0.004 per request after that, before any of your own tokens.

The own loop and the Tool Runner cost the same, because they send the same request. The runner saves you code, not tokens. Also note that their small system prompt was not cached at all (`cache_read_input_tokens: 0`): prompts shorter than the model's minimum cacheable length are silently not cached. With a real system prompt and a handful of tools, you cross that threshold.

Per-token prices are identical across the three options. What differs is how many tokens each one spends per request, and who decides.

## What you control in each

| | Own loop | Tool Runner | Agent SDK |
|---|---|---|---|
| System prompt | Yours, every byte | Yours | Claude Code's, which you can customize |
| Tools | Only yours | Only yours | Built-in file, shell and web tools, plus yours via MCP |
| Where tools run | Your code | Your code | The machine running the SDK (files, shell) |
| Per-request hooks | Anything | Per-iteration access | Lifecycle hooks (before and after tool calls, and more) |
| Fixed overhead per request | Your prompt and tools | Your prompt and tools | About 43,000 tokens, cached |
| Dependency risk | Stable Messages API | Beta helper | A separate SDK that tracks Claude Code releases |
| Runs on edge or serverless | Yes | Yes | Needs a Node or Python process that can run a binary |

## Where the Agent SDK wins

If your agent works on files and code, the Agent SDK saves you weeks. Reading, searching and editing files, running commands, asking for permission before anything destructive, splitting work into subagents, resuming a session tomorrow: all of that already exists and has been hardened by everyone who uses Claude Code. A bot that opens a pull request to fix lint errors, an internal tool that triages failing CI runs, an agent that migrates a config format across a repo: these are a weekend with the Agent SDK and a month by hand.

It also suits internal tools, where the person running the agent is a developer and a 43,000-token prefix is noise next to the value of the result.

## Where your own loop wins

Most customer-facing SaaS features are not coding agents. They search your database, call your API, draft an email. For those you want a system prompt of a few hundred tokens, five tools you wrote, a cache hit on every turn, and one row in a `usage_events` table per request. That is the case for options 1 and 2.

Your own loop also wins when:

- **You bill users per request.** Metering, plan caps and rate limits sit naturally around each `messages.create()` call. We wrote up the whole metering layer in [How to meter Claude API costs per user in a Next.js SaaS](/blog/meter-claude-api-costs-per-user-nextjs/).
- **You route models by plan.** Haiku 5.5 for free users and Sonnet 5.5 for paid ones is one variable, with nothing else in the harness to retune.
- **You deploy to the edge or to serverless functions.** No shell, no binary, short time limits. A plain HTTP loop fits; a bundled CLI does not.
- **Your users' input should never reach a shell.** If the agent has no Bash tool, nobody has to reason about what a prompt injection could make it run.

## The middle path: the Tool Runner

Pick the Tool Runner when you want everything from option 1 except the loop code. Zod schemas double as input validation, the loop handles parallel tool calls and errors for you, and iterating over the runner still gives you each response for metering. Accept that it is beta: pin the version, and keep the manual loop above in mind as the escape hatch, since both send identical requests.

## Decision table

| You are building | Start with | Why |
|---|---|---|
| A coding agent or developer tool | Agent SDK | Files, shell, permissions and subagents already exist |
| An internal automation that edits a repo | Agent SDK | The prefix cost is noise next to the time saved |
| A customer-facing feature with your own tools | Own loop or Tool Runner | Small prompt, full caching, per-request metering |
| A prototype this afternoon | Tool Runner | Least code that still uses your tools |
| Something that must run on the edge | Own loop | No binary, no beta dependency |

If you are unsure, start with the Tool Runner. Moving from it to a manual loop is a small refactor, because the requests are the same.

---

<!-- site-only -->

*Agentwright Starter uses option 1, a hand-written streaming loop of about 100 lines with prompt caching, MCP tools, per-request metering and plan caps, because it is a multi-tenant SaaS kit and every request has to be counted and capped. It is a Next.js starter kit for Claude-powered SaaS with auth, Lemon Squeezy billing and an eval runner already wired together. Launch price $99. Details are at [agentwright.app](https://agentwright.app).*

<!-- /site-only -->
