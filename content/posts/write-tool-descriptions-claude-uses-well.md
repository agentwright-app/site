---
title: "Write tool definitions Claude uses correctly: names, descriptions, schemas and error messages"
description: "Most agent bugs that look like model mistakes are tool definition mistakes. How to name tools, write descriptions that say when to call them, constrain inputs with enums and strict schemas, return results the model can use, and write error messages that lead to a correct retry. With before/after examples in TypeScript."
date: 2026-11-26
slug: write-tool-descriptions-claude-uses-well
tags: [claude, agents, typescript, llm]
---

<p class="lede">When an agent calls the wrong tool, skips a tool it should have used, or passes a date in the wrong format, the first instinct is to add a rule to the system prompt. Usually the better fix is in the tool definition itself. The model decides what to call from the tool's name, description and schema, and decides what to do next from what the tool returns. This post goes through each of those, with before and after versions.</p>

The API details below (strict tool use, `tool_choice` support on the current models) were checked against Anthropic's tool use documentation on 2026-11-05.

## The name: a verb and an object

The name is the first thing the model reads. Make it say what happens:

| Before | After |
|---|---|
| `orders` | `search_orders` |
| `user` | `get_user_by_email` |
| `email` | `send_email_to_customer` |
| `db` | (split into the few queries you actually need) |

Avoid one generic tool with a `mode` or `action` parameter (`manage_orders` with `action: "search" | "refund" | "cancel"`). Separate tools are easier for the model to choose between, and they let your code treat a read differently from an action that changes something. If you load tools from several sources, such as [MCP servers](/blog/mcp-servers-as-tools-in-your-agent/), prefix them by source (`billing__search_invoices`) so two `search` tools cannot collide.

## The description: when to call it, not only what it does

A description that only restates the name gives the model nothing to decide with. Anthropic's guidance is to be explicit about *when* to use the tool; the current Opus models in particular are conservative about calling tools, and trigger conditions in the description measurably increase how often they call a tool when they should.

Before:

```ts
{ name: "search_orders", description: "Searches orders." }
```

After:

```ts
{
  name: "search_orders",
  description:
    "Find a customer's orders by email, order number or date range. " +
    "Call this whenever the user mentions an order, a purchase, a charge or a refund, " +
    "before answering any question about order status. " +
    "Returns at most 20 orders, newest first, with id, date, total and status. " +
    "Does not return line items; call get_order for those.",
}
```

The good version answers four questions: what it finds, when to call it, what comes back (and how much), and what it does not do, with a pointer to the tool that does. That last part prevents the most common wrong call: using the nearest tool for a job it cannot do.

Write descriptions for a capable new colleague, not for a parser. Full sentences, no internal jargon, and the same words your users use. If users say "invoice" and your code says "order", mention both.

## The schema: make wrong inputs impossible

Every parameter gets a description and the tightest type you can give it:

```ts
input_schema: {
  type: "object",
  properties: {
    email: { type: "string", description: "Customer email address, exactly as the user gave it." },
    status: {
      type: "string",
      enum: ["pending", "paid", "refunded", "cancelled"],
      description: "Only return orders with this status. Omit to return all.",
    },
    from: { type: "string", description: "Start date, inclusive, as YYYY-MM-DD." },
    to: { type: "string", description: "End date, inclusive, as YYYY-MM-DD. Defaults to today." },
  },
  required: ["email"],
  additionalProperties: false,
},
strict: true,
```

- **`enum`** for any fixed set of values. The model will not invent a status called `complete`.
- **Formats in the description** (`YYYY-MM-DD`), with an example when the format is unusual.
- **`required`** only for what is truly required; say what the default is for the rest.
- **`strict: true`** at the top level of the tool, together with `additionalProperties: false`, guarantees that the input matches the schema. Without it, the model usually gets it right; with it, your code does not need to handle extra or missing fields.

Keep the schema stable. Tools are part of the cached prompt prefix, so a description that changes between requests (a date, a user name, a list built in a different order each time) breaks [prompt caching](/blog/prompt-caching-claude-agent-loop/) for everything after it.

## The result: short, structured, and with a next step

What a tool returns becomes part of the conversation, and it is resent on every following turn. Three rules:

1. **Return only what the model needs.** Not the full database row with 40 columns and internal IDs; the five fields the description promised.
2. **Cap the size and say so.** "Showing 20 of 312 orders. Narrow the date range to see others." The model can act on that sentence; it cannot act on a silently truncated list.
3. **Use a consistent shape.** JSON with the same keys every time, or short plain text. Do not mix.

## Errors: tell the model how to fix the call

When a tool fails, return the failure as a tool result with `is_error: true`, and write the message for the model, which will read it and try again:

```ts
// Before
return { type: "tool_result", tool_use_id, is_error: true, content: "Error 422" };

// After
return {
  type: "tool_result",
  tool_use_id,
  is_error: true,
  content: "No customer found with email 'ana@exmaple.com'. Check the spelling with the user, or search by order number instead.",
};
```

A message that says what was wrong and what to try next turns a failed call into a correct second call. "Error 422" usually turns into a guess or an apology. Never throw an exception out of the loop for an expected failure such as "not found"; that ends the turn for the user. Do not drop the result either: every `tool_use` block needs a matching `tool_result`, or the next request is rejected.

## When you need a specific tool to be called

On Claude Opus 5.5, Claude Sonnet 5.5 and Claude Fable 5.1, forcing a call with `tool_choice: { type: "any" }` or `{ type: "tool", name }` returns a 400. Use `tool_choice: { type: "auto" }` and say in the prompt which tool to use for this step. If you forced a tool only to get JSON back, use [structured outputs](/blog/structured-outputs-claude-typescript/) instead; that is what they are for. `{ type: "none" }` still works when a turn must not call tools.

## Fewer, better tools

Every tool definition costs input tokens on every request, and every extra tool is one more option the model can pick wrongly. If an agent has 40 tools, look for ones that are never called (your usage logs show this) and ones that overlap. For large tool sets that are mostly irrelevant to any single request, Claude's tool search feature lets the model load definitions on demand instead of receiving all of them up front.

## Test the definitions, not just the code

Tool definitions are prompts, so test them like prompts. For each tool, write a few [eval cases](/blog/evals-for-claude-agents-typescript/): a request that should call it, one that should call a different tool, and one that should call nothing. Run them whenever you edit a description. A wording change that helps one tool can steal calls from another, and you only see that with cases for both.

## Checklist

- Name: verb plus object; one tool per action; source prefix if tools come from several places.
- Description: what it does, when to call it, what it returns and how much, what it does not do.
- Schema: descriptions on every field, `enum` for fixed sets, formats spelled out, `strict: true` with `additionalProperties: false`.
- Definitions stable between requests, so the cache prefix stays intact.
- Results: only needed fields, a size cap that announces itself, one consistent shape.
- Errors: `is_error: true` and a message that says how to fix the call.
- No forced `tool_choice` on the 5.5 models; `auto` plus a clear instruction, or structured outputs.

<!-- site-only -->

*Agentwright Starter's tool registry keeps tool definitions sorted and stable for caching, returns tool failures to the model as error results instead of ending the turn, and includes an eval runner you can point at cases like these. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's tool use documentation before publishing.*

<!-- /site-only -->
