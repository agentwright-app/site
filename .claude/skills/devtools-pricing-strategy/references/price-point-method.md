# Placing the number: floor, ceilings, evidence, mechanics

Contents: computing the floor · the four ceilings · research methods by evidence strength · structural mechanics · signals that a price is wrong.

## Computing the floor

1. Take one unit of the chosen value metric and add every marginal cost it triggers: compute, storage, egress, third-party API or inference spend, and the support hours the account consumes at that volume.
2. Model the **90th-percentile account**, not the average. In consumption products the top decile sets the margin, and averages hide the accounts that lose money.
3. Add the free surface as a line item: its total marginal cost is paid for by the paid rungs, so it belongs inside the margin calculation, not outside it.
4. Set a gross-margin target and price above it. A 2026 study of 342 SaaS and AI companies puts the software median at 80% and the top quartile at 86%; usage-only pricing models sit at a 62% median because infrastructure cost lands directly in COGS. Infrastructure- and inference-heavy products therefore choose a lower target deliberately rather than discovering it in the first cost review.
5. Re-check whenever an upstream cost moves. Pass-through costs change without notice, and a price set once against them silently drifts below the floor.

## The four ceilings

Take the **lowest** one; it is the number the buyer will reason with.

1. **Self-host it.** For anything with a free self-hostable equivalent: infrastructure plus operator time plus upgrade risk plus on-call. Quantify all four in the customer's terms, not yours.
2. **Build it.** Developers price your product against a sprint of their own work. The honest comparison includes maintenance, on-call and opportunity cost - not just the first implementation.
3. **The next best vendor.** Their published price anchors the conversation whether or not the products are comparable.
4. **Do nothing.** A real competitor for tools that improve rather than enable.

If the lowest ceiling sits below the floor, no price works. The problem is the cost structure or the business model, and pricing cannot fix it.

## Research methods, by strength of evidence

| Method                                   | What it gives                                                                                                         | Strength                                          | Cost                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| Usage-value correlation on your own data | which usage patterns predict retention and expansion, and the threshold where customers call the product load-bearing | strongest for an existing product                 | low, if usage is instrumented |
| Win/loss and churn interviews            | price as an actual decision, with the alternative named                                                               | strong; the only source of real objections        | medium                        |
| Live price experiments on new signups    | observed behaviour at different numbers                                                                               | strong, but slow and awkward to run fairly        | medium                        |
| Gabor-Granger                            | "would you buy at $X" across randomized points → a demand curve                                                       | medium; better than asking people to name a price | medium                        |
| Van Westendorp                           | four questions → an acceptable range and an optimal zone                                                              | medium; needs ~100+ respondents per segment       | medium                        |
| MaxDiff / best-worst scaling             | feature importance ranking                                                                                            | packaging input, not a price input                | medium                        |
| Competitor price scraping                | the anchor buyers will quote at you                                                                                   | weak alone; reproduces someone else's mistake     | trivial                       |

Stated willingness to pay on a described product is always weaker evidence than observed behaviour on a live one. For a product with users, weight your own data above every survey.

With no data at all: price from the floor plus the target margin, sanity-check against the self-host and build ceilings, publish it as an experiment with a review date. Under-pricing is the more common error and the harder one to reverse, because every existing customer becomes an argument against the correction.

## Structural mechanics

- **Annual discount.** The "two months free" anchor is 16.7%; in a sample of 100 SaaS companies over half discount between 15% and 20%, with the full range running roughly 3.5-44%. Buys cash and cuts churn; do not stack it with volume and commitment discounts without a floor.
- **Volume breakpoints.** Published breaks on the metered unit reward growth without a renegotiation. Publishing them also removes the incentive to call sales purely to ask.
- **Committed spend.** A floor in exchange for a lower rate. Makes revenue forecastable on both sides and is the natural bridge from self-serve to contract.
- **Anchoring.** The top published tier makes the recommended tier look reasonable - and stops working entirely when the top tier is obviously unbuyable.
- **Discount ceiling.** Decide the maximum discount and who can approve it before the first negotiation. In sales-assisted motions the discount ladder, not the list price, is the real price.
- **Price presentation.** Charm pricing suits value positioning, round numbers suit premium positioning; neither survives a bill the customer cannot predict.

## Signals that the price is wrong

- **Raise it:** nobody objects to price, win rates are unusually high, churn is very low, discounts are rarely requested, prospects say some version of "that's cheap".
- **Lower it or re-package:** losses cluster on price against one competitor, self-serve conversion collapses at the first paid step, or the entry price sits above what an individual will put on a personal card for a tool individuals adopt.
- **Change the metric instead of the number:** revenue is flat while usage grows, or customers systematically buy the smallest tier and over-consume it.
