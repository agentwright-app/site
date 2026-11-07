---
title: "Add pgvector to your agent's search tool: hybrid keyword and vector search in one Postgres query"
description: "How to extend a Postgres full-text search tool for an AI agent with pgvector: an embedding column next to the tsvector, an HNSW index, reciprocal rank fusion to combine keyword and vector results in one SQL query, keeping embeddings in sync, and a small test set to prove it helped."
date: 2026-12-08
slug: pgvector-hybrid-search-agent-tool
tags: [postgres, ai, claude, typescript]
---

<p class="lede">The <a href="/blog/postgres-full-text-search-tool-for-agents/">full-text search post</a> ended with a test: if real questions keep failing because users describe things in different words than your documents use, add vectors. This post does that without a new service. The embeddings go into the same Postgres table, and one SQL query combines keyword and vector results, so the agent's search tool keeps the same name, input and output.</p>

The SQL below follows the pgvector README and the PostgreSQL documentation, checked on 2026-11-07. Anthropic does not offer an embedding model, so this post uses a separate embedding provider; any model with a fixed output size works the same way.

## Why hybrid, not vectors only

Vector search is good at meaning ("stop paying" finds "cancel subscription") and bad at exact tokens: error codes, product names, order numbers, function names. Keyword search is the opposite. Developer and support content is full of both, so combining them usually beats either one. Since you already have the keyword side, adding vectors is a small step.

## Step 1: the extension, a column and an index

```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE documents ADD COLUMN embedding vector(1024);
ALTER TABLE documents ADD COLUMN embedded_hash text;  -- what the embedding was made from

CREATE INDEX documents_embedding_idx
  ON documents USING hnsw (embedding vector_cosine_ops);
```

- Set the dimension to your embedding model's output size. Changing models later means a new column and a re-embed, so record the model name somewhere (a comment on the column is enough to start).
- **HNSW** gives good recall and fast queries without a training step, which suits a table that grows over time. pgvector's other index type, IVFFlat, builds faster but needs data in the table first.
- `vector_cosine_ops` matches the `<=>` cosine distance operator used below.

Managed Postgres providers such as Neon, Supabase and RDS ship pgvector; check that the version supports HNSW (0.5.0 or later).

## Step 2: keeping embeddings in sync

Embeddings cost an API call, so do not make them in a database trigger. Use a background job:

```ts

export async function embedChangedDocuments() {
  const { rows } = await db.query(
    `SELECT id, title, body FROM documents
     WHERE embedded_hash IS DISTINCT FROM md5(coalesce(title,'') || coalesce(body,''))
     LIMIT 100`
  );
  if (rows.length === 0) return;

  const texts = rows.map((r) => `${r.title}\n\n${r.body}`.slice(0, 8000));
  const vectors = await embed(texts); // your embedding provider, batched

  for (const [i, r] of rows.entries()) {
    await db.query(
      `UPDATE documents SET embedding = $2, embedded_hash = md5(coalesce(title,'') || coalesce(body,''))
       WHERE id = $1`,
      [r.id, toSql(vectors[i])]
    );
  }
}
```

The hash column means only new or edited documents are embedded again. Run it from the same cron or queue you use for other [background work](/blog/background-agent-jobs-postgres-skip-locked/). Until a document is embedded, the keyword half of the search still finds it.

Long documents should be split into chunks (a few hundred words each, with a `document_id`), each with its own embedding; one vector for a 30-page document matches nothing well. The query below works the same on a chunks table.

## Step 3: one query, two rankings, reciprocal rank fusion

Keyword ranks and cosine distances are on different scales, so adding them directly does not work. **Reciprocal rank fusion (RRF)** avoids the problem: take each result's position in each list and score it `1 / (k + position)`, then add the scores. Documents high in both lists win.

```sql
WITH q AS (
  SELECT websearch_to_tsquery('english', $2) AS tsq, $3::vector AS emb
),
keyword AS (
  SELECT d.id, row_number() OVER (ORDER BY ts_rank(d.search, q.tsq, 1) DESC) AS rank
  FROM documents d, q
  WHERE d.user_id = $1 AND d.search @@ q.tsq
  ORDER BY ts_rank(d.search, q.tsq, 1) DESC
  LIMIT 20
),
semantic AS (
  SELECT d.id, row_number() OVER (ORDER BY d.embedding <=> q.emb) AS rank
  FROM documents d, q
  WHERE d.user_id = $1 AND d.embedding IS NOT NULL
  ORDER BY d.embedding <=> q.emb
  LIMIT 20
)
SELECT d.id, d.title,
       coalesce(1.0 / (60 + k.rank), 0) + coalesce(1.0 / (60 + s.rank), 0) AS score
FROM keyword k
FULL OUTER JOIN semantic s ON s.id = k.id
JOIN documents d ON d.id = coalesce(k.id, s.id)
ORDER BY score DESC
LIMIT 5;
```

- `k = 60` is the usual constant from the original RRF paper; it keeps one first place from dominating. You rarely need to tune it.
- Each side takes its top 20, so the fusion has enough candidates without scanning the table.
- `$3` is the embedding of the query text, made with the same model as the documents.

One caution: with a `WHERE user_id = ...` filter, an HNSW index search can return fewer than 20 rows when one user owns a small share of the table, because the filter is applied after the index finds its nearest neighbours. pgvector 0.8.0 added iterative index scans (`SET hnsw.iterative_scan = relaxed_order`) for this. On older versions, raise `hnsw.ef_search`, or use a partial index per large tenant.

## Step 4: the tool does not change

The model still calls `search_documents` with a `query` string. Inside, you embed the query and run the hybrid SQL:

```ts
async run({ query }, ctx) {
  const [emb] = await embed([query]);
  const rows = await hybridSearch(ctx.userId, query, emb);
  if (rows.length === 0) return `No documents matched "${query}".`;
  return rows.map((r) => `[${r.id}] ${r.title}\n${r.snippet}`).join("\n\n");
}
```

Keep the instruction in the [tool description](/blog/write-tool-descriptions-claude-uses-well/) to retry with other words; it still helps. Snippets can come from `ts_headline` when the keyword side matched, or the first sentences of the chunk when only the vector side did.

Each search now costs one embedding call. That is usually a tiny fraction of the Claude call around it, but meter it with the rest of your [per-user usage](/blog/meter-claude-api-costs-per-user-nextjs/) so it shows up in your margins.

## Step 5: prove it helped

Reuse the 20 real questions from the full-text post, each with the document that should answer it. Measure how often that document is in the top 5 with keyword only, vector only and hybrid. Keep the numbers in your [eval](/blog/evals-for-claude-agents-typescript/) file. If hybrid does not beat keyword on your own questions, keep the simpler setup; the extra column costs storage and an API dependency.

## Summary

- Put embeddings in the same Postgres table with pgvector and an HNSW index; no new service.
- Embed in a background job, keyed by a content hash, and chunk long documents.
- Combine keyword and vector rankings with reciprocal rank fusion in one query.
- Watch filtered HNSW searches returning too few rows; use iterative scans on pgvector 0.8+.
- Keep the agent's tool interface the same, and measure on real questions before and after.

<!-- site-only -->

*Agentwright Starter uses Postgres and a typed tool registry, so a hybrid search tool like this is one tool file and one migration. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and checked against the pgvector and PostgreSQL documentation before publishing.*

<!-- /site-only -->
