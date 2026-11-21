# Cold-run protocol

How to prove - before and after any rewrite - that an agent can integrate the product from the published documentation alone. This is a friction log where the newcomer is an agent.

Contents: [Building the task set](#building-the-task-set) · [Run rules](#run-rules) · [Metrics](#metrics) · [Calibrating the target](#calibrating-the-target) · [Recording a finding](#recording-a-finding) · [Report skeleton](#report-skeleton) · [Keeping it honest](#keeping-it-honest)

## Table of Contents

- [Building the task set](#building-the-task-set)
- [Run rules](#run-rules)
- [Metrics](#metrics)
- [Calibrating the target](#calibrating-the-target)
- [Recording a finding](#recording-a-finding)
- [Report skeleton](#report-skeleton)
- [Task set and baseline](#task-set-and-baseline)
- [Surface inventory](#surface-inventory)
- [Findings](#findings)
- [Fix plan](#fix-plan)
- [Re-run](#re-run)
- [Keeping it honest](#keeping-it-honest)

## Building the task set

Five to ten jobs, each phrased the way a developer would ask, each with a verifiable end state.

Compose the set from three sources:

- The two or three integrations that drive the product's revenue or adoption.
- The top-traffic documentation pages, since that is where failures cost the most.
- The known-painful areas: webhook verification, pagination, auth refresh, retries, anything support answers weekly.

Good tasks name an outcome and leave the path open:

- "Add webhook signature verification to an existing Express server."
- "Paginate through every customer created in the last 30 days and write them to CSV."
- "Handle a rate-limit response with backoff on the search endpoint."

Weak tasks smuggle in the answer or cannot be graded:

- "Call `client.webhooks.constructEvent`." - the task hands over the surface the agent was supposed to discover.
- "Explain how authentication works." - no runnable end state, so nothing can fail.

Freeze the set. It is a benchmark, and a benchmark that changes between runs measures nothing.

## Run rules

1. Start each task in a fresh context with no memory of previous runs and no cached copy of the repository.
2. Restrict sources to the published agent-facing surfaces. If the agent needs something you do not publish, that absence is the finding - record it and let the run fail.
3. Run unattended to the first verifiable outcome: it compiles, it executes, it returns the documented result.
4. Intervene only to unblock a non-documentation obstacle (a missing sandbox credential, a network block). Log the intervention.
5. Capture the full transcript. The corrective turns are the data; the final file is just the receipt.
6. Record the model identifier and the date with every score. A score is comparable only within one generation of agents.

If your environment supports parallel sub-agents, run one task per agent to keep runs independent. If it does not, run them sequentially in separate sessions - never several tasks in one session, because knowledge leaks between them and inflates every score after the first.

## Metrics

| Metric                    | Definition                                                      | What a bad value points at                                                       |
| ------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| First-attempt success     | Tasks reaching the verifiable end state with no corrective turn | The headline number; see Calibrating the target below before picking a pass mark |
| Invented-surface rate     | Runs calling a method, parameter, or field that does not exist  | A missing or ambiguous reference page, or an unpublished spec file               |
| Corrective turns per task | Re-reads and retries before success                             | Scattered answers, incomplete snippets, missing error mapping                    |
| Context cost per task     | Tokens fetched before first success                             | An over-linking index, or cross-reference hops that force extra fetches          |
| Fetch-path length         | Distinct documents opened                                       | More than three for a routine task means the answer is spread too thin           |

Track all five. Success rate alone hides a corpus that works only after six expensive retries.

## Calibrating the target

One vendor publishes an open benchmark of this exact shape: twelve agentic evals of real integration tasks, graders hidden from the agent, documentation access restricted to a single search endpoint. Its 2026-02-26 results across four frontier models, scored best-of-three rather than first-attempt, with best-run turn counts spanning 17 to 163:

- Backend-only tasks: 73-85%.
- Full-stack tasks: 77-92%.
- Depth-of-feature task sets: 61-73%.

Read three things off that:

- **80% first-attempt, unattended, is a stretch goal, not a floor.** A vendor with unusually mature agent-facing surfaces reaches 85% on its easiest category with three attempts allowed. Set the bar there if you want somewhere to climb to; do not let a stakeholder hear it as a minimum acceptable standard.
- **Score by category, not as one average.** Depth tasks land 15-25 points below breadth tasks for every model. A set weighted toward niche cases scores lower by construction, and reporting one blended number invites the wrong conclusion.
- **Your own first run is the only baseline that means anything.** Absolute numbers move with the model generation, the task mix, and how strictly you restrict sources. Iteration-over-iteration delta on a frozen set is the comparison that survives.

If your first baseline lands well under these figures, that is the expected result for a corpus that has never been audited - it is the starting point the rest of the protocol exists to move.

## Recording a finding

One entry per failure, written so someone who did not watch the run can act on it:

```markdown
### Webhook verification fails on the first attempt

- Task: "Add webhook signature verification to an existing Express server."
- Outcome: failed - agent called `verifySignature(payload, header)`; the real method takes a third argument (the endpoint secret).
- Where it looked: /docs/webhooks (HTML only, no markdown version), then guessed.
- Root cause: the signature helper appears only in a prose paragraph; no snippet, and the OpenAPI file does not cover SDK helpers.
- Fix: add a complete runnable snippet with all three arguments and the failure branch; publish the type declarations.
- Impact: top-3 task, invented surface - fix before any cosmetic work.
```

## Report skeleton

```markdown
# Agent-readiness audit - <product> - <date>

## Task set and baseline

Model, date, tasks, per-task result, five metrics.

## Surface inventory

Surface | Status (present/partial/missing) | Effort | Unblocks

## Findings

Task impact decides which findings make the list; within it, order by fixes-per-hour as in SKILL.md § Workflow step 4. One block per finding, in the format above.

## Fix plan

Ships now (content edits) | Needs a build or infrastructure change

## Re-run

Same task set, same metrics, delta against baseline, what still fails and why.
```

## Keeping it honest

- Re-run after every structural change; the score decays silently as the corpus drifts. The cost of that drift is measured, not hypothetical: on a benchmark that deliberately mutates tool interfaces, frontier models lose over 13 points against the unmutated originals.
- Never grade a task the same session has already solved.
- Vary the agent between iterations where you can, so you are not tuning the corpus to one model's habits.
- Fix the pages, not the prompt. A prompt that carries the missing information proves only that you knew it.
- Publish the score alongside the docs when you can. A visible number is what keeps the protocol from being run once and forgotten.
