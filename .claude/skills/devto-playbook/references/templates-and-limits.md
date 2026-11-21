# dev.to templates and limits

## Front matter for a cross-post

```markdown
---
title: How we cut cold starts from 900 ms to 120 ms
published: false
tags: showdev, serverless, node, performance
canonical_url: https://example.com/blog/cold-starts
cover_image: https://example.com/img/cold-starts-cover.png
series: Cold starts, measured
ai_disclosure_level: no_ai
description: Three changes, the benchmark script, and what did not work.
---
```

Publish under the organization from the editor's author menu. `ai_disclosure_level` takes `no_ai`, `some_ai` or `fully_autonomous`; the editor's AI Disclosure control sets the same field. On an RSS-imported draft, delete the `date:` line before publishing an old post.

## Disclosure lines

- Affiliation, first paragraph: "I work on {product}; this post uses it, and the trade-offs section covers where it falls short."
- Affiliate: "This post includes affiliate links; I may receive compensation if you buy through them."
- AI-Assisted, closing line: "Drafted with AI help; code and numbers were run and checked by me."

## Earn-first comment

```text
// ✓ Good - adds a fact the author can use, no link
Nice write-up. One thing that bit us with the same setup: the pool
closes idle sockets after 60 s, so the first request after a quiet
period pays the TLS handshake. Did you see that in your p99?

// ✗ Bad - praise plus product link
Great post! We built {product} to solve exactly this, check it out: {url}
```

## #showdev launch post skeleton

1. The problem in one paragraph, from your own use.
2. What you built, with a screenshot or GIF and the install command.
3. How it works: one design decision and its trade-off.
4. What it does not do yet.
5. One question for readers. One link, at the end.

## #discuss post

```text
Title: How do you test webhooks locally without exposing your laptop?
Body: Three approaches we have tried (tunnel, replay from logs, local
mock server), what broke with each, and the question: which one
survived contact with your CI?
```

## Reply to a tag-moderator removal

```text
Thanks for the note - you're right, this is a project announcement, not
an open-source practice post. I've kept #showdev. Is there a tag you'd
suggest for the release notes part?
```

## Limits and mechanics, with source

| Item                        | Value                                                                                      | Source       |
| --------------------------- | ------------------------------------------------------------------------------------------ | ------------ |
| Tags                        | max 4; RSS uses the first 4 categories                                                     | platform     |
| New accounts (first 3 days) | 1 article, 1 comment per 300 s                                                             | code default |
| Regular limits              | 9 articles, 9 comments, 10 reactions per 30 s                                              | code default |
| New-account comment flood   | over 20 posts commented in a day                                                           | code default |
| Repeated title              | 3 same-title posts in a day labelled spam                                                  | code default |
| Trusted member votes        | thumbs up +5, thumbs down -10, vomit flag -50                                              | code default |
| Reaction ring               | 50+ reactions in 3 months, 3+ accounts, 80% to the same 2+ authors; trusted members exempt | code default |
| Paid placement              | DEV Ads, Takeover, Challenges (partners@dev.to); Billboards via Pro Tools, org admin       | platform     |

DEV can change any Forem default in its admin settings; treat code values as the shape of the limit, not a guarantee.
