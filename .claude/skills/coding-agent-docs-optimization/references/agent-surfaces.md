# Agent-facing documentation surfaces

Each surface, its format, what it unblocks, and when it is not worth building.

## Table of Contents

- [Access before discovery](#access-before-discovery)
- [Index file](#index-file)
- [Getting started](#getting-started)
- [Reference](#reference)
- [Optional](#optional)
- [Full-corpus bundle](#full-corpus-bundle)
- [Markdown endpoints](#markdown-endpoints)
- [Machine-readable specs](#machine-readable-specs)
- [SDK source as a surface](#sdk-source-as-a-surface)
- [Version and deprecation signals](#version-and-deprecation-signals)
- [Terminal and package paths](#terminal-and-package-paths)
- [Advertising the surfaces](#advertising-the-surfaces)
- [Prioritization](#prioritization)

## Access before discovery

Check first that the agents you are optimizing for can fetch the pages at all. Every surface below is wasted effort behind a crawler policy that refuses the request, and this failure is silent - the audit sees a well-built index, the agent sees a challenge page.

Two layers, often owned by different teams:

- **Signalling.** `robots.txt` now carries per-agent rules, and the named user-agents split training crawlers from the search-and-fetch agents a docs site usually wants to admit. Allowing one while denying the other is a deliberate, common choice; making it by accident is not. An IETF working group is standardizing a richer vocabulary attached to a response header and to `robots.txt`, but the draft is not final - track it rather than depend on it.
- **Enforcement.** Signalling is honour-system: it constrains a compliant crawler and nothing else. Only edge controls - a WAF, bot management, a paid-crawl gate - actually stop a fetch. The inverse matters more here: some CDNs block AI crawlers by default on new properties, so a docs site can ship every surface in this file and still fail every cold run until someone changes a dashboard setting.

Verify empirically rather than by reading policy. Fetch a docs page and the index with each agent user-agent string you care about, from outside your network. Record the status code in the surface inventory.

## Index file

A root-level markdown index telling an agent which documents to read, following the open `llms.txt` convention (llmstxt.org). Fixed structure, in order:

1. One H1 with the project name - the only required section.
2. A blockquote summary carrying the key facts about what the project is.
3. Optional heading-free paragraphs or lists for extra context.
4. Zero or more H2 sections, each a markdown list where every item is a link, optionally followed by `:` and a note.

An H2 section literally titled `Optional` is reserved: it marks links an agent may skip when working in a shorter context.

```markdown
# Acme Payments SDK

> Server-side SDK for charging cards, issuing refunds and verifying webhooks. Current major version: v4.

## Getting started

- [Install and authenticate](https://docs.example.com/install.md): package names per language, key setup, first request
- [Charge a card](https://docs.example.com/charge.md): complete runnable example with the error branch

## Reference

- [OpenAPI specification](https://docs.example.com/openapi.v4.json): full request/response schema, v4
- [Error codes](https://docs.example.com/errors.md): every error string, its cause, and its fix

## Optional

- [Architecture rationale](https://docs.example.com/design.md): why the client is stateless
```

Rules that matter more than the format:

- Point entries at markdown URLs, so following a link needs no HTML stripping.
- Write each note as a routing signal ("what will I find here"), not marketing copy.
- Generate it from the navigation source at build time. A hand-maintained index rots within two releases.
- Order sections by task frequency, not by site hierarchy.
- Keep it an index. Once it grows past roughly 100k characters, split it into child indexes and link those, so an agent can descend instead of truncating.

## Full-corpus bundle

One file concatenating every page's title, URL, description, and full markdown body, published beside the index. It exists to be pasted wholesale into a context window.

Publish it when the corpus fits comfortably inside a working context budget alongside the user's own code. Skip it - or split it per product line - when it does not: a bundle that gets truncated mid-page is worse than no bundle, because the agent believes it read everything.

## Markdown endpoints

The highest value per hour of work: serve a clean markdown version of every page at a predictable URL. Two accepted conventions, both from the same spec:

- Append `.md` to the page URL.
- Replace the extension with `.md`.

Advertise them so an agent can find them without guessing:

- `<link rel="alternate" type="text/markdown" href="...">` on the HTML page.
- `<link rel="describedby" href="/llms.txt">` pointing at the covering index.
- A `Link` response header carrying the same relations, for agents that never parse the HTML.

Prepend a one-line pointer to the index at the top of each markdown page. An agent that lands mid-corpus from a search result then still finds its way to the map - a pattern visible today on several large vendor doc sites.

## Machine-readable specs

Anything already machine-parseable is ground truth an agent should never have to infer from prose:

- OpenAPI or AsyncAPI documents.
- GraphQL SDL.
- Protobuf definitions.
- JSON Schema.
- Published type declarations.

Rules for serving them:

- Serve them at a stable, versioned URL and link them from the index.
- Keep them generated from the implementation, never hand-edited.
- Fill in `description` and `example` fields - an agent reads them as the contract, and an empty description is where invented parameters come from.
- Prefer one spec per major version over one spec with conditional prose.

Which fields to fill, and how they differ from the same fields written for a human or for SDK generation, is the subject of the spec-annotation reference listed in SKILL.md. Publishing an unannotated spec buys less than it looks like it does.

## SDK source as a surface

Web docs and SDK source are two different surfaces reaching two different agents.

- A research agent fetches pages.
- An in-editor completion tool assembles context from the file being edited and its neighbouring open files.

The signature and its adjacent doc comment are what that second agent most reliably sees. A reference page three hops away is invisible to it.

- Write doc comments in the language's native convention, since that is what tooling and models expect: docstrings plus type hints in Python, `///` in Rust, JSDoc/TSDoc, `//` above the declaration in Go, Javadoc tags in Java.
- Type the signature fully and name things descriptively. arXiv 2403.12671 measured this: meaningful names plus docstrings beat name-only and dummy-name baselines for completion quality.
- Prefer doc-comment examples the toolchain compiles and runs, where the language supports it - a Rust doctest cannot rot without failing the build.
- Audit the generated SDK's method names and docstrings as a cheap proxy for spec quality when the SDK is generated from the spec: every naming and description weakness in the spec shows up there.

## Version and deprecation signals

- Publish a machine-resolvable "current version" pointer the agent can fetch in one request.
- Carry the version inside each page (frontmatter or a first-line note), because pages get read out of navigation context.
- Label deprecated surface at the top of the page with the replacement call. Models trained on older corpora reproduce removed APIs confidently, and only an in-page label overrides that prior.
- Keep previous major versions reachable at distinct URLs rather than overwriting them.

## Terminal and package paths

Agents work in a shell more often than in a browser. Two paths remove a whole class of fetch failures:

- A documentation command in your CLI that prints the relevant page as markdown to stdout.
- Docs shipped inside the package itself, so an installed dependency carries its own reference offline.

Optional integration note: vendors increasingly also publish an installable skill for their own SDK and expose a machine-readable catalogue of those skills at a well-known path. Treat this as a distribution channel for the same content, not as a substitute for the surfaces above - the content has to be right first.

## Advertising the surfaces

Publishing is half the job; nothing fetches a file it does not know about. Advertise in at least three places:

- A line in the repository README naming the index URL and the markdown-endpoint convention.
- A visible entry in the documentation navigation, so a human can hand the URL to their agent.
- Response headers and link relations, for tooling that never renders the page.

Be honest about reach: an agent typically fetches these because a human, a rules file, or a tool pointed at them. Treat every surface as advertised inventory, not as passive discovery.

## Prioritization

The build order lives in SKILL.md § Which surface to build first, next to the decision it serves. It is a judgement about effort against impact, not a measured ranking - reorder it if your own cold run says otherwise, and record what the run showed.

This file describes what each surface is and when it fails to earn its keep; it does not carry a second ordering.
