# Packaging ladder and gate placement

Contents: the four rungs · gate placement per capability · the never-paywall list · free-limit checklist · add-ons versus tiers · pricing on top of your own open source.

## The four rungs

Each rung needs contents, a price shape, and a **trigger** - the event in the customer's life that moves them up. Contents without a trigger is a price list. The table runs in customer-journey order; the order to _build_ them in is the efficiency order in the skill's step 3.

| Rung            | Purpose                                                   | Typical contents                                                                                                                                           | Price shape                                    | Trigger to leave                                                     |
| --------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Free surface    | evaluation and real small-scale use, permanently, no card | full core capability, all SDKs, standard auth, own-usage visibility, community support                                                                     | $0 with one or two headline limits             | growth past a limit, or moving to production                         |
| Self-serve paid | one developer or one team buys without a conversation     | higher limits, basic collaboration, email support with a stated response window                                                                            | published, card, instant provisioning          | a second team, an admin who is not a user, a procurement requirement |
| Team / business | the org becomes the unit of purchase                      | roles and permissions, shared billing, multiple environments, longer retention, support target, basic SSO                                                  | published, per the value metric, annual option | security review, residency, SLA, custom terms                        |
| Enterprise      | risk removal for an organization with procurement         | enterprise identity (custom IdP, SCIM, directory sync), granular RBAC, audit logs, residency, SLA with credits, private or dedicated deployment, invoicing | "starts at $X", negotiated                     | -                                                                    |

## Gate placement per capability

A capability belongs above a rung only if an _organization_ needs it and a solo developer does not, the crossing is observable, and the cost to serve is covered.

| Capability                                                   | Belongs at           | Why                                                                           |
| ------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------- |
| Core functionality, SDKs, CLI                                | free                 | gating it makes evaluation impossible and the free tier pointless             |
| Standard authentication, basic SSO with a common provider    | free or team         | security fundamentals; gating them is the most criticised move in this market |
| Usage visibility and data export                             | free                 | withholding either reads as a trap and blocks migration in both directions    |
| Higher limits, more environments, longer retention           | self-serve and above | scales with value, observable, costs you money                                |
| Roles, permissions, shared billing                           | team                 | meaningless to a solo developer, essential to an org                          |
| Audit logs, enterprise identity, residency, SLA with credits | enterprise           | bought by compliance and risk functions, not by users                         |
| Priority support, dedicated contacts                         | team and enterprise  | genuine marginal cost, scales with headcount not usage                        |
| Security patches                                             | every rung, always   | withholding them turns users into adversaries and attracts CVE coverage       |

## The never-paywall list

- Security fundamentals and security patches for the free edition.
- Data export and portability.
- Anything the community contributed.
- Visibility into the customer's own usage and bill.

Each of these has produced public backlash or a hostile fork somewhere in this market. The single-sign-on case is catalogued publicly - sso.tax, whose original repository is dormant and whose maintained successor is the `stopthessotax/sso-wall-of-shame` fork - and is the one prospects will bring up unprompted.

The catalogue's own inclusion bar is a useful design threshold: "if your SSO support is a 10% price hike, you're not on this list." Institutional pressure points the same way: the CISA Secure by Design pledge, with 200+ signatories, names SSO at no extra cost as a goal.

## Free-limit checklist

- Limits sit on the same axis as the paid value metric, so hitting the limit _is_ the moment paying becomes necessary.
- One or two headline numbers. Five interacting limits cannot be evaluated without a spreadsheet.
- A real side project runs comfortably; a small company's production workload does not.
- The marginal cost of a free account is computed, and the free surface's total cost is capped as a share of paid gross profit.
- No time bomb: no expiry, no "free tier ends after 90 days of inactivity", no quiet degradation of speed or reliability.
- Warnings at 70/85/95% of a limit, then a stated behaviour - throttle, queue, pause, or bill overage. Never delete data as enforcement.
- An abuse policy exists in writing (mining, spam, multi-account farming) with rate ceilings, instead of a smaller limit for every honest user.

## Add-ons versus tiers

Use a **tier** when needs move together with size. Use an **add-on** when a need is orthogonal to size: an extra region, a compliance package, premium support, extended retention, a specialised connector.

Cap the count. Three add-ons across four tiers is already twelve configurations a price page must explain and a sales conversation must quote. When add-ons multiply, fold the most-attached one into the tier above it.

## Pricing on top of your own open source

When a free self-hostable edition exists, it is the bottom rung and it competes with every paid rung above it.

- Price the hosted offering against the true cost of self-hosting: infrastructure, operator time, upgrade risk, and the on-call burden.
- Keep the paid gates on operation, governance and support rather than on capability the community could rebuild in a weekend.
- Publish what will always stay in the open edition. Silence is read as intent to close, and the community prices that in immediately.
- Expect self-hosted users to be your best advocates and your worst prospects at the same time; that is the deal, not a problem to fix with restrictions.
