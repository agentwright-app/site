# Pricing changes that went public

Contents: eleven documented changes and their outcomes · the shape shared by the backlash cases · a negative example worked through · the positive counterpart.

Every row below is a real, dated change with a public reaction. Use them instead of a hypothetical warning: a founder who has read the Unity timeline argues differently from one who has read "be careful with price rises".

## The corpus

| Company        | Date                                   | Change                                                             | Reaction                                                                 | Outcome                                                                                                           |
| -------------- | -------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Heroku         | announced Aug 2022, effective Nov 2022 | removed all free dynos, Postgres and Redis                         | large community backlash; third-party migration guides proliferated      | held; paid Eco/Mini tiers introduced                                                                              |
| Netlify        | Feb 2024                               | $104K bandwidth bill after a traffic spike on a free-tier site     | viral on Reddit and Hacker News                                          | bill forgiven; standing no-charge-for-legitimate-mistakes policy stated                                           |
| PlanetScale    | Mar-Apr 2024                           | retired the free Hobby tier, alongside layoffs                     | strong backlash, largely about tone                                      | held; a $5/month tier added Oct 2025                                                                              |
| GitHub Copilot | Jun 2025, then Jun 2026                | premium requests, then a full move to usage-based billing          | community FAQ thread with 435 comments, 904 downvotes against 22 upvotes | base prices held; annual plans grandfathered to expiry                                                            |
| Unity          | Sep 2023                               | per-install Runtime Fee                                            | severe backlash, reported death threats, office closures                 | public apology and major walk-back: Personal tier exempted, cap raised, no retroactive application                |
| HashiCorp      | Aug 2023                               | Terraform et al. relicensed MPL 2.0 → BSL 1.1                      | OpenTF Manifesto, 32,000+ GitHub stars                                   | OpenTofu fork adopted by the Linux Foundation; a cease-and-desist failed                                          |
| Redis          | Mar 2024                               | BSD → dual SSPLv1/RSALv2                                           | Valkey forked within days, backed by AWS, Google, Oracle, Ericsson, Snap | AGPLv3 added back in Redis 8.0 (May 2025); Redis said the change "hurt our relationship with the Redis community" |
| Sentry         | 2019, then Nov 2023                    | BSD-3 → BSL, then the Functional Source License                    | mixed                                                                    | FSL kept, framed as "freedom without free-riding"                                                                 |
| Docker         | Aug 2021                               | Docker Desktop paid for businesses ≥250 employees or ≥$10M revenue | backlash over the short effective date                                   | held; still free for personal, education and non-commercial OSS use                                               |
| Vercel         | 2024-2025                              | four compute-pricing model changes in ~20 months                   | continuing discussion about bill complexity                              | Active CPU pricing is the current model                                                                           |
| Datadog        | 2022-2023                              | a large usage-based bill became a public story                     | Hacker News threads                                                      | addressed on earnings calls rather than reversed                                                                  |

## What the worst cases have in common

Short notice, every tenant moved onto the new model at once, and a user base technically capable of imposing real costs back. The strongest evidence that this is not merely noise is the set of cases where the community changed the outcome:

- HashiCorp could not suppress OpenTofu even with legal action.
- Valkey's cloud-vendor backing drove Redis to re-add AGPLv3 about a year later.
- Unity reversed outright under an organised threat of engine migration.

Note the counterexamples in the same table. Heroku, PlanetScale and Docker all absorbed loud backlash and held their changes.

Backlash alone does not force a reversal - a credible substitute does. Before assuming a change is unsurvivable, ask whether the affected users have somewhere to go.

## Negative example: the change most likely to be attempted

**What a team writes.** "We're moving the audit log to the Business tier next month. It's been free since launch, but it's an enterprise feature and it costs us storage. Existing customers move on their next renewal."

Why this fails, point by point:

- It takes back a capability customers already build on. New paid capabilities are legitimate; retroactive gating is the move that produces forks and front-page threads.
- One month is not notice for anything a budget covers.
- The justification is the vendor's cost, not the customer's value. Cost justifications invite the customer to compute your margin, and developers will.
- "Next renewal" is a grandfathering decision made implicitly, with no end date stated and no cohort named.
- Nobody is assigned to the public thread, and no concession is pre-approved.

Unity is the sourced version of this failure, and the specific detail worth carrying: the Runtime Fee's core problem was not the fee but that it reversed an explicit 2019 commitment to charge "a flat fee per-seat, not a royalty on all of your revenue". Breaking a stated pricing promise reads as materially worse than an ordinary increase.

**The same intent, written to survive.** Keep the audit log where it is for every existing account, indefinitely, and say so. Introduce the _new_ governance capability - retention beyond 30 days, export to a customer-owned bucket, tamper-evident storage - at the Business tier, priced against the storage it actually consumes. Announce a quarter ahead, name the three cohorts (free, self-serve, contracted) with what changes for each, publish the FAQ with the announcement, and decide in advance who answers the thread and what they may concede.

## Positive example: what a good response to bill shock looks like

Netlify's $104K bill came from 190TB of traffic hitting a 3MB file on a free-tier site at $55/100GB overage - the canonical missing-spend-cap failure. The response is the citable part: forgive the bill, and state a standing policy of not shutting down free sites during traffic spikes while forgiving bills from legitimate mistakes after the fact.

Two things to take from it:

- The credit is always cheaper than the story - write the runaway-usage policy before you need it.
- A goodwill credit is a patch on a design defect, not a substitute for the cap, the alert and the anomaly detection that would have prevented it.
