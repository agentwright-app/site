# Query pattern library

Templates, modifiers and expansion recipes for generating technical keyword candidates. Every generated candidate is still a candidate - it enters the map only once it carries demand evidence.

## Contents

- Modifier vocabulary
- Family templates
- Expansion recipes
- Error-string normalization
- Adoption-mode split
- Expansion traps

## Modifier vocabulary

A real developer query is a family template plus one or more modifiers. Use only the values that are true for the product.

| Modifier class    | Example values                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- |
| Language          | the languages you ship a client or example for                                     |
| Framework         | the web/app frameworks your users actually run                                     |
| Runtime / version | major versions still supported, plus the one being deprecated                      |
| Platform          | operating system, container, serverless, managed platform                          |
| Deployment mode   | local, self-hosted, cloud, air-gapped                                              |
| Stage             | development, staging, production, CI                                               |
| Qualifier         | `example`, `not working`, `slow`, `without <dependency>`, `best practice`, `limit` |

## Family templates

**Error string.** The message verbatim, the numeric or symbolic code, a distinctive stack frame, and the message with the variable part stripped. Developers paste; they do not paraphrase.

**Task how-to.** `how to <task> in <language>`, `<product> <task> <framework>`, `<task> with <product> example`, `<product> <task> without <dependency>`.

**Integration intent.** `<product> <other product> integration`, `connect <product> to <other product>`, `<product> with <other product>`, `send <data> from <product> to <other product>`. The expansion set is your integration catalogue, not a generic vendor list.

**Comparison.** `<product> vs <competitor>`, `<competitor> alternative`, `alternatives to <competitor>`, `<product> or <competitor> for <use case>`, `<open-source thing> vs <hosted thing>`.

**Concept.** `what is <concept>`, `<concept> explained`, `why <constraint>`, `<concept> vs <adjacent concept>`.

**Reference lookup.** `<library> <symbol>`, `<api> <endpoint> example`, `<config key> default`, `<cli command> flags`.

**Migration.** `migrate from <competitor> to <product>`, `upgrade to <version>`, `<feature> deprecated`, `<old api> replacement`.

**Evaluation.** `<product> rate limits`, `<product> pricing`, `self-host <product>`, `<product> SOC 2`, `<product> data residency`, `<product> SLA`.

## Expansion recipes

1. **Error catalogue × supported versions.** Start from the product's own error definitions, not from tickets (this covers failures nobody reported yet). Cross with versions only where the message text actually changed.
2. **Task inventory × language × framework.** Build the task inventory from what the quickstart and how-to sections already promise, plus the tasks support keeps explaining. Cross with the top two or three language/framework combinations, not all of them; a cell with no shipped example cannot be answered credibly.
3. **Integration catalogue × direction.** Each integration produces at least two intents (pulling data in and pushing data out) and they are different pages when the setup differs.
4. **Competitor set × use case.** Only competitors a real evaluator names. Crossing with a use case is what makes a comparison page defensible instead of generic.
5. **Public API surface × "example".** Reference lookups are mostly owned by upstream docs; the winnable cell is the one where the official page shows a signature but no working example.

## Error-string normalization

Cluster before counting, or one cause becomes ten targets.

1. Replace absolute paths, UUIDs, hashes, timestamps, port numbers, quoted identifiers and stack line numbers with placeholders.
2. Trim the framework's wrapper text and keep the innermost cause.
3. Group by the normalized string; keep the two or three most frequent raw phrasings as variants, because those are what people paste.
4. Count per cluster and per time window. A cluster that appeared after the last release is a regression signal to route to engineering, not a docs gap.
5. Rank surviving clusters by frequency × time-to-resolve × whether a reader can self-serve the fix. A frequent error only support can fix belongs in the product, not in a page.

## Adoption-mode split

|                      | Individual adoption                  | Company adoption                           |
| -------------------- | ------------------------------------ | ------------------------------------------ |
| Dominant families    | error, task, concept, reference      | evaluation, comparison, migration          |
| Wording              | first person, mid-task, error-pasted | formal, checklist-shaped, risk-shaped      |
| Searcher             | the user, not the buyer              | a champion assembling an internal case     |
| Observed volume      | high                                 | very low                                   |
| Value per query      | low                                  | high                                       |
| Best evidence source | docs search, issues, community       | sales and solution-engineer question lists |

Give each mode its own target count. A single ranked list always resolves in favour of the individual set.

## Expansion traps

- Generating cells for technologies you do not officially support: the page cannot be kept working, and a broken example costs more credibility than the traffic is worth.
- Treating every phrasing variant as a separate target instead of a variant column on one cluster.
- Letting a version number into a keyword without a review date attached.
- Expanding comparison queries against competitors nobody evaluates you against, which produces pages that only advertise the competitor.
- Assuming one intent per phrasing. `<product> timeout` is an error for one reader and a configuration lookup for another; check what the current results answer before routing it.
