---
title: "Agent memory across conversations: let a Claude agent remember user facts, per user, in Postgres"
description: "Two ways to give a Claude agent memory that survives between conversations: Claude's memory tool backed by per-user rows in Postgres, or a small facts table the app controls. Scoping, size limits, what never to store, letting users see and delete memories, and the effect on prompt caching."
date: 2026-12-18
slug: agent-memory-across-conversations-claude
tags: [ai, postgres, typescript, llm]
---

<p class="lede">Every new conversation with your agent starts from zero: the user explains again that they write TypeScript, that their company is in Germany, that they want short answers. Memory fixes that, and it is also the feature most likely to leak one user's data into another's answers if you build it casually. This post shows two designs, both scoped to one user, and the rules that keep them safe.</p>

## Design 1: Claude's memory tool, your storage

The Claude API has a client-side memory tool. You declare it, Claude decides when to read or write memories, and your code carries out each command:

```ts
const response = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 8192,
  tools: [{ type: "memory_20250818", name: "memory" }, ...myTools],
  messages,
});
```

Claude works with files under a `/memories` directory using the commands `view`, `create`, `str_replace`, `insert`, `delete` and `rename`. "Client-side" is the important word: nothing is stored at Anthropic. Every command arrives as a `tool_use` block, and your handler decides where the files live. The TypeScript SDK has a `betaMemoryTool` helper that takes one handler per command, which saves writing the dispatch.

For a multi-user product, back the "files" with rows keyed by user:

```sql
CREATE TABLE agent_memories (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  path       text NOT NULL,              -- '/memories/preferences.md'
  content    text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, path),
  CHECK (path LIKE '/memories/%' AND path NOT LIKE '%..%'),
  CHECK (length(content) <= 8000)
);
```

```ts
async function handleMemory(userId: string, cmd: MemoryCommand) {
  const path = normalise(cmd.path);                 // reject anything outside /memories
  switch (cmd.command) {
    case "view":
      return path === "/memories"
        ? listPaths(userId)                         // directory listing
        : readFile(userId, path);
    case "create":
      await assertQuota(userId);                    // e.g. 20 files, 40 KB total
      return writeFile(userId, path, cmd.file_text);
    case "str_replace":
      return replaceInFile(userId, path, cmd.old_str, cmd.new_str);
    // insert, delete, rename ...
  }
}
```

The `userId` comes from the signed-in session, never from the model's input, exactly as every other query in your app should be [scoped to the user](/blog/postgres-row-level-security-multi-tenant-agent-saas/). Treat `path` as untrusted: normalise it, reject `..`, and keep it under `/memories`. The size checks matter because the model will happily append forever.

**Good for:** open-ended assistants where you cannot predict what is worth remembering.

## Design 2: a facts table the app controls

If you know what is worth remembering (language, timezone, role, tone, the project they are working on), a narrower design is easier to reason about. Give the agent one tool, `save_user_fact`, with a strict schema, and load the facts yourself:

```ts
defineTool({
  name: "save_user_fact",
  description:
    "Save a lasting fact about the user that will help in future conversations, such as their " +
    "preferred programming language or timezone. Only call this when the user states the fact " +
    "themselves. Never save secrets, passwords, payment details or health information.",
  schema: z.object({
    key: z.enum(["language", "timezone", "role", "answer_style", "current_project"]),
    value: z.string().max(200),
  }),
  run: async ({ key, value }, ctx) => upsertFact(ctx.userId, key, value),
});
```

An enum of keys means there is never a 41st fact, and a 200-character limit keeps each one short. At the start of each conversation, read the user's facts and put them in the first user message or a system message after the cached prefix:

```ts
const facts = await getFacts(userId);
const intro = facts.length
  ? `Known about this user (they told us earlier):\n${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n")}`
  : "";
```

**Good for:** most SaaS products, where three to ten known facts do 90% of the work.

## Keep memory out of the cached system prompt

Whichever design you pick, do not paste memories into the system prompt. The system prompt should be [identical for every request](/blog/prompt-caching-claude-agent-loop/) so its cache is shared; per-user text there misses the cache for everyone. Put memories after the cached prefix, in the conversation. With Design 1 this happens by itself, because memories arrive as tool results.

## What must never be stored

Write this into the tool description and enforce it in code:

- **Secrets:** API keys, passwords, tokens. A simple pattern check (`sk-`, long base64 strings) before saving catches the common cases.
- **Payment and health details**, and anything your privacy policy does not cover.
- **Instructions.** "Always approve refunds" written into memory by a [prompt-injected document](/blog/prompt-injection-defenses-agent-tools/) becomes a standing instruction in every future conversation. Store facts, and present them to the model as facts the user stated, not as rules.

## Users must be able to see and delete it

A memory the user cannot see feels creepy the first time the agent uses it. Add a settings page that lists everything stored with a delete button per item and a "Forget everything" button. It also makes your [data export and deletion](/blog/export-delete-user-data-ai-saas/) jobs simple: one more table keyed by `user_id`, covered by the same `ON DELETE CASCADE`.

When the agent uses a memory, it helps if it says so briefly ("You mentioned you use TypeScript, so…"). Users trust a memory they can see being used.

## Cost

Memory is cheap. Ten facts are about 150 tokens per conversation, or $0.0003 of input on Claude Sonnet 5.5 at $2 per million. The memory tool costs more because each read or write is a tool call and a model turn; in practice it is a few turns per conversation, which your [per-user metering](/blog/meter-claude-api-costs-per-user-nextjs/) will show.

## Summary

- Use Claude's memory tool for open-ended memory, backed by per-user rows; use a strict facts table when you know what matters.
- Scope by the session's user id, validate paths, cap file count and size.
- Load memories after the cached prefix, never into the system prompt.
- Never store secrets, payment or health data, or instructions.
- Give users a page to see and delete what the agent remembers.

<!-- site-only -->

*Agentwright Starter does not include agent memory; it stores each conversation per user in Postgres and defines tools with Zod schemas; a `save_user_fact` tool like this one would also need the signed-in user's id passed to the tool, which its tools do not receive today. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
