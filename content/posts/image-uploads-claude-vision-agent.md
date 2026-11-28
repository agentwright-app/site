---
title: "Image uploads for a Claude agent: screenshots and photos, resized, stored and metered"
description: "How to let users send screenshots and photos to a Claude agent in a Next.js app: accepted formats, resizing on the server to control tokens, base64 vs the Files API, what an image costs on current models, keeping images out of the cache-breaking path, and per-plan limits."
date: 2026-12-19
slug: image-uploads-claude-vision-agent
tags: [ai, nextjs, typescript, llm]
---

<p class="lede">"Here's a screenshot of the error" is one of the most natural things a user can send to an agent. Claude reads screenshots, charts, photos of whiteboards and scanned receipts well. The work on your side is plumbing: accept the file, shrink it, send it in the right block, store it for the conversation, and count what it costs. This post goes through each step.</p>

## The content block

An image goes into a user message as an `image` block, before the text that refers to it:

```ts
messages.push({
  role: "user",
  content: [
    { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
    { type: "text", text: "Why does this build fail?" },
  ],
});
```

Accepted formats are JPEG, PNG, GIF and WebP. Besides `base64`, the source can be a `url` the API fetches, or a `file` id from the Files API (more on that below).

## Resize on the server, before Claude sees it

Image tokens grow with pixels. A rough rule from Anthropic's vision docs is width × height / 750 tokens, up to a per-image maximum. High-resolution models (Claude Opus 4.7 and the Opus models after it, and Claude Sonnet 5, for example) accept up to 2576 pixels on the long edge and can use up to about 4,800 tokens for one image; check the vision docs for the model you use. A phone photo at 4032 × 3024 gets scaled down by the API anyway, so sending it full size only costs you upload time and bandwidth.

Resize yourself, to a size that fits the job:

```ts
import sharp from "sharp";

const LIMITS = { screenshot: 1600, photo: 1280 };   // long edge in pixels

export async function prepareImage(buf: Buffer, kind: keyof typeof LIMITS) {
  const img = sharp(buf, { limitInputPixels: 50_000_000 }).rotate();   // honour EXIF orientation
  const meta = await img.metadata();
  if (!meta.format || !["jpeg", "png", "webp", "gif"].includes(meta.format)) throw new Error("Unsupported image type");

  const out = await img
    .resize({ width: LIMITS[kind], height: LIMITS[kind], fit: "inside", withoutEnlargement: true })
    .toFormat(kind === "screenshot" ? "png" : "jpeg", { quality: 82 })
    .toBuffer({ resolveWithObject: true });

  return { data: out.data, mediaType: kind === "screenshot" ? "image/png" : "image/jpeg", ...out.info };
}
```

Keep screenshots as PNG (sharp text edges matter for reading error messages) and photos as JPEG. `limitInputPixels` protects your server from decompression bombs; re-encoding also drops whatever metadata or payload came with the original file, including EXIF location data you do not want to keep.

Do not shrink screenshots too far. Small text that becomes blurry is the most common reason a vision answer is wrong. If users send dense dashboards, test 1600 against 2400 pixels on a few real examples and keep the smallest size that still reads correctly.

## What an image costs

With the rule above, a 1600 × 1000 screenshot is about 2,100 tokens. On Claude Sonnet 5.5 ($2 per million input tokens) that is about $0.004 the first time it is sent. A full-resolution image at the per-image maximum is about $0.01.

The second time costs less, if caching works. Images stay in the conversation, so every later turn re-reads them as input. With [prompt caching](/blog/prompt-caching-claude-agent-loop/) on the conversation, later turns read the image from cache at $0.10 per million on Sonnet 5.5, a tenth of the price. Without caching, a 10-turn conversation pays for the same screenshot ten times. Measure it rather than guess: [`count_tokens`](/blog/count-tokens-before-sending-claude/) accepts image blocks.

## Base64 or the Files API

- **Base64** is simplest: the bytes go in every request. Fine for one or two images per conversation.
- **The Files API** uploads the image once and you reference it by `file_id` in later requests, which keeps request bodies small in long conversations with several images.

Either way, store your own copy (object storage, keyed by user and conversation) so you can show the image in the chat history and rebuild the conversation. If you use the Files API, files you upload to Anthropic also belong in your [data deletion](/blog/export-delete-user-data-ai-saas/) job.

## Store a reference, not the bytes, in the conversation row

If you persist conversations as [content blocks](/blog/store-agent-conversations-append-only/), do not store megabytes of base64 in Postgres. Store a placeholder that your loader turns back into an image block:

```json
{ "type": "image", "source": { "type": "stored", "key": "u_123/c_456/img_789.png", "media_type": "image/png" } }
```

When you rebuild the request, swap each `stored` source for `base64` (read from storage) or `file`. Always rebuild it the same way: if turn 3 sends the image as base64 and turn 4 as a file id, the request prefix changes and the cache misses from that point.

## Limits per plan

Images are a cost and an abuse vector, so give them limits like everything else:

- Maximum upload size before resizing (10 MB is generous for screenshots).
- Images per message (3 to 5) and per conversation (20).
- Images per day per plan, counted in the same place as your [rate limits](/blog/rate-limit-llm-endpoints-postgres/).

Image tokens show up in `usage.input_tokens` like any other input, so your [per-user metering](/blog/meter-claude-api-costs-per-user-nextjs/) already counts them. Adding an `image_count` column makes "why was this conversation expensive?" easy to answer.

## Images are untrusted input

A screenshot can contain text written to manipulate the agent ("ignore your instructions and…"). Treat text read from an image exactly like text from a web page or a document: data, not instructions. The [prompt injection post](/blog/prompt-injection-defenses-agent-tools/) covers the defences, and the rule that matters most applies here too: tools with side effects need confirmation, whatever the model read.

## Summary

- Send images as `image` blocks before the related text; JPEG, PNG, GIF or WebP.
- Resize on the server: about 1600 px for screenshots (PNG), 1280 px for photos (JPEG); re-encode to drop metadata.
- An image costs roughly width × height / 750 tokens; caching makes later turns a tenth of the price.
- Store images in object storage and a reference in the conversation; rebuild the request the same way every turn.
- Limit size and count per plan, and treat text in images as untrusted.

<!-- site-only -->

*Agentwright Starter's chat sends text only and does not handle image uploads; it meters every model call per user from `usage`, which counts image tokens too once you add them. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
