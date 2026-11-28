---
title: "Conversation titles and summaries for an AI chat app, for a fraction of a cent, with Claude Haiku 5.5"
description: "How to generate chat titles and short conversation summaries cheaply: when to run the call, a prompt and structured output that keep titles short, running it after the response so the user never waits, idempotent writes, metering, and what it costs per thousand conversations."
date: 2026-12-24
slug: conversation-titles-summaries-haiku
tags: [ai, typescript, nextjs, llm]
---

<p class="lede">A sidebar full of "New chat" entries makes an AI app feel unfinished, and users cannot find yesterday's conversation. Automatic titles fix it. They are also the cheapest Claude call in your product, if you keep them on a small model, out of the request path and out of your main agent's prompt. This post shows the whole job in about 40 lines.</p>

## When to generate

Two moments work well:

1. **After the first exchange.** Once the user's first message and the agent's first answer exist, there is enough to name the conversation. This covers most conversations, which are short.
2. **Again after the topic drifts**, optionally. Regenerating after every 10th message, or when the user asks a clearly new question, keeps long conversations findable. Many apps skip this and let users rename.

Do not generate from the user's first message alone. "Help" or "quick question" makes a bad title; the agent's answer usually says what the conversation is about.

## The call

A title is a classification-sized job, so it goes to the smallest model, Claude Haiku 5.5 ($0.10 per million input tokens, $0.50 output). Use [structured outputs](/blog/structured-outputs-claude-typescript/) so you get a short string back, not a paragraph about the title:

```ts
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const TITLE_SYSTEM =
  "You name chat conversations for a sidebar. Write a title of 2 to 6 words in the language of " +
  "the conversation, in sentence case, with no quotes and no final period. Name the topic, not the " +
  "user (\"Fix Postgres deadlock in jobs\", not \"User asks about a deadlock\"). Also write one " +
  "sentence of at most 25 words that summarizes what was asked and answered.";

export async function titleFor(firstUser: string, firstAnswer: string) {
  const response = await client.messages.create({
    model: "claude-haiku-5-5",
    max_tokens: 1024,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { title: { type: "string" }, summary: { type: "string" } },
          required: ["title", "summary"],
          additionalProperties: false,
        },
      },
    },
    system: TITLE_SYSTEM,
    messages: [{
      role: "user",
      content: `<user_message>\n${firstUser.slice(0, 4000)}\n</user_message>\n<assistant_answer>\n${firstAnswer.slice(0, 4000)}\n</assistant_answer>`,
    }],
  });

  if (response.stop_reason !== "end_turn") return null;
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) return null;
  const { title, summary } = JSON.parse(text) as { title: string; summary: string };
  return { title: title.trim().slice(0, 80), summary: summary.trim().slice(0, 300), usage: response.usage };
}
```

A few choices in there:

- **Clip the inputs.** 4,000 characters of each side is plenty to name a conversation. A pasted 50-page document should not make the title call expensive.
- **Wrap the conversation in tags.** The conversation is data to be named, not instructions; a user message that says "ignore previous instructions" should become a title about that, not change the job.
- **Low effort and room to finish.** Haiku 5.5 thinks adaptively by default, and thinking tokens count toward `max_tokens` and are billed as output. Naming does not need deep reasoning, so `effort: "low"` keeps thinking short, and a `max_tokens` of 1024 leaves room so the JSON is never cut off.
- **Check `stop_reason`** before parsing. A refusal or a `max_tokens` cut is a reason to keep "New chat", not to crash. The [stop reasons post](/blog/handle-claude-stop-reasons-agent/) lists them.
- **Cap the length in code** anyway. A 300-character title breaks a sidebar no matter what the prompt said.

## Run it after the response, never before

The user is waiting for the agent's answer, not for the title. Start the title job after the first answer has finished streaming, and do not await it in the request:

```ts
// in the agent route, after the stream has closed
after(async () => {
  const res = await titleFor(firstUserText, firstAnswerText);
  if (!res) return;
  await db.update(conversations)
    .set({ title: res.title, summary: res.summary })
    .where(and(eq(conversations.id, convId), eq(conversations.userId, userId), isNull(conversations.title)));
  await recordUsage(userId, "claude-haiku-5-5", res.usage, { purpose: "title" });
});
```

`after()` from `next/server` runs work after the response is sent, on platforms that support it. Without it, put the job on your [background queue](/blog/background-agent-jobs-postgres-skip-locked/).

The `isNull(title)` condition makes the write idempotent and respects a title the user typed in the meantime: if they renamed it, the generated one does not overwrite it. The `userId` condition keeps the update [scoped to the owner](/blog/postgres-row-level-security-multi-tenant-agent-saas/), like every other query on user data.

The client can poll for the title or receive it as a final event on the stream; a sidebar that updates two seconds after the answer feels natural.

## Meter it, mark it

Title calls are cheap but not free, and they happen once per conversation for every user. Record them in your [usage table](/blog/meter-claude-api-costs-per-user-nextjs/) with a `purpose` column (`agent`, `title`, `summary`). Then decide whether they count against the user's cap. Most products do not count them: the user did not ask for a title, so charging them for it feels wrong.

## What it costs

A title call reads at most about 2,500 tokens (two clipped texts plus the short system prompt) and writes about 60 tokens of JSON; at low effort, thinking usually adds little. On Claude Haiku 5.5:

- input: 2,500 × $0.10 / 1,000,000 = $0.00025
- output: 60 × $0.50 / 1,000,000 = $0.00003

About $0.0003 per conversation before any thinking tokens, or **$0.28 per thousand conversations**. The same call on Claude Sonnet 5.5 would be about $0.0056, twenty times more for a title nobody reads twice. This is the clearest case for [choosing a model per route](/blog/choose-claude-model-per-route/).

## The summary has a second use

The one-sentence summary is useful beyond the sidebar: it makes conversation search better (search titles and summaries, not every message), and it is a short, cheap description of past conversations if you later give the agent [memory](/blog/agent-memory-across-conversations-claude/) of earlier work.

## Summary

- Generate the title after the first exchange, from both the question and the answer.
- Use Claude Haiku 5.5 at low effort with a JSON schema; clip inputs and cap the output length.
- Run it after the response is sent; write it only if the title is still empty and only for the owner.
- Meter it with a purpose column and decide whether it counts against the cap.
- About $0.28 per thousand conversations on Haiku 5.5.

<!-- site-only -->

*Agentwright Starter titles each conversation with the first 80 characters of its first message and records usage per model call, so a title job like this one would replace that line with one more metered call. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
