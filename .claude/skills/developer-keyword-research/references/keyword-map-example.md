# Keyword map: worked example and counter-example

The example below is illustrative, built around a fictional managed job-queue product ("Quebase") with Node.js, Python and Go clients. Numbers are placeholders for the shape of the evidence, not benchmarks to reuse.

## Contents

- Positive example
- Counter-example that fails the threshold
- Why the difference matters
- Error normalization: right and wrong

## Positive example

```markdown
# Keyword map: Quebase - Q3 docs and content targets

## Scope

Axes: languages Node.js / Python / Go; runtimes v3 (current) and v2 (deprecated 2026-12);
deployment self-hosted and cloud. Adoption mode: both, with a separate company-adoption set.
Owned surfaces: docs site, engineering blog, repository, changelog.
Sources used: search-console export 2026-08-20 (16 months); docs search log 2026-08-20 (90 days);
support export 2026-08-19; issue tracker; error telemetry.
Sources unavailable: community Discord archive (no export access) - tier 5 marked partial.

## Ranked clusters

Sorted by outcome per page-hour, highest first. The two error entries lead because the fix is already written in the tickets; the migration guide sits at P2 despite being the largest single outcome on the map, because it costs a few days of borrowed engineering time (that demotion is the ranking working, and it reverses the quarter a rival ships a breaking major).

| Cluster                     | Primary query                         | Variants                                                     | Family      | Evidence                                                                   | Incumbent                                    | Target surface                   | Existing URL or new         | Priority |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------- | --------------------------- | -------- |
| Job stuck in `pending`      | quebase job stuck pending             | "jobs not processing", "worker idle pending"                 | Error       | 214 docs searches / 90d (2026-08-20); 38 tickets; 1.9k error events        | none (no page exists)                        | Error entry                      | new                         | P1       |
| Visibility-timeout exceeded | `VisibilityTimeoutExceeded`           | "error 409 visibility", "job retried twice"                  | Error       | 6.1k error events / 30d; 22 tickets; 0 impressions                         | forum thread from 2024, answer predates v3   | Error entry                      | new                         | P1       |
| Retry with backoff in Node  | how to retry failed jobs quebase node | "exponential backoff quebase", "retry policy nodejs"         | Task        | 340 impressions, avg position 12 (striking distance); 11 community threads | our own blog post, v2 syntax                 | How-to guide                     | update /docs/guides/retries | P1       |
| Quebase with Django         | quebase django integration            | "celery to quebase django", "django background jobs quebase" | Integration | 190 impressions, avg position 17; 14 tickets                               | competitor's tutorial                        | Integration guide                | new                         | P2       |
| v2 to v3 upgrade            | upgrade quebase v2 to v3              | "quebase v3 breaking changes"                                | Migration   | 96 docs searches / 90d; 27 issues                                          | our changelog only                           | Migration guide (review 2026-12) | new                         | P2       |
| Idempotency semantics       | are quebase jobs exactly once         | "at least once vs exactly once queue"                        | Concept     | 58 impressions, avg position 24; 9 tickets                                 | encyclopedic article, no product consequence | Explanation page                 | new                         | P3       |

## Company-adoption set

| Cluster                    | Primary query          | Family     | Evidence                                            | Incumbent                | Target surface    | Priority |
| -------------------------- | ---------------------- | ---------- | --------------------------------------------------- | ------------------------ | ----------------- | -------- |
| Throughput and rate limits | quebase rate limits    | Evaluation | 12 sales questions logged / quarter; 41 impressions | pricing page, no numbers | Limits page       | P1       |
| Self-hosting requirements  | self-host quebase      | Evaluation | 9 sales questions; 63 impressions, avg position 9   | our README, incomplete   | Trust/limits page | P1       |
| Quebase vs Sidekiq Pro     | quebase vs sidekiq pro | Comparison | 5 sales questions; 88 impressions, avg position 19  | competitor's own page    | Comparison page   | P2       |

## Fix first

- `/docs/guides/retries` and `/blog/retry-patterns` both rank for "quebase retry policy" - canonicalize on the guide, link from the post.
- v2 and v3 copies of the concurrency page are near-duplicates competing for the same phrasing.

## Do not target

- "quebase pricing calculator" - no such feature; cannot answer honestly.
- `ECONNRESET during shutdown` - 4.2k events, but the fix is a graceful-shutdown change shipping in v3.4; routed to engineering, not to docs.
- "python asyncio tutorial" - owned by the language's own documentation.

## Backlog (parked 2026-08-26)

- Kubernetes operator install path - evidence exists (31 docs searches) but no supported operator yet.
- Go generics migration - 12 issues, below the P3 evidence floor this quarter.
```

## Counter-example that fails the threshold

```markdown
| Keyword                   | Volume | Difficulty | Priority |
| ------------------------- | ------ | ---------- | -------- |
| job queue                 | 14,000 | 71         | P1       |
| background jobs           | 8,100  | 64         | P1       |
| message queue software    | 3,600  | 58         | P2       |
| quebase job stuck pending | 0      | 3          | drop     |
| VisibilityTimeoutExceeded | 0      | -          | drop     |
```

Four defects, one per line of the threshold:

- Evidence is a single tool's estimate, unattributed and undated, so nothing can be audited.
- Zero first-party evidence, so the list would look identical for any competitor.
- Ranked on volume alone, which is exactly why the two highest-frequency real failures were dropped.
- No target surface, no cannibalization pass, no refusals (nothing tells a writer which page to open).

The head terms it promotes are category words that a job-queue startup cannot win and that no developer types while blocked.

## Why the difference matters

The first map is auditable: a reviewer can re-pull each count and check the date. It also routes to docs, not only to the blog, which is where most technical demand belongs. The second map is portable to any product in the category (which is the clearest sign no research happened).

## Error normalization: right and wrong

Six raw ticket subjects from the same week:

```
connection to postgres://prod-db-7:5432 refused after 30s
connection to postgres://staging-db:5432 refused after 30s
Error: connect ECONNREFUSED 10.4.2.19:5432
worker cannot reach database, connect ECONNREFUSED
db connection refused in production
psycopg2.OperationalError: connection refused
```

**Wrong - one target per phrasing:**

| Keyword                                      | Evidence |
| -------------------------------------------- | -------- |
| connection to postgres prod-db-7 refused     | 1 ticket |
| connection to postgres staging-db refused    | 1 ticket |
| ECONNREFUSED 10.4.2.19                       | 1 ticket |
| worker cannot reach database                 | 1 ticket |
| db connection refused in production          | 1 ticket |
| psycopg2 OperationalError connection refused | 1 ticket |

Six thin pages compete with each other, each carrying evidence too weak to rank anything, and two of the "keywords" contain a host and an IP nobody else will ever search.

**Right - one cluster per cause:**

| Cluster                     | Primary query                             | Variants                                                                                                       | Evidence                                                                 |
| --------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Database connection refused | `ECONNREFUSED` connecting to the database | "connection refused after 30s", "psycopg2 OperationalError connection refused", "worker cannot reach database" | 6 tickets / 7d (2026-08-20, Measured); 812 error events / 30d (Measured) |

One page, evidence strong enough to rank, and the variants column keeps the exact strings people paste. Normalization did the work:

- Hosts, IPs, ports and timeouts became placeholders.
- The client-library wrapper text was trimmed to the innermost cause.
- The two most common raw phrasings were kept as variants.

Two checks before you accept a merge like this:

- Confirm the cause really is one (the same message from a firewall rule and from a wrong password are two pages, however identical the string).
- Confirm the cluster is a docs gap rather than a regression: six tickets in one week, all after a release, is a signal for engineering first.
