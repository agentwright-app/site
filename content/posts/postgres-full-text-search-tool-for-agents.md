---
title: "Give your Claude agent a search tool with Postgres full-text search before you reach for a vector database"
description: "How to build a document search tool for an AI agent on plain Postgres: a generated tsvector column, a GIN index, websearch_to_tsquery for model-written queries, ts_rank and ts_headline for short ranked results, per-user scoping, and the signs that it is time to add pgvector."
date: 2026-12-05
slug: postgres-full-text-search-tool-for-agents
tags: [postgres, ai, claude, typescript]
---

<p class="lede">The first thing many agent apps need is "answer questions about my documents": help-center articles, notes, tickets, product docs. The usual advice is embeddings and a vector database. For a lot of apps, especially at launch, Postgres full-text search does the job with no new service, no embedding cost and results you can explain. An agent also changes the trade-off: the model can rephrase and retry a search, which covers much of what semantic search would add.</p>

The SQL below follows the PostgreSQL documentation on full-text search, checked on 2026-11-06.

## Why keyword search works better with an agent than without

Keyword search fails when the user's words differ from the document's words: "cancel my plan" versus an article titled "Ending your subscription". A search box gives up there. An agent does not: if the first search returns nothing useful, it tries "subscription end" or "unsubscribe billing", because your tool description tells it to. You get some of the benefit of semantic search from the model itself, and each search costs a few milliseconds instead of an embedding call.

## Step 1: a generated search column and an index

```sql
ALTER TABLE documents
  ADD COLUMN search tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body,  '')), 'B')
  ) STORED;

CREATE INDEX documents_search_idx ON documents USING GIN (search);
CREATE INDEX documents_user_idx   ON documents (user_id);
```

- A **generated column** stays in sync with `title` and `body` automatically; no triggers, no background job.
- `setweight` marks title words as more important (`A`) than body words (`B`), which the ranking uses later.
- The `'english'` configuration handles stemming ("cancelled" matches "cancel") and drops stop words. Use another configuration, or `'simple'`, for other languages.

## Step 2: queries written by the model

The model will write queries like `refund policy "annual plan" -enterprise`. `websearch_to_tsquery` accepts exactly that syntax (quotes for phrases, `or`, a leading `-` to exclude) and never throws a syntax error, which matters when the input comes from a model:

```sql
SELECT id, title,
       ts_rank(search, q) AS rank,
       ts_headline('english', body, q, 'MaxFragments=2, MaxWords=30, MinWords=10') AS snippet
FROM documents, websearch_to_tsquery('english', $2) AS q
WHERE user_id = $1 AND search @@ q
ORDER BY rank DESC
LIMIT 5;
```

`ts_headline` returns short fragments around the matched words instead of whole documents. That keeps the tool result small, which saves tokens on every following turn of the conversation.

## Step 3: the tool

Two tools work better than one: `search_documents` returns short ranked snippets, `read_document` returns one document in full. The model searches, looks at the snippets, and reads only what it needs.

```ts
defineTool({
  name: "search_documents",
  description:
    "Search the user's documents by keywords. Returns up to 5 matches with a title, id and short snippet. " +
    "Use specific words likely to appear in the document. Supports \"exact phrase\", or, and -exclude. " +
    "If results are empty or off-topic, try again with synonyms or fewer words before telling the user nothing was found. " +
    "Use read_document to read a full document by id.",
  schema: z.object({ query: z.string().min(2).max(200) }),
  async run({ query }, ctx) {
    const rows = await searchDocuments(ctx.userId, query);
    if (rows.length === 0) return `No documents matched "${query}".`;
    return rows.map((r) => `[${r.id}] ${r.title}\n${stripTags(r.snippet)}`).join("\n\n");
  },
});

defineTool({
  name: "read_document",
  description: "Read one of the user's documents in full by its id from search_documents.",
  schema: z.object({ id: z.string() }),
  async run({ id }, ctx) {
    const doc = await getDocument(ctx.userId, id);
    return doc ? `# ${doc.title}\n\n${truncate(doc.body, 20_000)}` : `No document with id ${id}.`;
  },
});
```

The description tells the model to retry with other words, which is what makes keyword search hold up. The [tool descriptions post](/blog/write-tool-descriptions-claude-uses-well/) has more on wording.

`ts_headline` marks matches with `<b>` tags by default. Strip them, or set `StartSel` and `StopSel` to something plain, so the model is not distracted by HTML.

Both queries filter by `user_id` from the session, never from the model's input. With [row-level security](/blog/postgres-row-level-security-multi-tenant-agent-saas/), the database enforces it as well. Document text is untrusted input to the model; the [prompt injection post](/blog/prompt-injection-defenses-agent-tools/) covers how to handle that.

## Ranking tweaks that help

- **Normalize for length.** `ts_rank(search, q, 1)` divides the rank by 1 + the logarithm of the document length, so a long document that mentions a word once does not outrank a short one about the topic.
- **Boost recent or popular content** by combining the text rank with your own columns: `ORDER BY ts_rank(search, q) * (1 + 0.1 * log(1 + views)) DESC`.
- **Prefix matching** for product names and codes: `to_tsquery('english', 'invoic:*')` matches "invoice" and "invoicing". Build it only from simple words you have cleaned yourself; `to_tsquery` raises errors on bad syntax, unlike `websearch_to_tsquery`.

## Test it with real questions

Collect 20 real questions with the document that should answer each, and check that it appears in the top 5 results, with one retry allowed. That is a small [eval](/blog/evals-for-claude-agents-typescript/), and it tells you when a change to the ranking or the tool description made things better or worse.

## When to add vectors

Full-text search is enough while most of these are true:

- Users ask with words that appear in the documents, or the model finds them in one or two retries.
- Documents are in one or a few languages you can configure.
- You have up to a few hundred thousand documents per index.

Add embeddings when your test questions keep failing because of wording (support questions in customers' own words against technical docs are the classic case), or when you need cross-language matches. Even then, keep this setup: the `pgvector` extension adds a vector column to the same table, and a hybrid search that combines the keyword rank with vector similarity usually beats either alone. You can add it later without changing the tools the model sees.

## Summary

- A generated `tsvector` column with weights and a GIN index gives you search with no extra service.
- `websearch_to_tsquery` accepts model-written queries safely; `ts_headline` keeps results short.
- Split the tool into search (snippets) and read (one full document); tell the model to retry with other words.
- Scope by the session's user, strip highlight tags, and test with 20 real questions.
- Add `pgvector` for a hybrid search when wording mismatches keep failing your tests.

<!-- site-only -->

*Agentwright Starter's typed tool registry and Postgres setup are where a search tool like this plugs in, next to tools from MCP servers. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the PostgreSQL documentation before publishing.*

<!-- /site-only -->
