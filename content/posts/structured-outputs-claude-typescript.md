---
title: "Reliable JSON from Claude in TypeScript: structured outputs, Zod and strict tools"
description: "How to get schema-valid JSON from Claude with output_config.format and messages.parse(), when to use strict tools instead, which JSON Schema features are supported, and the three cases where you still need to check the result."
date: 2026-11-16
slug: structured-outputs-claude-typescript
tags: [claude, typescript, json, llm]
---

<p class="lede">Half the AI features in a SaaS are not chat at all. They read a support email and fill in a ticket, turn an invoice into rows, or tag a document. All of them need JSON that your code can trust. The old way was a prompt that said "respond only with JSON" plus a regex to strip the markdown fence. The current way is structured outputs, which constrains the response to your schema. This post shows the TypeScript setup, the limits of the schema, and what can still go wrong.</p>

API details below were checked against Anthropic's structured outputs documentation and `@anthropic-ai/sdk` on 2026-11-05.

## Two features, two jobs

Structured outputs comes in two forms:

| | Constrains | Use it when |
|---|---|---|
| **JSON output** (`output_config.format`) | The model's whole response | You want data back: extraction, classification, a plan |
| **Strict tool use** (`strict: true` on a tool) | The input of a tool call | The model decides whether to call a tool, and you need valid arguments when it does |

Both are supported on the current models (Claude Haiku 5.5, Sonnet 5.5 and Opus 5.5) and several earlier ones.

## JSON output with Zod

Define the schema once, in Zod, and use it for both the request and the TypeScript type:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const Ticket = z.object({
  category: z.enum(["billing", "bug", "account", "feature_request", "other"]),
  priority: z.enum(["low", "normal", "urgent"]),
  summary: z.string(),
  customer_email: z.string().nullable(),
  order_id: z.string().nullable(),
});
export type Ticket = z.infer<typeof Ticket>;

const client = new Anthropic();

export async function triage(emailText: string): Promise<Ticket> {
  const res = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 2048,
    system: "You triage support emails for a SaaS product. Use null when a field is not in the email.",
    messages: [{ role: "user", content: emailText }],
    output_config: { format: zodOutputFormat(Ticket) },
  });
  if (res.stop_reason !== "end_turn" || !res.parsed_output) {
    throw new Error(`triage failed: stop_reason=${res.stop_reason}`);
  }
  return res.parsed_output;
}
```

`messages.parse()` sends the schema, then parses and validates the response. `parsed_output` is typed as `Ticket`, or `null` if parsing failed.

Two design notes that matter more than the code:

- **Use `nullable` for "not found", not optional fields with a guess.** If the schema requires `order_id` as a string, the model has to put *something* there. Giving it `null` as a legal answer is how you avoid invented order numbers.
- **Enums are your best tool.** A closed list of categories is easy for the model, easy to store and easy to evaluate.

## What the schema can and cannot express

Structured outputs supports a practical subset of JSON Schema:

- **Supported:** object, array, string, integer, number, boolean, null; `enum`, `const`, `anyOf`, `allOf`, `$ref` and definitions; string formats such as `date`, `date-time`, `email`, `uri` and `uuid`.
- **Not supported:** recursive schemas, numeric constraints (`minimum`, `maximum`, `multipleOf`), string length limits (`minLength`, `maxLength`), complex array constraints, and `additionalProperties` set to anything except `false`.

The TypeScript and Python SDKs handle the unsupported constraints for you: they remove them from the schema sent to the API and check them on the client after the response arrives. So `z.string().max(200)` still works, but a too-long string comes back as a validation failure rather than being prevented. Design for that: if a limit really matters, say it in the prompt as well.

The first request with a new schema has extra latency while the schema is compiled; later requests with the same schema reuse it (the compiled schema is cached for 24 hours). Keep schemas stable, and do not generate them per request.

## Strict tools: valid arguments inside an agent

In an agent, the model chooses which tool to call. Add `strict: true` and the input of every call is guaranteed to match the schema:

```ts
const tools: Anthropic.Tool[] = [
  {
    name: "create_refund",
    description: "Refund an order. Only call this after the customer confirmed the order id.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        reason: { type: "string", enum: ["duplicate", "not_as_described", "other"] },
      },
      required: ["order_id", "reason"],
      additionalProperties: false,
    },
  },
];
```

Strict schemas need `additionalProperties: false` and a `required` list on every object. You still validate the *meaning* in your tool (does this order belong to this user?), but you no longer write code for missing fields or wrong types.

## Do not force a tool just to get JSON

A common older pattern was to define a fake tool and force the model to call it with `tool_choice: { type: "tool", name: "output" }`, just to get structured data. On Claude Opus 5.5 and Sonnet 5.5, forced tool choice (`any` or a named `tool`) is rejected with a 400. If the forced call only existed to extract JSON, switch to `output_config.format`. If you genuinely need a tool call, use `tool_choice: { type: "auto" }`, name the tool in the prompt, keep `strict: true`, and check that a call was made.

## Three cases where you still have to check

Structured outputs guarantees the format of a *completed* response. Three things are outside that guarantee:

1. **`stop_reason: "max_tokens"`.** The output was cut off, so it can be incomplete JSON. Set `max_tokens` with room to spare; for extraction of a long document, the output can be larger than you think.
2. **`stop_reason: "refusal"`.** If the model declines, the response may not follow your schema. Check `stop_reason` before reading the content.
3. **Wrong but valid values.** The schema guarantees `category` is one of five strings, not that it is the right one. That is what evals are for: a few dozen labelled emails and a script that compares categories (see [evals for Claude agents](/blog/evals-for-claude-agents-typescript/)).

Structured outputs also cannot be combined with citations (that returns a 400) or with an assistant prefill (which current models reject anyway).

## Store the result with its version

Extracted data outlives the prompt that produced it. Store the JSON next to what made it:

```sql
CREATE TABLE ticket_triage (
  email_id uuid PRIMARY KEY,
  result jsonb NOT NULL,
  schema_version int NOT NULL,   -- bump when the Zod schema changes
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

When you add a category six months from now, `schema_version` tells you which rows were classified without it.

## Cost

Extraction is usually a short input and a short output, which is where Claude Haiku 5.5 shines: a 1,500-token email and a 150-token result is about $0.0002 per email at $0.10 input and $0.50 output per million tokens, plus any thinking tokens, which bill as output. For simple extraction, try `output_config: { effort: "low" }` and check your evals still pass. If the job is not interactive (nightly re-tagging, backfills), the Batch API runs the same requests at half price; structured outputs works with batches too.

## Summary

- Use `output_config.format` with `messages.parse()` and a Zod schema for data; use `strict: true` for tool inputs.
- Make "not found" a legal value with `nullable`, and prefer enums.
- Unsupported constraints are checked client-side by the SDK, so they can still fail.
- Replace forced tool calls with structured outputs; Opus 5.5 and Sonnet 5.5 reject forced `tool_choice`.
- Check `stop_reason`, evaluate the values, and store the schema version with the result.

<!-- site-only -->

*Agentwright Starter defines tools with Zod schemas and validates every tool input against them before running the tool, and its eval runner is where we would check an extraction route like this one. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's structured outputs documentation before publishing.*

<!-- /site-only -->
