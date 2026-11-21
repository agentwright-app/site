# Annotating a machine-readable spec for agent consumption

A spec written for SDK generation and a spec written for agent consumption differ in a handful of fields. This file covers only those fields. Endpoint-level reference completeness, resource modelling and versioning strategy are API-design questions, not documentation ones.

Contents: [Why the spec outranks the prose](#why-the-spec-outranks-the-prose) · [Operation identifiers](#operation-identifiers) · [Summary versus description](#summary-versus-description) · [Constraining the value space](#constraining-the-value-space) · [Embedded samples](#embedded-samples) · [Curate before exposing](#curate-before-exposing) · [A negative example](#a-negative-example) · [AsyncAPI and bare JSON Schema](#asyncapi-and-bare-json-schema)

## Table of Contents

- [Why the spec outranks the prose](#why-the-spec-outranks-the-prose)
- [Operation identifiers](#operation-identifiers)
- [Summary versus description](#summary-versus-description)
- [Constraining the value space](#constraining-the-value-space)
- [Embedded samples](#embedded-samples)
- [Curate before exposing](#curate-before-exposing)
- [A negative example](#a-negative-example)
- [AsyncAPI and bare JSON Schema](#asyncapi-and-bare-json-schema)

## Why the spec outranks the prose

An OpenAPI, AsyncAPI, GraphQL SDL, protobuf or JSON Schema document is already parseable, already generated from the implementation, and already the contract. Every field an agent can read there is a field it never has to infer from a paragraph.

Published measurements back the priority. On Gorilla/APIBench, swapping a weak retriever for an oracle one moves API-call accuracy to 67.20% (TorchHub) and 91.26% (HuggingFace). Anthropic reports that "Claude Sonnet 3.5 achieved state-of-the-art performance on the SWE-bench Verified evaluation after we made precise refinements to tool descriptions, dramatically reducing error rates."

## Operation identifiers

`operationId` is the single highest-leverage field, because generators turn it into the agent-facing tool name. `openapi-to-mcp` resolves the name in this order:

1. `x-mcp-tool-name`.
2. `operationId`.
3. A `{method}_{path}` fallback.

It discards any tool whose name fails `^[a-zA-Z0-9_-]{1,64}$`.

FastMCP truncates `operationId` at the first `__`, slugifies it, and caps it at 56 characters. When `operationId` is absent, the fallback produces names like `get_api_v1_users_id` that tooling vendors describe as confusing models.

Rules:

- Give every operation an `operationId`. Verb-noun camelCase: `listCharacters`, `getUserById`, `createRefund`.
- Keep it to 30 characters or fewer and drop articles and conjunctions - APIMatic's guidance: "avoid using 'a', 'an', 'the', 'and', 'for' and similar words as they unnecessarily make names longer".
- Keep it unique and stable across releases; a renamed `operationId` silently renames a tool. Enforce uniqueness in CI (`redocly lint --rule operation-operationId-unique`).
- Use `x-mcp-tool-name` / `x-speakeasy-mcp` when the SDK wants a terse method name and the agent wants a descriptive one, rather than compromising on a single string.

## Summary versus description

The two fields do different jobs once the reader is choosing which call to make.

- `summary` - one imperative line. It drives disambiguation between similarly named operations.
- `description` - the operational contract:
  - Preconditions.
  - Side effects.
  - Idempotency.
  - Required auth scope.
  - Rate limits.
  - Response shape.
  - An explicit pointer to the sibling operation that might be a better fit.

Write both from the model's perspective, not a human browsing a reference page. A worked cross-reference line, from Speakeasy's tool-design guidance: "Use this endpoint when you need complete information about a task. If you only need a list of task IDs and titles, use listTasks instead."

Put a disambiguating example inside the description for any argument whose meaning is guessable-but-wrong: "`user_id` is the numeric user ID (e.g. 12345), not the username."

## Constraining the value space

An unconstrained field is where an invented value goes. OpenAI's function-calling guide states the principle directly: "Use enums and object structures to prevent invalid states" and "don't make the model fill arguments you already know."

- Prefer a closed `enum` over a free-form string wherever the value space is finite.
- Mark `required` explicitly instead of relying on convention.
- Supply `default` so the agent never has to guess a safe value.
- Use `format` keywords (`uuid`, `date-time`) rather than describing the shape in prose.
- Use `oneOf` with a `discriminator` so a polymorphic body resolves to one concrete variant.
- Add `x-enumDescriptions` where an enum value's meaning is not obvious from its spelling.

## Embedded samples

`x-codeSamples` attaches per-language snippets directly to an operation - each entry carries `lang`, `source` (inline or a `$ref` to a file), and `label`. This colocates the runnable example with the contract, so an agent reading the spec never needs a second fetch to see the call in context. Native `example` / `examples` cover request and response payloads.

## Curate before exposing

Publishing a spec is documentation. Converting it wholesale into a callable tool surface is not, and it fails at scale.

OpenAI's guidance: "Aim for fewer than 20 functions available at the start of a turn at any one time… Use tool search to defer large or infrequently used parts of your tool surface instead of exposing everything up front." FastMCP is blunter: models "achieve significantly better performance with well-designed and curated MCP servers than with auto-converted OpenAPI servers… especially true for complex APIs with many endpoints."

Working rule - this skill's own widening of OpenAI's figure, not separately sourced: past roughly 20-30 operations, tag-filter or use `x-mcp` extensions to expose only what agents actually need. Building and operating that tool server is product work - hand it to the platform-side skill named in `SKILL.md` § References.

## A negative example

Tempting, and wrong, because every field is technically filled:

```yaml
/v1/customers/{id}:
  get:
    summary: Get
    description: Returns the customer.
    parameters:
      - name: id
        in: path
        required: true
        schema: { type: string }
      - name: expand
        in: query
        schema: { type: string }
```

- No `operationId`, so the tool name becomes `get_v1_customers_id`.
- `summary` disambiguates nothing against the other eleven `Get` operations.
- `description` states no auth scope, no rate limit, and no alternative.
- `expand` is a free-form string whose accepted values exist only in prose elsewhere, so the agent invents one.

The same operation, agent-readable:

```yaml
/v1/customers/{id}:
  get:
    operationId: getCustomer
    summary: Retrieve one customer by ID
    description: >
      Returns the full customer object. Read-only, idempotent, no side effects.
      Requires a key with the `customers:read` scope. Rate limit: 100 req/s per key.
      Responds 404 with error code `resource_missing` when the ID does not exist.
      To fetch many customers, use `listCustomers` instead  - this endpoint accepts one ID.
    parameters:
      - name: id
        in: path
        required: true
        description: Customer ID returned by createCustomer, e.g. cus_9s6XKzkNRiz8i3  - not the email address.
        schema: { type: string, pattern: "^cus_[A-Za-z0-9]+$" }
      - name: expand
        in: query
        description: Sub-resources to inline in the response.
        schema:
          type: array
          items:
            type: string
            enum: [subscriptions, default_source, tax_ids]
```

## AsyncAPI and bare JSON Schema

AsyncAPI reuses JSON Schema for payloads and supports `title`, `description` and vendor extensions, so the rules above transfer to both by analogy. Say so when you apply them; do not present them with the confidence of the OpenAPI findings.

One concrete trap does hold across both: `$comment` is explicitly non-rendered and intended for schema maintainers. Anything an agent must see belongs in `description` or `examples`.
