---
title: "Grounded answers from user documents with Claude citations: setup, rendering and checks"
description: "How to use the Claude API's citations feature so an agent's answers about user documents point to the exact passage: enabling citations on document blocks, plain text vs PDF vs custom content, reading citation locations, rendering footnotes in a Next.js UI, and testing that answers stay grounded."
date: 2026-12-23
slug: claude-citations-grounded-answers-documents
tags: [ai, typescript, llm, nextjs]
---

<p class="lede">When an agent answers from a contract, a manual or a policy document, the first question a careful user asks is "where does it say that?" Claude's citations feature answers it in the API response itself: each claim comes back with the exact passage it was based on. This post shows how to turn it on, read the result, show it in a UI, and test that answers stay grounded.</p>

## Turn it on per document

Citations work on `document` content blocks. Set `citations: { enabled: true }` on each document you send; it is all or nothing, so enable it on every document in the request or on none.

```ts
const response = await client.messages.create({
  model: "claude-sonnet-5-5",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "text", media_type: "text/plain", data: policyText },
          title: "Refund policy (2026-10)",
          citations: { enabled: true },
        },
        { type: "text", text: "Can a customer get a refund after 20 days?" },
      ],
    },
  ],
});
```

Put the documents before the question. The `title` is returned with each citation, so make it something a user recognises.

Three source types fit three situations:

- **Plain text** (`type: "text"`): Claude splits it into sentences and cites character ranges.
- **PDF** (`type: "base64"` with `application/pdf`, or a Files API `file` id): citations point to page ranges. The [PDF uploads post](/blog/pdf-uploads-claude-agent-files-api/) covers getting the file there.
- **Custom content** (`type: "content"` with your own list of text blocks): you decide the chunks, and citations point to block indexes. Use this when your data is already split into meaningful pieces, such as search results or FAQ entries, so a citation never cuts across two of them.

## Read the response

With citations on, the answer comes back as several `text` blocks instead of one. Blocks that make a claim carry a `citations` array:

```json
[
  { "type": "text", "text": "No. " },
  {
    "type": "text",
    "text": "Refunds are available within 14 days of purchase",
    "citations": [{
      "type": "char_location",
      "cited_text": "Customers can request a full refund within 14 days of purchase.",
      "document_index": 0,
      "document_title": "Refund policy (2026-10)",
      "start_char_index": 412,
      "end_char_index": 476
    }]
  },
  { "type": "text", "text": ", so a request after 20 days is outside the policy." }
]
```

The location type depends on the source: `char_location` for plain text, `page_location` (with 1-based `start_page_number` and `end_page_number`) for PDFs, and `content_block_location` for custom content. `cited_text` is the quoted passage itself; it does not count toward output tokens, which makes citations cheaper than asking the model to quote passages in its answer.

## Turn blocks into footnotes

Concatenate the text blocks for display and collect citations as numbered footnotes:

```ts
type Note = { n: number; title: string; quote: string; where: string };

export function renderWithCitations(content: Anthropic.ContentBlock[]) {
  const notes: Note[] = [];
  const keyToN = new Map<string, number>();
  let text = "";

  for (const block of content) {
    if (block.type !== "text") continue;
    text += block.text;
    for (const c of block.citations ?? []) {
      const where =
        c.type === "page_location" ? `p. ${c.start_page_number}` :
        c.type === "char_location" ? `chars ${c.start_char_index}-${c.end_char_index}` :
        c.type === "content_block_location" ? `section ${c.start_block_index + 1}` : "";
      const key = `${c.document_index}:${c.cited_text}`;
      let n = keyToN.get(key);
      if (!n) {
        n = notes.length + 1;
        keyToN.set(key, n);
        notes.push({ n, title: c.document_title ?? "Document", quote: c.cited_text, where });
      }
      text += `[${n}]`;
    }
  }
  return { text, notes };
}
```

In the UI, a footnote marker opens the quote and its location; for PDFs, link to the page in your viewer. Users rarely click every footnote, but the fact that they can changes how much they trust the answer.

When you stream, citations arrive as `citations_delta` events attached to the text block being written. Collect them per block index as they come in, and render the footnotes when the block ends.

## What citations do not do

- **They do not combine with structured outputs.** A request with `output_config.format` and citations returns a 400. If you need JSON and citations, ask for the answer with citations first and extract fields in a second call, or use custom content blocks so each block maps to a record.
- **They do not prove correctness.** A citation shows which passage the model used; the claim can still overstate it. "Refunds within 14 days" becoming "refunds anytime" next to a correct citation is rare but possible.
- **They do not search for you.** The document must be in the request. For large collections, retrieve the relevant passages first ([full-text](/blog/postgres-full-text-search-tool-for-agents/) or [hybrid search](/blog/pgvector-hybrid-search-agent-tool/)) and send them as custom content.

## Test that answers stay grounded

Add a few cases to your [evals](/blog/evals-for-claude-agents-typescript/) that check grounding mechanically:

1. **Every cited text exists in the source.** Normalise whitespace and check `source.includes(cited_text)`. This should always pass; if it does not, your rendering or chunking is wrong.
2. **Questions the document does not answer.** The right response says the document does not cover it, with no citation. An answer with a confident claim and no citation is a failure.
3. **Key numbers come with a citation.** For questions whose answer is a number or date, check that the block containing it has at least one citation.

## Cost

Documents count as input tokens; a 10-page policy is roughly 5,000 to 8,000 tokens. With the same documents across a conversation, [prompt caching](/blog/prompt-caching-claude-agent-loop/) makes repeat turns cheap: on Claude Sonnet 5.5, 8,000 tokens cost $0.016 the first time and $0.0008 from cache.

## Summary

- Enable citations on every document block; put documents before the question and give them recognisable titles.
- Plain text cites characters, PDFs cite pages, custom content cites your own blocks.
- Render text blocks with numbered footnotes that show the quoted passage.
- Citations and structured outputs do not combine; citations show the source, not that the claim is right.
- Test that cited text exists, unanswerable questions get no confident claim, and numbers are cited.

<!-- site-only -->

*Agentwright Starter does not use citations or document blocks yet; its agent route streams text blocks to a minimal chat UI, which is where footnotes like these would render. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
