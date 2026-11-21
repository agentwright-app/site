# Published findings and self-set baselines

Every number and named convention this skill quotes, with its source. Read this before repeating a figure to a user, and quote its source with the figure.

## Contents

- Sourced figures
- Reused conventions, not standards
- Baselines this skill sets itself
- Keeping the figures current

## Sourced figures

| Claim                                                                         | Figure                                                                                                                                                | Source                                                                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Most keywords sit below any usable volume                                     | ~93% of the U.S. keyword database has fewer than 10 monthly searches (2.3 billion terms, against fewer than 18,000 above 100k)                        | ahrefs.com/blog/long-tail-keywords                                                                 |
| Conversational phrasings are mostly unmeasured                                | over 95% have no measurable volume                                                                                                                    | same page                                                                                          |
| Reported volume merges distinct queries                                       | Keyword Planner averages the last 12 months, reports a keyword _and its close variants_, and rounds                                                   | support.google.com/google-ads/answer/3022575                                                       |
| A query export is truncated by default                                        | Search Analytics `rowLimit` accepts 1–25,000, defaults to 1,000                                                                                       | developers.google.com/webmaster-tools/v1/searchanalytics/query                                     |
| Position cannot be filtered server-side                                       | position is a returned metric; the filterable dimensions are country, device, page, query, searchAppearance, date, hour                               | same reference                                                                                     |
| Not every row comes back                                                      | "does not guarantee to return all data rows but rather top ones"                                                                                      | same reference                                                                                     |
| Totals do not reconcile                                                       | chart and table totals differ through property-vs-page aggregation                                                                                    | support.google.com/webmasters/answer/7576553                                                       |
| Assistant use is near-universal among developers                              | 84% of respondents use or plan to use AI tools                                                                                                        | Stack Overflow Developer Survey 2025, AI section (49,000+ respondents)                             |
| Wrong-but-plausible answers are the top complaint                             | 66% name "AI solutions that are almost right, but not quite"                                                                                          | same survey                                                                                        |
| Distrusted answers send developers back to humans                             | 75.3%                                                                                                                                                 | same survey                                                                                        |
| Trust in AI answers is falling even as usage rises                            | 29% of 2025 respondents trust AI, down from roughly 40% in 2023                                                                                       | Stack Overflow Blog, "Mind the gap: Closing the AI trust gap for developers," published 2026-02-18 |
| Assistants are displacing the search step itself, not just search results     | "Searching for development-related information on the internet" ranks second among tasks developers delegate to AI, after writing boilerplate code    | JetBrains State of Developer Ecosystem 2025 survey (24,534 respondents, fielded April-June 2025)   |
| A page still earns its keep without the click                                 | "Fewer visits, but the same level of influence for the website… all of them rely on the information that they crawl from your website" - Rand Fishkin | sparktoro.com, "Does Your Website Still Matter in the Zero-Click Era?", published 2026-08-14       |
| Capturing knowledge during the fix, then restructuring it for the next reader | the solve loop and evolve loop, with the issue/environment/cause/resolution article shape                                                             | Knowledge-Centered Service, Consortium for Service Innovation                                      |
| Markup no longer buys SERP real estate for troubleshooting pages              | FAQ rich results stopped appearing on 7 May 2026; documentation removed June 2026                                                                     | Google Search Central FAQ structured-data page                                                     |

Two claims in this skill are documented behaviour without a figure attached:

- Search Console withholds rare queries for privacy.
- Query-level rows must not be summed into site totals.

State them as behaviour, never as a quantified loss.

## Reused conventions, not standards

These are widely reused keyword-research conventions. They are usable defaults rather than measured findings - attribute them that way.

- **Shared-top-10 merge thresholds** (7-10 one page, 4-6 one cluster, 2-3 cross-link, 0-1 unrelated): a widely reused convention, not a measured cut-off.
- **Striking distance = average position 5-20**, filtered client-side because the API sorts by clicks: a widely reused convention for identifying queries in striking distance below ranking. The window is not a measured cut-off.
- **Measured / User-provided / Estimated labelling**, with `N/A` for anything unavailable: a classification system applied across research workflows to distinguish evidence quality.
- **Weighted difficulty scores** (top-10 authority 25%, page authority 20%, content bar 20%, backlinks 20%, stability 15%): a link-graph model. Listed here so you recognise it, not to adopt it - four of its five inputs model a link graph, and technical results are usually held by a stale community answer that loses to completeness rather than to authority.
- **Golden-set query diagnosis** (roughly 50 representative queries drawn from popular and zero-result searches, classified by intent, retested after every fix): a search-quality diagnostic practice documented in Algolia's own engineering guidance for content-heavy sites, not a universal standard for every docs search tool.

## Baselines this skill sets itself

Say "our baseline" when you report these, and adjust them to the product's data situation rather than defending them as standards:

- **70% of ranked clusters must draw top evidence from tiers 1-4.** Raise it for a product with rich first-party data; lower it explicitly, in the Scope section, for a pre-launch product that has almost none.
- **The eight-tier ordering of demand sources.** The tiers reflect how directly each source observes a developer asking, and the ordering is a judgement rather than a measured ranking.
- **"A question asked three times is a missing page; asked thirty times it is a docs or product defect."** A working rule of thumb from support-signal practice rather than a measured threshold.
- **Rank order: evidence tier, then business proximity, then winnability, then maintenance cost.** A judgement about what matters for a devtool, not a scoring formula to defend.

## Keeping the figures current

Re-read a row against its source before quoting it in a map: survey waves, help-page wording and API limits all move. If the source has changed, update the row and the number in `SKILL.md` together; a figure that no longer matches its source is worse than no figure, because it looks verified.
