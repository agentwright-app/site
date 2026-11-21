# Third-party skills in this folder

Every skill here is copied unchanged from a public repository. Files were only left out, never
edited. Each skill folder holds a copy of its upstream LICENSE file. The house rules in
[README.md](README.md) take precedence over all of these skills.

Copied on 2026-11-21 from shallow clones. No install script, `npx skills` or other code from these
repositories was run.

## samber/developer-relations-skills

- Source: https://github.com/samber/developer-relations-skills
- Commit: `c3a1b6912791539567727723baf626b4fec5ac7a` (committed 2026-11-08)
- Licence: MIT, Copyright (c) 2026 Samuel Berthe (repository `LICENSE`, and `license: MIT` in each
  SKILL.md). A copy of the licence is in each skill folder as `LICENSE`.

| Skill | Upstream path | Upstream version | Files left out |
|---|---|---|---|
| `engineering-blog-post` | `skills/engineering-blog-post/` | 1.0.5 | `evals/evals.json` (test cases for developing the skill; the skill never reads them) |
| `developer-keyword-research` | `skills/developer-keyword-research/` | 1.0.2 | `evals/evals.json` |
| `devto-playbook` | `skills/devto-playbook/` | 1.0.3 | `evals/evals.json` |
| `coding-agent-docs-optimization` | `skills/coding-agent-docs-optimization/` | 1.0.3 | `evals/evals.json` |
| `devtools-pricing-strategy` | `skills/devtools-pricing-strategy/` | 1.0.2 | `evals/evals.json` |

`engineering-blog-post/scripts/scan-draft.sh` was kept because its SKILL.md tells the agent to run
it. It only runs `grep` and `sed` over a draft file you pass it. It makes no network calls and
writes nothing.

## coreyhaines31/marketingskills

- Source: https://github.com/coreyhaines31/marketingskills
- Commit: `5b2b400eec1e7e1cec76245a715d0b0d4fd2a9c1` (committed 2026-11-19)
- Licence: MIT, Copyright (c) 2025 Corey Haines (repository `LICENSE`). A copy is in
  `competitors/LICENSE`.

| Skill | Upstream path | Upstream version | Files left out |
|---|---|---|---|
| `competitors` | `skills/competitors/` | 2.3.3 | `evals/evals.json` |

No other skill from this repository is included. In particular `ai-seo` is not included: it has a
critical flag from a security audit on skills.sh. `competitors` mentions `ai-seo`, `copywriting`
and other skills by name. Those skills are not installed here.

## cloudflare/skills

- Source: https://github.com/cloudflare/skills
- Commit: `5108325ecceabc899c761e07aa617b09c02445ee` (committed 2026-11-17)
- Licence: Apache License 2.0 (repository `LICENSE`; the repository has no NOTICE file). The full
  licence text is in each skill folder as `LICENSE`.

| Skill | Upstream path | Files left out |
|---|---|---|
| `wrangler` | `skills/wrangler/` | `references/skill-feedback.md` |
| `workers-best-practices` | `skills/workers-best-practices/` | `references/skill-feedback.md` |

Only the skill folders were copied. The plugin manifests (`plugin.json`, `.claude-plugin/` and the
others) and the MCP server configuration (`.mcp.json`, `mcp.json`, `mcp_config.json`) were not
copied.

`references/skill-feedback.md` tells the agent how to draft a public GitHub issue on
`cloudflare/skills` (`gh issue create --repo cloudflare/skills`). This workspace does not file
issues, so the file was left out. Each SKILL.md still ends with a "Skill feedback" line that links
to it. That link is now dead on purpose: do not recreate the file or follow the flow (see
README.md). As the Apache-2.0 licence (section 4b) requires, this is the notice of what changed:
both files were removed, and every remaining file is byte-for-byte the upstream version.

## Updating

To update a skill, clone the upstream repository again, read every changed file before copying it,
and then update the commit and date above. Never run an upstream installer.
