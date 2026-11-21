# Value metric families

Contents: the six families · the hybrid stack · composite units and credits · seat-collapse diagnostics · a worked metric choice.

The value metric is the unit the invoice multiplies. Packaging and price points can be re-cut in a quarter; changing the metric rewrites every contract, every forecast and the metering pipeline underneath. Spend the analysis here.

## The six families

| Family                    | Unit examples                                                                                         | Fits                                                                   | Breaks when                                                       | Meterability                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------- |
| Seats / users             | named user, active user, admin                                                                        | collaboration surfaces, IDE-side tools, consoles                       | value grows through automation, CI, service accounts or agents    | trivial                               |
| Consumption               | requests, messages, builds, minutes, GB stored or transferred, rows scanned, tokens                   | infrastructure and API products where your cost moves with the unit    | the customer cannot forecast their own volume                     | needs real metering                   |
| Business outcome          | transactions processed, the customer's monthly active end-users, endpoints monitored, devices managed | products whose benefit is legible in the customer's own business terms | the outcome is only partly attributable to you                    | usually easy, sometimes self-reported |
| Capacity / entitlement    | concurrent jobs, environments, clusters, projects, retention window                                   | products sized at deployment time; stateful systems                    | traffic varies wildly inside a fixed capacity                     | trivial                               |
| Percentage of a flow      | share of payment volume or revenue processed                                                          | payments and money movement                                            | the customer does not see the flow as yours                       | easy where the flow is yours          |
| Flat per unit of software | per repository, per service, per product                                                              | simple tools, small teams, first pricing of a new product              | the top of the market outgrows it and the bottom cannot afford it | none needed                           |

Read each candidate against the five tests in the skill body: value correlation, already counted, forecastable, non-perverse, cost-correlated.

## The hybrid stack

Most mature devtool pricing composes four layers. Add a layer only when it earns its place:

1. **Platform fee** - covers the fixed cost of an account and buys entitlements, support and governance. Add it when accounts cost you money before they generate usage.
2. **Included allowance** - usage bundled into the fee. Add it to make the modal bill predictable and to give the price page a single number.
3. **Metered overage** - captures growth above the allowance. Add it when usage varies by an order of magnitude across accounts.
4. **Committed spend** - an annual floor in exchange for a lower unit rate. Add it once accounts are large enough that both sides want a forecast.

A hybrid is not a compromise between seats and usage; it is the normal shape once a product serves both humans and machines.

## Composite units and credits

Vendor-defined units (credits, points, compute units) decouple the invoice from a shifting cost mix - useful when the underlying resources change often. The price of that abstraction is that customers cannot map it to numbers they already track, so it only works with:

- a published conversion table from credits to real units,
- a calculator that takes the customer's own numbers,
- stability: silently reducing what a credit buys is a price rise plus a deception, and gets read as both.

Without all three, an invented unit reads as obfuscation regardless of intent.

## Seat-collapse diagnostics

Per-seat pricing assumes one human ≈ one unit of value. Check for these before defaulting to it:

- Seat count flat or falling while usage rises.
- Shared logins, service accounts, or requests to buy discounted "bot seats".
- The product's own roadmap is about doing more work with fewer people.
- Expansion revenue arrives only through upsells, never through usage.

The repair is normally additive: keep a small seat component for the human surface, add consumption or capacity for the automated load. A wholesale swap re-prices every existing account at once and turns a metric fix into a churn event.

## Worked metric choice

**Product.** A hosted service that runs integration test suites on every pull request. Customers are engineering teams; the pipeline is triggered by CI, not by humans.

- _Seats_ - rejected. The people who benefit never log in; CI does. Seat count would stay near the number of platform engineers while test volume grows tenfold.
- _Test runs_ - rejected as the headline unit. Encourages teams to bundle tests into fewer runs, which is worse engineering and hides real usage.
- _Compute minutes_ - plausible. Tracks the vendor's dominant cost almost exactly, and teams already watch CI minutes elsewhere, so it is forecastable and already counted.
- _Concurrency_ - plausible. Teams size their own runners this way, it is trivially meterable, and it is stable month to month; it correlates with cost only loosely at low utilisation.
- _Repositories_ - rejected. Uncorrelated with value: one busy monorepo dwarfs fifty dormant repositories.

**Chosen architecture.** Concurrency as the entitlement (predictable, already counted, sold as tiers) plus metered compute minutes above a generous included allowance (captures growth, tracks cost). A committed-spend option appears above the point where a customer's monthly overage exceeds the platform fee.
