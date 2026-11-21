# Published findings

Every figure, threshold and named claim this skill relies on, with its source and how much weight it carries. Read this before quoting a number to a stakeholder, and before treating any target here as an industry standard.

Contents: [Calibration data](#calibration-data) · [Evidence that doc quality moves agent success](#evidence-that-doc-quality-moves-agent-success) · [Traffic and adoption figures](#traffic-and-adoption-figures) · [Named concepts and who named them](#named-concepts-and-who-named-them) · [Self-set baselines](#self-set-baselines) · [Claims to avoid](#claims-to-avoid)

## Calibration data

**Stripe integration benchmarks** (`github.com/stripe/ai`, `benchmarks/`, results dated 2026-02-26) - the only vendor-published, open-sourced suite measuring coding agents completing real integration tasks against a vendor's own documentation. Twelve evals in three categories. Scoring is best-of-3 per task, infrastructure failures discarded, best transcript human-reviewed.

| Category            | gpt-5 | sonnet-4.5 | gpt-5.2 | opus-4.5 |
| ------------------- | ----- | ---------- | ------- | -------- |
| Backend-only        | 73%   | 75%        | 80%     | 85%      |
| Full-stack          | 86%   | 80%        | 77%     | 92%      |
| Gym (feature depth) | 61%   | 61%        | 73%     | 65%      |

Best-run turn counts spanned 17-163. Documentation access was restricted to a single channel - Stripe's docs-search endpoint - which is what makes the run measure the docs rather than the model's priors.

Two things follow:

- A single-attempt unattended target above 80% is ambitious even for a vendor with mature agent-facing docs. Present 80% as a stretch goal rather than a floor.
- Depth-of-feature tasks score 15-25 points below breadth tasks for every model, so a task set weighted toward niche cases scores lower by construction. That is not a regression.

## Evidence that doc quality moves agent success

The published benchmarks measure description quality together with retriever quality and tool count, so the link between prose quality and agent success is directional rather than directly measured. Present it that way. The supporting evidence is indirect but consistent:

- **Gorilla / APIBench** - swapping a weak retriever for an oracle retriever moves API-call accuracy to 67.20% (TorchHub) and 91.26% (HuggingFace). Retrieval quality alone accounts for a large share of the outcome.
- **Anthropic**, "Writing effective tools for agents" - "Claude Sonnet 3.5 achieved state-of-the-art performance on the SWE-bench Verified evaluation after we made precise refinements to tool descriptions, dramatically reducing error rates."
- **BFCL v4** carries a "format sensitivity" category that penalizes schema serialization and phrasing brittleness, and a "missing function" category that penalizes calling a tool when none actually fits.
- **MCP-Bench** tests retrieving the right tool "from fuzzy instructions without explicit tool names" - the closest published proxy for whether a description does its job.
- **MCPEvol-Bench** - frontier models drop 13.7% and 14.4% on evolved MCP servers versus their original versions. Interface and doc drift has a measurable cost, which is the argument for re-running the cold run after every structural change rather than once a year.
- **arXiv 2403.12671** - meaningful function names plus docstrings outperform name-only and dummy-name baselines for code completion. Completion quality differs before versus after paraphrasing in about 70% of cases, so phrasing is not a rounding error.

## Traffic and adoption figures

- **Mintlify** reports agents at 66% of measured web traffic across docs it powers, with over 213 million agent requests against 105 million human page loads in one month, up from 15.2% at the start of 2026. Self-reported, single-vendor, and biased toward docs sites that already invested in agent surfaces. Use it to motivate the work, never as a population statistic.
- **AGENTS.md** is claimed at 60,000+ open-source projects, stewarded by the Agentic AI Foundation under the Linux Foundation since December 2025. Relevant as context for why contributor-facing agent instructions are a separate, already-solved problem - not as a surface this skill produces.

## Named concepts and who named them

- **Agent Experience (AX)** - coined by Mathias Biilmann (Netlify) in January 2025: "the holistic experience AI agents will have as the user of a product or platform." Three pillars:
  - Simple access and permissions.
  - Clean APIs.
  - Machine-optimized documentation.

  This skill executes the third pillar only. The first two are product and API design.

- Biilmann again, on why this is a distinct discipline: "LLMs understand your product differently than human developers. And writing documentation for LLMs is not the same as for humans."
- **Agent Experience Engineer** is a real, hired title, which matters when arguing for staffing.
- Reducto's posting (Glassdoor, $200K-$300K, reporting to the CTO) scopes it as "own Reducto's agent-facing surfaces… CLI, MCP server, SDKs, and other integration points."
- AgentMail's (LinkedIn) frames the reader plainly: "Our biggest user is not a person. It's an agent that reads our docs, asks a model what to use, and signs up on its own."
- **Agent-Friendly Documentation Spec (AFDocs)** - Dachary Carey's specification, first published February 2026 and developed with community contributors, with Fern Labs partnering on the reference benchmark. Its own scope statement: "This spec defines 23 checks across 7 categories that evaluate how well a documentation site serves agent consumers." The seven categories: content discoverability, markdown availability, page size and truncation risk, content structure, URL stability and redirects, observability and content health, and authentication and access. Fern's "Agent Score" tool scores any docs URL against it from 0 to 100. This is a narrower, docs-only counterpart to Biilmann's third pillar rather than a competing account of AX as a whole.
- **Agent Readability: A Specification for AI-Optimized Websites** - published by Vercel in March 2026. Three areas: discovery, structure, and context - a different three-part shape than Biilmann's pillars, and scoped to a whole site rather than documentation alone (llms.txt and markdown mirrors, structured data and heading hierarchy, and an AGENTS.md file for coding agents specifically).

## Self-set baselines

These are self-set rather than published standards: defensible starting points that a team with its own data should replace.

- Fetch-path ceiling of three documents for a routine task.
- Zero invented surface on the three highest-traffic tasks. Defensible as a policy rather than a measurement: on a top task an invented call reaches production.
- "Corrective turns must fall between iterations" as the improvement signal, with Stripe's 17-163 range as the only published turn-count reference point.
- The surface build order in SKILL.md § Which surface to build first, the spec-rule order, and the page-rule order are all judgements about effort against impact, not measured rankings.
- A task set of 5-10 integration jobs (SKILL.md interview question 4, [./cold-run-protocol.md](./cold-run-protocol.md)). A smaller set misses failure modes; a larger one stops being cheap to rerun each iteration.
- The 30-character `operationId` cap in [./spec-annotation-rules.md](./spec-annotation-rules.md). APIMatic's guidance covers dropping articles and conjunctions, not a character count; FastMCP's own 56-character truncation is the only sourced ceiling.
- The 100k-character index-split threshold and "a hand-maintained index rots within two releases" in [./agent-surfaces.md](./agent-surfaces.md) § Index file.

## Claims to avoid

Treat these as judgement calls and never answer them with a number:

- The effect of publishing an index file on agent behaviour in the wild. Agents mostly fetch one because a human, a rules file, or a tool pointed at it.
- A population-level baseline for first-attempt integration success across vendors.
- Whether doctests and type hints get surfaced in completion suggestions - plausible from how completion context is assembled, but not demonstrated.
- Whether AsyncAPI or bare JSON Schema respond to the same annotation rules as OpenAPI - inferred by analogy only.
