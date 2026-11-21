# Page rewrite patterns

Before/after pairs for the failures that cost the most first-attempt successes. Each pattern names the agent behaviour it corrects.

Contents: [Self-containment](#self-containment) · [Snippet completeness](#snippet-completeness) · [Naming discipline](#naming-discipline) · [UI paths](#ui-paths) · [Error mapping](#error-mapping) · [Version labelling](#version-labelling) · [Answer-first ordering](#answer-first-ordering) · [Page frontmatter](#page-frontmatter)

## Table of Contents

- [Self-containment](#self-containment)
- [Snippet completeness](#snippet-completeness)
- [Naming discipline](#naming-discipline)
- [UI paths](#ui-paths)
- [Error mapping](#error-mapping)
- [Version labelling](#version-labelling)
- [Answer-first ordering](#answer-first-ordering)
- [Page frontmatter](#page-frontmatter)

## Self-containment

An agent usually arrives mid-corpus, from a search result or a pasted URL. Backward references point at context it never loaded.

Avoid:

> Using the client you configured in the previous section, call `charge()` with the amount in cents.

Prefer:

````md
Requires an initialized client (see Install and authenticate) and a secret key with `charges:write`.

```python
from acme import Client            # acme>=4.2,<5

client = Client(api_key=os.environ["ACME_API_KEY"])
charge = client.charges.create(amount_cents=1999, currency="eur", source="tok_visa")
print(charge.id, charge.status)    # ch_1A2B3C succeeded
```
````

The prerequisite is restated, the forward link stays for the human, and the snippet no longer depends on a page the agent skipped.

## Snippet completeness

An incomplete snippet is not treated as an excerpt - it is pasted as-is, and the missing parts get invented.

Avoid:

```js
const result = await client.customers.list({ limit: 100 });
```

Prefer:

```js
// acme-node@^4.2  - npm i acme-node@^4.2
import { Client } from "acme-node";

const client = new Client({ apiKey: process.env.ACME_API_KEY });

try {
  // Returns { data: Customer[], has_more: boolean, next_cursor: string | null }
  const page = await client.customers.list({ limit: 100 });
  console.log(page.data.length, page.has_more);
} catch (err) {
  if (err.code === "rate_limited") {
    // Retry after err.retry_after seconds; see Rate limits.
  }
  throw err;
}
```

The block the agent copies now carries:

- Imports.
- Version constraint.
- Auth source.
- The shape of the result.
- The error branch.

When a fragment genuinely cannot run on its own, say so on the line above it - an unlabelled fragment is indistinguishable from a complete example:

```md
Illustrative fragment - not runnable on its own; see the full example above.
```

## Naming discipline

`client`, `sdk`, `acme`, and `handle` read as four different objects to an agent building a mental model from examples.

- Pick one identifier per concept and use it in every language sample and every page.
- Use one placeholder convention corpus-wide (`<YOUR_API_KEY>`), so a single substitution rule covers everything.
- Disambiguate overloaded nouns on first use per page: "a `Session` here is a checkout session, not an HTTP session."

## UI paths

An agent cannot click, and cannot see a screenshot. A setup step that exists only as an interface walkthrough is a dead end.

Avoid:

> Open **Settings → API keys**, click **Create key**, and copy the value.

Prefer:

````md
Create a key from the dashboard (Settings → API keys → Create key), or from the CLI:

```bash
acme keys create --name "local dev" --scope charges:write
# prints: sk_test_… (shown once)
```
````

Both readers are served, and the agent has an executable path.

## Error mapping

Agents arrive by pasting the error string they just hit. Match that string exactly.

```md
### `invalid_signature: timestamp outside tolerance`

- Conditions: webhook endpoint behind a proxy that buffers requests, or a host clock skewed by more than 5 minutes.
- Cause: the signed timestamp is compared against system time with a 300-second tolerance.
- Fix: sync the host clock (NTP), or raise the tolerance with `constructEvent(payload, header, secret, { toleranceSeconds: 600 })`.
- Verify: replay the event with `acme webhooks resend <event_id>` and expect HTTP 200.
```

Cause, fix, and a verification step - an agent that cannot verify keeps retrying variations of the same call.

## Version labelling

Models carry confident memories of removed APIs. Only an in-page label overrides that prior.

```md
> **Deprecated in v4.** `client.charges.refund()` was removed. Use `client.refunds.create({ charge_id })`.
> Removal shipped 2026-03-01; v3 documentation stays at /v3/.
```

Put the label at the top of the page, not in a footnote - an agent that got its answer in the first paragraph never reaches the footnote.

## Answer-first ordering

Reference material buried under rationale forces extra fetches and invites guessing.

Order every task page:

1. The working call.
2. What it returns.
3. The parameters.
4. The rationale.

Keep parameters, limits, and enum values in tables. They survive chunking and truncation better than prose, and an agent reading half a table still reads whole rows.

## Page frontmatter

Machine-readable page metadata is what index generators and retrieval tools route on. Keep it uniform:

```yaml
---
title: Verify webhook signatures
description: Validate the signature header before trusting a webhook payload.
version: v4
languages: [node, python, go]
deprecated: false
---
```

The description doubles as the index entry's routing note, so write it as a statement of what the reader will find, not as a teaser.
