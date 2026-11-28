---
title: "Large tool results are the hidden token bill of an AI agent: trim, page and summarize them"
description: "Why big tool results (database rows, API responses, web pages, logs) dominate the input tokens of an agent loop, and five fixes: return only needed fields, cap and paginate results, tell the model what was cut, store full results outside the conversation, and clear old results with context editing."
date: 2026-12-20
slug: large-tool-results-agent-token-costs
tags: [ai, llm, typescript, performance]
---

<p class="lede">Look at the input tokens of a long agent conversation and you usually find the same thing: the user's messages are a few hundred tokens, the model's answers a few thousand, and the tool results tens of thousands. One <code>search_orders</code> call that returns 200 full order objects can cost more than the rest of the conversation together, and because every later turn re-reads it, it keeps costing. This post is about making tool results small on purpose.</p>

## Why one big result costs many times

The Messages API is stateless: each turn sends the whole conversation again. A 30,000-token tool result in turn 2 of a 10-turn run is read as input in turns 3 through 10, eight more times. Caching softens it (cache reads are a tenth of the input price), but the first write still costs full price plus the cache-write premium, and every extra token pushes the conversation closer to the point where you need [compaction](/blog/long-agent-conversations-compaction-context-editing/).

An example with Claude Sonnet 5.5 ($2 per million input, $2.50 cache write, $0.10 cache read): a 30,000-token result written to cache once and read eight more times costs about $0.075 + $0.024 = $0.10. The same information returned in 3,000 tokens costs about $0.01. On a plan priced at $20 a month, that difference decides your [margin](/blog/price-ai-saas-plan-margins/).

## Fix 1: return the fields the model needs

Most tool results are a database row or an API response passed through `JSON.stringify` unchanged. Map it to what the model needs to answer:

```ts
run: async ({ customerEmail }) => {
  const orders = await db.query.orders.findMany({ where: eq(orders.email, customerEmail), limit: 20 });
  return orders.map((o) => ({
    id: o.id,
    date: o.createdAt.toISOString().slice(0, 10),
    total: `${(o.totalCents / 100).toFixed(2)} ${o.currency}`,
    status: o.status,
  }));
},
```

Internal ids, timestamps to the millisecond, audit columns, nested objects and `null` fields are tokens the model reads and ignores. Compact JSON (no pretty printing) also saves 10 to 20 percent over indented JSON.

## Fix 2: cap results and let the model ask for more

Every list-returning tool gets a limit and a cursor:

```ts
schema: z.object({
  query: z.string(),
  cursor: z.string().optional().describe("Pass next_cursor from a previous call to get more results."),
}),
run: async ({ query, cursor }) => {
  const rows = await search(query, { after: cursor, limit: 21 });
  const page = rows.slice(0, 20);
  return {
    results: page.map(summarise),
    next_cursor: rows.length > 20 ? page.at(-1)!.id : null,
    note: rows.length > 20 ? "More results exist. Narrow the query or pass next_cursor." : undefined,
  };
},
```

The model usually narrows its query instead of paging, which is what you want. Say in the [tool description](/blog/write-tool-descriptions-claude-uses-well/) that results are limited to 20 and how to get more.

## Fix 3: say what was cut

Truncating silently is worse than not truncating: the model treats a partial result as complete and answers confidently from it. When you cut text, say so in the result:

```ts
function clip(text: string, maxChars = 12_000) {
  if (text.length <= maxChars) return text;
  const head = text.slice(0, maxChars * 0.8);
  const tail = text.slice(-maxChars * 0.2);
  return `${head}\n\n[... ${text.length - maxChars} characters omitted ...]\n\n${tail}`;
}
```

Keeping the end as well as the start matters for logs and stack traces, where the useful line is often last. Count in characters for speed; about four characters per token is close enough for English text and JSON, and you can check real numbers with [`count_tokens`](/blog/count-tokens-before-sending-claude/).

## Fix 4: keep the full result outside the conversation

Sometimes the model needs to work through a large result in steps: a 2 MB CSV, a long log, a big web page. Store it and return a handle:

```ts
run: async ({ url }) => {
  const page = await fetchPage(url);
  const id = await scratch.put(ctx.runId, page.text);      // per-run storage, deleted after the run
  return {
    id,
    title: page.title,
    length_chars: page.text.length,
    preview: page.text.slice(0, 2000),
    hint: "Use read_document(id, offset) to read more, or search_document(id, query) to find a passage.",
  };
},
```

Two small tools, `read_document` and `search_document`, then let the model pull only the parts it needs. The full text never enters the conversation, so it is never re-read eight times. Scope the scratch storage to the run and the user like everything else.

## Fix 5: clear old results you no longer need

In long runs, results from early turns are often dead weight by turn 15. Context editing is an API feature (beta) that clears old tool results before the model sees the request. You enable it with the `context-management-2025-06-27` beta and the `clear_tool_uses_20250919` strategy; the [compaction and context editing post](/blog/long-agent-conversations-compaction-context-editing/) explains the options and how they interact with caching. Apply fixes 1 to 4 first: context editing removes results after you have paid for them at least once.

## Measure per tool

Add the size of each tool result to your [traces](/blog/trace-claude-agent-runs-postgres/):

```sql
SELECT tool_name,
       count(*)                                    AS calls,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY result_chars) AS median_chars,
       max(result_chars)                           AS max_chars
FROM agent_tool_calls
WHERE created_at > now() - interval '7 days'
GROUP BY tool_name
ORDER BY median_chars * count(*) DESC;
```

The top row is where to start. In most agents one or two tools account for most of the tool-result tokens.

## Summary

- Tool results are re-read on every later turn, so their size multiplies.
- Return only the fields the model needs, as compact JSON.
- Cap list results, offer a cursor, and say so in the description.
- When you cut text, say what was cut; keep the start and the end.
- Store very large results outside the conversation and give the model tools to read parts.
- Measure result size per tool and fix the biggest first.

<!-- site-only -->

*Agentwright Starter's loop sends each tool result back as JSON and records usage per model call, so the input tokens these fixes save show up on its `/usage` page. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
