---
title: "Claude Agent SDK vs rolling your own tool loop"
status: outline
target_length: 1,800–2,200 words
target_date: 2026-11-08
---

# Claude Agent SDK vs rolling your own tool loop — outline

**Angle.** A decision guide, not a review. Readers are developers about to build a Claude-powered product and unsure which of three options to start from. No winner; a decision table at the end.

**Facts to verify before writing** (all from official docs, note the check date in the post):
- Claude Agent SDK packages (`@anthropic-ai/claude-agent-sdk`, `claude-agent-sdk`), its built-in tools (Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch), hooks, subagents, sessions, permission modes — code.claude.com/docs/en/agent-sdk.
- Anthropic SDK Tool Runner (`client.beta.messages.toolRunner`, `betaZodTool`) — current beta status and signature.
- Messages API: `stop_reason` values, parallel tool use rule (all `tool_result` blocks in one user message), `strict: true`, prompt caching on `tools` + `system`, forced `tool_choice` removal on 5.5 models.
- Pricing: per-token cost is identical across the three options; the difference is how many tokens each one spends.

## 1. The three options (300 words)
1. **Hand-written loop** on the Messages API: `while (stop_reason === "tool_use")`. ~80 lines. You own retries, caching, max-turn guards, parallel tool execution, metering hooks.
2. **Tool Runner** in the Anthropic SDK: same API, loop supplied by the SDK, per-turn hooks for approval/logging/metering. Still your tools only, still your hosting.
3. **Claude Agent SDK**: Claude Code's harness as a library. Built-in filesystem/shell/web tools, hooks, subagents, sessions, permission system. You call `query()`.

Clarify the common confusion: Tool Runner ≠ Agent SDK. Both are "harness only"; neither hosts anything for you.

## 2. What you actually control in each (400 words)
Table with rows: system prompt, tool definitions, tool execution environment, context management (compaction / clearing), caching strategy, per-turn hooks, streaming shape, metering per request, error/refusal handling, model choice, cost per turn (overhead tokens).
Key point: the Agent SDK carries its own system prompt and tool descriptions, which costs input tokens on every turn and makes prompt caching behave differently from a frozen custom prompt.

## 3. Where the Agent SDK wins (300 words)
- Coding/filesystem agents, internal dev tools, anything that would otherwise reimplement Bash + file editing + permissions.
- Subagents and sessions for free.
- Hooks for audit logs and approvals.
- Example: "a bot that opens a PR fixing lint errors" — a weekend with the Agent SDK, weeks by hand.

## 4. Where your own loop wins (300 words)
- A SaaS product with a narrow tool set (search your DB, call your API, send an email). You want a 400-token system prompt, 5 tools, full cache hit on every turn, and a `usage_events` row per request.
- Multi-tenant metering and plan caps around each request (link to the metering post).
- You need to swap models per plan (Haiku for free, Sonnet for Pro) and keep the harness trivial.
- Edge/serverless constraints: no shell, cold starts, request time limits.

## 5. The middle path: Tool Runner (200 words)
- When you want option 1's control without maintaining the loop code: define tools with Zod, add hooks for metering, let the SDK loop.
- Caveat: beta surface; check the current signature before adopting.

## 6. Cost comparison, measured not guessed (300 words)
Run the same 3 tasks through each option with `claude-sonnet-5-5`, record `usage` per request, report total tokens and dollars using the official price table. Expected shape: Agent SDK spends more input tokens per turn (its own prompt + tool schemas) but may finish in fewer turns on filesystem tasks. State the numbers with the exact date and model, and publish the script.

## 7. Decision table (150 words)
Rows: "You're building…" → recommended option → why in one line.
- Coding agent / dev tool → Agent SDK
- Customer-facing SaaS with your own tools → own loop or Tool Runner
- Prototype in an afternoon → Tool Runner
- Must run on the edge → own loop

## 8. Agentwright note (1 paragraph)
Starter uses option 1 (own loop, ~120 lines in `lib/agent/loop.ts`) with metering, caching and an MCP connector, because the product is a multi-tenant SaaS. Link to agentwright.app.

**Code to include:** the minimal manual loop (≈40 lines), a Tool Runner equivalent (≈25 lines), an Agent SDK `query()` call (≈15 lines). All runnable; test each against the live API once (1 Haiku call each) before publishing.
