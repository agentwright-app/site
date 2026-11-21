# Worked pricing memo, and weak versus strong sections

The product below is fictional and every number is invented. It exists to show the level of specificity a finished memo needs - not to supply benchmarks.

**Situation.** A team of nine runs a hosted service that replays production traffic against pre-release builds. There is an Apache-2.0 self-hostable engine with roughly 900 known deployments; the hosted service has 40 paying teams on a legacy per-seat price of $25/user/month. Revenue is flat while usage has tripled, because customers drive the product from CI rather than from the console.

---

## Pricing - Replayer Cloud

### Inputs

Model already chosen: hosted open source, with the engine staying Apache-2.0. Buyer: a platform or QA lead with a team budget; procurement enters above roughly $25k annual. Cost per unit: $0.021 per replay-hour of compute, plus $0.004/GB of captured traffic stored, plus about 0.4 support hours per account per month. Free alternative's true cost: self-hosting the engine on the customer's own cluster runs about $340/month of infrastructure for a mid-sized team, plus an estimated 6 engineer-hours a month of operation and upgrade work - call it $1,100/month all-in at their loaded rate.

### Value metric

**Replay-hours**, with a small seat component retained for console access. Replay-hours move exactly when the customer gets more value, teams already track them in their CI dashboards, and the number correlates with our dominant cost within 8%. Rejected: per-seat alone (the collapse we already have - seat count is flat at 4.2 per account while replay volume tripled); per-repository (uncorrelated: one monorepo dwarfs thirty small services); per-test-case (perverse - it pushes teams to bundle tests, which hides real usage); captured-traffic GB (a storage proxy, not a value proxy, and it punishes exactly the teams capturing the most useful data).

### Ladder

| Rung       | Contents                                                                                                                    | Price shape                                              | Trigger to climb                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Free       | self-hosted engine, or 20 hosted replay-hours/month, 7-day capture retention, community support                             | $0                                                       | exceeding 20 replay-hours, or needing retention past a week |
| Starter    | 200 replay-hours included, 30-day retention, 3 console seats, email support (2 business days)                               | $99/month + $0.34/replay-hour overage                    | a second team, or an admin who never runs replays           |
| Team       | 1,000 replay-hours included, 90-day retention, unlimited seats, roles, shared billing, basic SSO, 1 business day support    | $690/month + $0.29/replay-hour overage, 15% off annually | security review, residency, or an SLA requirement           |
| Enterprise | custom IdP + SCIM, granular RBAC, audit logs, EU/US residency, 99.9% SLA with credits, private deployment option, invoicing | starts at $30k/year, committed replay-hours at $0.21     | -                                                           |

### Free surface

20 replay-hours per month, 7-day retention, one project, no card. That comfortably covers a personal project and a proof of concept, and comfortably fails a team running replays on every pull request. Total marginal cost of the free surface at current signup rate: $1,850/month, 6% of paid gross profit; the agreed ceiling is 12%, reviewed quarterly. Abuse policy: 5 concurrent replays maximum, one free workspace per verified organisation domain, mining and load-generation workloads terminated on detection.

### Price points

Floor: $0.021/replay-hour marginal cost; at the 90th-percentile account (heavy captures, 3.1 support hours/month) the effective cost is $0.058. The 75% gross-margin target puts the metered floor at $0.23. Ceiling: self-hosting at $1,100/month for a team consuming ~1,000 replay-hours puts the binding ceiling at $1.10/replay-hour; the nearest vendor charges a flat $1,200/month with no self-hostable option. Chosen $0.29 on Team sits at 4.2x the 90th-percentile cost and 26% of the self-host ceiling - deliberately far below it, because self-hosting is our own project and we want the conversion to feel obvious. Evidence: usage-value correlation on 40 accounts (teams above 400 replay-hours/month renew at 96%, below 100 at 61%), plus 14 win/loss interviews in which price was decisive twice, both against self-hosting.

### Mechanics

Annual: 15% off, no stacking with volume breaks. Volume breaks published at 2,500 and 10,000 replay-hours/month ($0.26 and $0.23). Committed spend available from $30k/year at $0.21. Discount ceiling 20%, approvable only by the founder; anything deeper requires a multi-year commitment.

### Predictability

Public price page with all three published rungs and a calculator taking replay-hours and retention. In-product usage against the included allowance, projection to period end, and the same figures on a `/usage` API endpoint. Alerts at 70/85/95% and an anomaly alert at 3x the trailing daily average. Hard cap default on Free and Starter (replays queue and the workspace pauses), soft cap default on Team and Enterprise. Invoices itemise plan fee, included allowance, overage hours at the effective rate, and credits separately. A runaway-usage credit up to $500 is pre-approved for support to grant without escalation.

### Change plan

- **Existing 40 paying teams** on per-seat: grandfathered 12 months to 2027-09-01, then migrated to Team. Modelled impact: 31 accounts pay less, 9 pay between 15% and 60% more; those 9 get a call before the announcement and a 12-month price lock at the midpoint.
- **Free hosted users**: unchanged.
- **Self-hosted users**: unaffected, and the announcement says so in the first paragraph, because that community will read it first.
- **Notice**: 60 days, published on the blog and emailed, with the FAQ live the same hour. Founder answers the public thread; the pre-approved concession is the 12-month lock.

### Measurement

Free-to-paid conversion (baseline 4.1%, target 6% in two quarters), median days from signup to first payment (baseline 34), net revenue retention (baseline 101%, target 115% once the metric change lands), share of accounts within 15% of their included allowance, average discount (baseline 11%, ceiling 20%), gross margin per account (floor 70%), billing-related support tickets per 100 accounts. Reviewed monthly, full pricing review at 2027-03-01.

### Revisit triggers

- Gross margin per account below 70% for two consecutive months.
- Overage revenue exceeding 45% of total revenue, which would mean the allowances are set wrong.
- Any competitor publishing a self-hostable equivalent with a free hosted tier.
- More than 5% of accounts hitting the anomaly alert in a month, which would mean the cap defaults are wrong.

---

## Weak versus strong sections

### Value metric

**Weak.** "We'll move to usage-based pricing since seats aren't working anymore."

**Strong.** The version above: the unit named, the rejected candidates named with the specific reason each fails, and the evidence that the current metric is broken (seats flat at 4.2 while volume tripled). A rejection with a stated reason stops the idea being re-litigated every quarter.

### Free surface

**Weak.** "Generous free tier so developers can try it properly."

**Strong.** A number, what it does and does not cover, the total marginal cost as a share of paid gross profit, an agreed ceiling for that share, and an abuse policy. "Generous" is not a quantity, and nobody notices the cost until growth becomes expensive.

### Price points

**Weak.** "$690/month for Team, roughly in line with the market."

**Strong.** Floor with the 90th-percentile cost, the binding ceiling identified as self-hosting with its computation, the chosen number expressed as a multiple of both, and the evidence behind it. In-line-with-the-market is a description of someone else's decision.

### Change plan

**Weak.** "We'll grandfather existing customers for a while and announce it soon."

**Strong.** Every cohort named, the number of accounts that pay more with the size of the increase, a dated end to grandfathering, who calls the nine unhappy accounts first, and the pre-approved concession for the public thread. Vagueness here is what turns a price change into an incident.
