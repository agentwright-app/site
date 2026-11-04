---
title: "Storing Claude agent conversations: keep every block, append only, never edit history"
description: "How to store multi-turn Claude agent conversations in Postgres: why you must keep the full content blocks (tool calls, tool results, thinking), why editing earlier turns breaks caching and returns 400s on current models, and what to do instead when history gets long."
date: 2026-11-18
slug: store-agent-conversations-append-only
tags: [claude, agents, postgres, architecture]
---

<p class="lede">The Claude API is stateless: every request sends the whole conversation. So your database, not the API, is the source of truth for every chat in your product. The tempting shortcut is to store what the user saw (the text) and rebuild the request from that. For an agent it is the wrong shortcut. This post covers what to store, the one rule that keeps caching and thinking working, and how to handle conversations that grow too long.</p>

API behaviour below was checked against Anthropic's documentation for the current Claude 5.5 models on 2026-11-05.

## Store content blocks, not text

An assistant turn in an agent is not a string. It is a list of content blocks: `text`, `tool_use`, and on current models `thinking` blocks. The user turn that follows a tool call is a list of `tool_result` blocks. The next request has to include all of them, exactly as they were.

If you keep only the text:

- The model loses what its tools returned, so it repeats tool calls or contradicts earlier results.
- A `tool_result` without the matching `tool_use` (or the reverse) is an invalid request.
- Thinking blocks are gone. They carry the model's earlier reasoning, and dropping them changes how the conversation continues.

So store the `content` array of each message as it came back, and append it as-is:

```ts
const final = await stream.finalMessage();
messages.push({ role: "assistant", content: final.content }); // the whole array, not final.content[0].text
```

What the user sees in the UI is a *view* of that history: render `text` blocks, show tool calls as compact status lines, hide thinking.

## The table

A single `jsonb` array per conversation is the simplest design and works well up to a few hundred turns:

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text,
  model text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

When conversations get long or you want per-message queries (search, analytics, moderation), move to one row per message:

```sql
CREATE TABLE conversation_messages (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq int NOT NULL,
  role text NOT NULL,          -- 'user' | 'assistant'
  content jsonb NOT NULL,      -- the content block array, unchanged
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, seq)
);
```

The primary key on `(conversation_id, seq)` also protects you from two tabs appending turn 7 at the same time: one insert wins, the other fails and can reload.

Store the `model` on the conversation. Thinking blocks and caches are tied to the model, so a conversation that silently changes model mid-way behaves differently from one that does not.

## The rule: history is append-only

Once a message is stored and sent, never change it. Do not edit an earlier user message in place, do not trim old turns, do not rewrite the system prompt per request, and do not re-summarise the start of the conversation into the first message.

There are two concrete reasons:

**1. Prompt caching is a prefix match.** The API caches the request up to each cache breakpoint, and a later request hits the cache only if everything before that point is byte-for-byte identical. Edit message 3 and everything after it is a cache miss, at full input price. An append-only history caches almost perfectly: each turn reads the whole previous conversation from cache. Details in [prompt caching in an agent loop](/blog/prompt-caching-claude-agent-loop/).

**2. Thinking blocks are bound to the conversation that produced them.** On Claude Opus 5.5 and Claude Sonnet 5.5 (and the Fable 5.1 models), a thinking block is only valid in the exact conversation it was generated in. If you replay it after editing the system prompt, the tool list or an earlier message, the API detects the change. For accounts created on or after 2026-08-31 that is a **400 error**, not a warning, and retrying the same body never fixes it.

That second point turns a cost issue into an outage: a harness that "cleans up" history works in development on an old account and fails in production on a new one.

## Instead of editing, append

Most reasons to edit history have an append-only alternative:

| You want to | Instead of | Do |
|---|---|---|
| Change instructions mid-conversation (a mode switch, new context) | Editing the top-level `system` | Append a `{ role: "system", content: "..." }` message to `messages` (supported on Opus 5.5, Sonnet 5.5 and Haiku 5.5) |
| Let the user "edit" an earlier message | Overwriting it | Start a branch: copy the history up to that point into a new conversation and continue there |
| Remove old, bulky tool results | Deleting them from stored history | Server-side context editing (beta), which clears old tool results in the request without you rewriting history |
| Handle a conversation near the context limit | Trimming the oldest turns | Server-side compaction (beta), or start a new conversation from a summary |

The branch approach is also what users expect: ChatGPT-style "edit and resend" creates a new path, and the old one is still there.

## When history gets long

All three current models have a 1M-token context window, so "too long" usually means "too expensive" before it means "too big". Three tools, in order of preference:

1. **Caching.** With an append-only history, a long conversation mostly costs cache reads ($0.10 per million tokens on Sonnet 5.5, against $2.00 for uncached input). Long is cheaper than it looks.
2. **Compaction.** With the compaction beta, the API summarises earlier context when the conversation crosses a threshold and returns a `compaction` block. The rule is the same as above: append the full `response.content` back to your history, including that block. If you extract only the text, the compaction state is lost.
3. **A fresh conversation from a summary.** For very long-lived threads (a project assistant used for months), end the conversation deliberately: ask the model for a summary, start a new conversation with that summary as the first user message, and link the two in your table.

What not to do: silently drop the oldest N messages. It breaks caching, can split a `tool_use` from its `tool_result`, and on current models can invalidate thinking blocks in the turns you kept.

## Privacy and deletion

A conversation table is personal data. Decide early:

- **Retention**: how long you keep conversations, and whether users can delete them. Deleting a whole conversation is fine; it is editing one that causes problems.
- **What goes to logs**: keep message content out of application logs and error trackers. Log ids and sizes.
- **Exports**: if users can download their history, export the rendered view, not raw blocks.

## Summary

- Store each message's full `content` array: text, tool calls, tool results and thinking blocks.
- Append only. Never edit, trim or rewrite earlier turns.
- Editing history breaks the prompt cache and, on Opus 5.5 and Sonnet 5.5, can return a 400 for replayed thinking blocks.
- Use mid-conversation system messages, branches, context editing and compaction instead of edits.
- Store the model on the conversation, and keep message content out of your logs.

<!-- site-only -->

*Agentwright Starter's agent loop returns the full message history with every content block, and its `conversations` table stores it as JSON for the chat UI to continue. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against Anthropic's documentation on prompt caching, thinking and compaction before publishing.*

<!-- /site-only -->
