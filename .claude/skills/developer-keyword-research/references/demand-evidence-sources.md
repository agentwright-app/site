# Demand evidence sources

What each source measures, how to extract it, and how it lies. Cite source, count and date for every evidence item in the keyword map.

## Contents

- Why tool volume is last
- Tier 1: first-party query data
- Tier 2: docs-site search logs
- Tier 3: support and issue corpora
- Tier 4: product error telemetry
- Tier 5: public Q&A and forums
- Tier 6: ecosystem counters
- Tier 7: autocomplete and related searches
- Tier 8: keyword tools
- Optional tool-integration note

## Why tool volume is last

Ahrefs reports that keywords with fewer than 10 monthly searches make up roughly 93% of its U.S. keyword database (2.3 billion terms, against fewer than 18,000 above 100k searches) and that over 95% of conversational long-tail phrasings have no measurable volume at all (ahrefs.com/blog/long-tail-keywords, updated 2026-05-27). Google's own keyword planner averages the last twelve months, reports the figure for a keyword _and its close variants_, and rounds the result (support.google.com/google-ads/answer/3022575).

So a reported 0 means the tool's index has nothing, and a reported 90 may be ten different error strings merged. Neither number can rank a technical list.

## Tier 1: first-party query data

**Measures** real impressions and clicks for real phrasings on pages you own, including strings no tool lists.

**Extract**:

- Export queries with impressions, clicks and average position for the longest window available.
- Isolate average position 5-20 as the striking-distance set.
- Join query to landing page to expose two of your own pages splitting one query.

Ask for the largest row count the export allows. Google's Search Analytics API accepts 1 to 25,000 rows and defaults to 1,000, and it exposes position as a metric with no position filter, so the 5-20 window has to be cut client-side after a wide pull sorted by clicks. Its own reference states it "does not guarantee to return all data rows but rather top ones".

**Bias**:

- Only shows queries you already rank for at all, so it cannot surface an uncovered topic.
- Rare queries are withheld for privacy, so the visible long tail is a floor, not a total, and query rows must never be summed into a site total.
- Chart and table totals in the same report can also differ, through property-versus-page aggregation.

## Tier 2: docs-site search logs

**Measures** what a reader types once already on your property - the purest statement of an unmet need.

**Extract**:

- Top queries by volume.
- Queries returning zero results.
- Queries whose top click is not the answer (high search-refinement or immediate re-query).

**Diagnosing failures**: curate roughly 50 representative queries from the popular and zero-result lists into a golden set, classify each by intent (exact lookup, navigational, task-oriented, concept, broad, version-or-variant), and retest the set after every fix - a search-quality diagnostic practice documented in Algolia's own engineering guidance, not a universal standard. Adapt the sample size to the site's real query volume.

**Bias**: only covers people who found the docs; scoped to your vocabulary, so it under-reports the words newcomers use.

## Tier 3: support and issue corpora

**Measures** questions expensive enough that someone asked a human.

**Extract**:

- Ticket subjects and first customer messages.
- Issues labelled question/support/docs, including those closed as configuration.
- Locked and duplicated threads.
- Recurring community questions.

**Bias**: public-only projects have no ticket corpus at all, while enterprise products hide their loudest failures in private tickets. Mining only public sources under-serves exactly the accounts that pay.

## Tier 4: product error telemetry

**Measures** failures that occur, whether or not anyone reported them - the only source that reveals silent demand.

**Extract**: error-code counters by frequency and by trend across releases; the distribution of affected versions.

**Bias**: measures occurrence, not search. A frequent error users retry past without searching produces no query at all.

## Tier 5: public Q&A and forums

**Measures** question counts, view counts and answer quality on the results you would have to displace.

**Extract**:

- Question count per tag or topic.
- View counts on the top threads.
- The age of the accepted answer (a stale accepted answer is the strongest winnability signal available for free).

**Bias**: skews to individual adopters and to older, larger language communities. Answer volume also reflects historical activity rather than current demand.

## Tier 6: ecosystem counters

**Measures** the size of the population that could search a term: package downloads, repository dependents, framework version adoption.

**Extract**: download trend per package and per major version; dependent counts.

**Bias**: sizes an audience, never a query. Automated traffic inflates registry downloads, so use trend and relative comparison rather than absolute counts.

## Tier 7: autocomplete and related searches

**Measures** how a query is worded, from the search interface's own suggestions and related-question boxes.

**Extract**: seed a family template plus one modifier and record the suggestions; repeat across the modifier set. If your environment cannot browse, ask the user to paste suggestions for the five most important seeds instead of skipping the step.

**Bias**: suggestion lists are personalized and location-dependent, and they say nothing about frequency. Treat every harvested phrase as a candidate needing evidence from a higher tier.

## Tier 8: keyword tools

**Measures** an estimated volume and a link-graph difficulty score.

**Use**: only to break ties between candidates that already have first-party evidence, and to catch a genuinely high-volume category term the internal signals missed.

**Bias**: see the section above. Difficulty scores model link graphs, not whether a five-year-old forum answer can be out-completed.

## Optional tool-integration note

Nothing in this skill requires a specific product. When one of these is available, it maps onto the tiers as follows:

- Google Search Console, Bing Webmaster Tools, or a self-hosted analytics query report → tier 1.
- Algolia DocSearch analytics, Typesense or Meilisearch analytics, or the docs generator's built-in search log → tier 2.
- Zendesk, Intercom, Freshdesk exports and the GitHub/GitLab issue APIs → tier 3.
- Sentry, Datadog or the product's own metrics backend → tier 4.
- Stack Exchange API, Discourse search, Reddit and Discord archives → tier 5.
- npm, PyPI, crates.io, Packagist, Maven Central, Docker Hub statistics and the GitHub dependents graph → tier 6.
- Ahrefs, Semrush, Moz, Google Keyword Planner → tier 8.

Record which of these you actually used, with the export date, in the map's Scope section. A reader cannot judge a keyword map without knowing which tiers were reachable.
