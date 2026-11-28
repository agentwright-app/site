---
title: "Version your agent's system prompt: releases, gradual rollout and one-step rollback"
description: "How to treat a Claude agent's system prompt like code: a version id on every request and usage row, prompts in the repo instead of a database editor, evals before release, a percentage rollout by user, comparing versions with SQL, and rolling back without a deploy, while keeping the prompt cache intact."
date: 2026-12-26
slug: version-system-prompts-rollout-rollback
tags: [ai, llm, testing, typescript]
---

<p class="lede">A one-line change to a system prompt can change every answer your product gives. Most teams still ship prompt changes the way they would edit a README: change the text, deploy, hope. When answers get worse a week later, nobody can say which change did it or which users saw it. This post sets up the small amount of process that fixes that, without a prompt management platform.</p>

## Every request knows its prompt version

Start with an id. Keep each prompt version as a file in the repo, and derive a short version id from its content:

```ts
// lib/agent/prompts/index.ts
import { createHash } from "node:crypto";
import v12 from "./support-v12";
import v13 from "./support-v13";

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 8);

export const PROMPTS = {
  "support-v12": { text: v12, hash: hash(v12) },
  "support-v13": { text: v13, hash: hash(v13) },
} as const;
export type PromptId = keyof typeof PROMPTS;
```

Record the prompt id (and the hash, which catches edits that forgot to bump the name) on every [usage row](/blog/meter-claude-api-costs-per-user-nextjs/) and every [trace](/blog/trace-claude-agent-runs-postgres/). From then on, "did answers get worse after the change?" is a query, not an argument.

Why files in the repo, not a prompt editor in your admin area? Review. A prompt change in a pull request gets a diff, a reviewer, a CI run of your evals and a commit message saying why. A prompt edited in a database form gets none of those, and it is the most behaviour-changing text in your product.

## A new version is a new file

Never edit a released version in place. Copy `support-v12.ts` to `support-v13.ts` and change the copy. Old versions stay in the repo as long as anything might route to them, which makes rollback a one-word change.

Each version must also stay byte-for-byte stable while it is live. The system prompt sits near the start of every request, and [prompt caching](/blog/prompt-caching-claude-agent-loop/) only works if that prefix is identical: no dates, no user names, no per-request text in it. Per-user context goes after the cached prefix, in the messages.

## Evals before release

Before a new version gets any traffic, run your [eval set](/blog/evals-for-claude-agents-typescript/) against both versions and compare:

```bash
npm run eval -- --prompt support-v12 > v12.json
npm run eval -- --prompt support-v13 > v13.json
node scripts/compare-evals.mjs v12.json v13.json
```

Look at three things: cases that newly fail, cases that newly pass, and cost per case. A new prompt that fixes the bug you targeted and breaks two unrelated cases is a common result; it is much cheaper to find that here than in production. Add the case that motivated the change to the eval set, so the fix stays fixed.

## Roll out by percentage of users

Evals catch a lot, not everything. Real traffic is more varied. Send the new version to a slice of users first, assigned by a stable hash so each user sees one version consistently:

```ts
import { createHash } from "node:crypto";

export function bucket(userId: string, salt: string) {
  const h = createHash("sha256").update(`${salt}:${userId}`).digest();
  return h.readUInt32BE(0) % 100;     // 0..99, stable per user and salt
}

export async function promptFor(userId: string): Promise<PromptId> {
  const cfg = await getSwitch("prompt.support");          // { current, next, percent }
  return bucket(userId, "prompt.support") < cfg.percent ? cfg.next : cfg.current;
}
```

`getSwitch` reads a small runtime config table with a short cache, as in the [kill switches post](/blog/kill-switches-ai-agent-models-tools/). A rollout is then a sequence of config changes: 5%, wait a day, 25%, wait, 100%. Rollback is setting `percent` to 0. No deploy in either direction, and each change is in the audit log with a reason.

Keep one user on one version for the whole conversation. Switching prompts mid-conversation confuses the model (the earlier turns were written under different instructions) and breaks the cache for that conversation. Store the prompt id on the conversation row when it starts and reuse it.

## Compare versions with SQL

With the prompt id on usage rows and traces, comparing versions takes one query per question:

```sql
SELECT prompt_id,
       count(DISTINCT conversation_id)                         AS conversations,
       round(avg(cost_micro_usd) / 1e6, 4)                     AS avg_cost_per_call,
       round(avg(turns), 2)                                    AS avg_turns,
       round(100.0 * avg((feedback = 'down')::int), 1)         AS pct_thumbs_down
FROM agent_runs
WHERE created_at > now() - interval '3 days'
GROUP BY prompt_id;
```

Turns per run and cost per run move first when a prompt makes the agent more or less efficient. Thumbs-down rate needs feedback buttons on answers and a few hundred conversations before it says anything. With small numbers, read the conversations themselves: ten real conversations per version tell you more than a percentage from forty.

## When to roll back

Decide the rules before the rollout, so the decision is not made under pressure:

- A tool error rate or refusal rate clearly above the old version: roll back immediately.
- Cost per run up by more than your margin allows, with no quality gain: roll back.
- A credible user report of a wrong answer the old version got right: pause the rollout, add the case to evals, fix.

## Summary

- Keep each prompt version in its own file; derive a hash; never edit a released version.
- Record the prompt id and hash on every usage row, trace and conversation.
- Run evals on old and new before release, and add the motivating case.
- Roll out by stable user hash through a runtime switch; one version per conversation.
- Compare versions on cost, turns and feedback with SQL; agree rollback rules in advance.

<!-- site-only -->

*Agentwright Starter keeps its system prompt in one file that is the same for every request, so the prompt cache holds, and runs evals from `evals/cases.ts`; versioned prompts and a rollout switch are not included. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
