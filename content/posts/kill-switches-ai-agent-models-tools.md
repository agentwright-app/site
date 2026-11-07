---
title: "Kill switches for an AI agent: turn off a tool, change a model or pause a user in seconds, without a deploy"
description: "A small runtime config table for an AI agent SaaS that lets you disable a broken tool, switch a route to another model, lower limits, block one abusive user or show a status banner in seconds, with a short cache, an audit log, safe defaults, and the incident runbook that goes with it."
date: 2026-12-14
slug: kill-switches-ai-agent-models-tools
tags: [postgres, operations, nextjs, typescript]
---

<p class="lede">Something goes wrong at 2 a.m.: a tool starts sending duplicate emails, a model returns errors for one route, one account runs a script that burns through $200 an hour, or a prompt change makes answers worse. A fix through code review and deploy takes an hour if everything goes well. A kill switch takes ten seconds. This post builds a small set of them on Postgres, plus the runbook that tells you which one to pull.</p>

## What deserves a switch

Not every setting needs to be changeable at runtime. These do, because each one stops a specific kind of damage:

- **Per tool: enabled or disabled.** A tool with side effects that misbehaves (duplicate emails, wrong writes) must stop now.
- **Per route: model.** If one model has elevated errors or a quality problem, move the route to another model.
- **Per route: maximum turns and `max_tokens`.** Lower them during a cost incident.
- **Global and per plan: rate and spend limits.** Tighten them during abuse.
- **Per user: blocked.** Stop one account without touching anyone else.
- **Global: agent paused, with a message.** The last resort, with a banner that says what is happening.

## One table, typed in code

```sql
CREATE TABLE runtime_config (
  key         text PRIMARY KEY,           -- 'tool.send_email.enabled', 'route.chat.model', ...
  value       jsonb NOT NULL,
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  reason      text NOT NULL
);

CREATE TABLE runtime_config_log (
  id          bigserial PRIMARY KEY,
  key         text NOT NULL,
  old_value   jsonb,
  new_value   jsonb NOT NULL,
  updated_by  text NOT NULL,
  reason      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN blocked_at timestamptz, ADD COLUMN blocked_reason text;
```

The `reason` column is required on purpose. At 2 a.m. it feels like a chore; a week later it is the only record of why `route.chat.model` points somewhere odd.

In code, define every switch with a type and a default, so a missing or malformed row can never break the app:

```ts
const SWITCHES = {
  "agent.paused":            z.object({ paused: z.boolean(), message: z.string() })
                               .default({ paused: false, message: "" }),
  "tool.send_email.enabled": z.boolean().default(true),
  "route.chat.model":        z.enum(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"])
                               .default("claude-sonnet-5-5"),
  "route.chat.max_turns":    z.number().int().min(1).max(50).default(15),
} as const;

export async function getSwitch<K extends keyof typeof SWITCHES>(key: K) {
  const raw = await cachedConfig();          // all rows, cached for 10 seconds
  const parsed = SWITCHES[key].safeParse(raw[key]);
  return parsed.success ? parsed.data : SWITCHES[key].parse(undefined);
}
```

An enum for the model switch means a typo cannot route traffic to a model id that does not exist. A value that fails validation falls back to the default and should log a warning.

## Cache briefly, read everywhere

Reading the table on every request is fine at small scale, but a 10-second in-process cache keeps it off the hot path and still means a change takes effect within seconds. On serverless platforms each instance has its own cache, which is fine: the worst case is a few seconds of old behaviour per instance.

Read the switches at the points where they act:

- **Before the run:** `agent.paused`, the user's `blocked_at`, limits. Return a clear message, not a 500. The [rate limiting post](/blog/rate-limit-llm-endpoints-postgres/) shows the shape of a good refusal.
- **When building the request:** the route's model and `max_tokens`. If you [choose models per route](/blog/choose-claude-model-per-route/), this is the same lookup with an override.
- **When registering tools:** leave disabled tools out of the tool list entirely, so the model never tries them. If a tool is disabled mid-run, return a tool error ("This tool is temporarily unavailable") rather than throwing, as the [errors post](/blog/claude-api-errors-retries-agent-loop/) recommends.
- **Between turns of the loop:** check `agent.paused` and `blocked_at` again, so a long run stops at the next turn. The [cancellation post](/blog/cancel-claude-agent-runs-abortcontroller/) shows how to stop a run cleanly.

Removing a tool from the list changes the request prefix, so [prompt caching](/blog/prompt-caching-claude-agent-loop/) misses until the new prefix is cached. During an incident that cost is irrelevant; just know why the cache hit rate dropped.

## Changing a switch

The change goes through one function that writes the value, the log row and the reason in a transaction. Call it from an admin page, or from a small CLI that runs against production:

```bash
node scripts/switch.mjs set tool.send_email.enabled false --reason "duplicate sends, see incident 12-14"
node scripts/switch.mjs block-user 3f2a... --reason "scripted abuse, 4k runs/h"
node scripts/switch.mjs list
```

Only admins can change switches. Every change should also send a short notification to wherever you watch alerts, so a switch someone flipped is never a surprise.

## Safe defaults and the failure direction

Decide for each switch what happens if the config table itself is unreachable:

- Tools with side effects, **fail closed**: if you cannot read the switch, treat the tool as disabled.
- Model choice, limits: **use the coded default.**
- `agent.paused`: **fail open**, because a database blip should not take the whole product down. The run will most likely fail anyway if the database is down.

## The runbook

Write it next to the code, in five lines per incident type, so the decision at 2 a.m. is already made:

1. **A tool does damage** (duplicate or wrong side effects): disable the tool, then investigate with the [traces](/blog/trace-claude-agent-runs-postgres/).
2. **Model errors or overload for one route:** switch the route to another model; keep the [retry logic](/blog/claude-api-errors-retries-agent-loop/) as it is.
3. **Cost spike:** find the users with the [anomaly query](/blog/spend-anomaly-alerts-llm-costs-sql/); block an abusive user or lower that plan's limits; lower `max_turns` if the cause is long loops.
4. **Bad answers after a change:** move the route back to the previous model or prompt version, then run your [evals](/blog/evals-for-claude-agents-typescript/).
5. **Unknown or widespread:** pause the agent with a status message, then work through 1 to 4.

After each incident, turn the switch back with a reason, and fix the cause in code. A switch that stays flipped for weeks is a hidden fork of your configuration; the log makes those easy to find.

## Summary

- Add switches for tools, route models, limits, single users and a global pause; nothing else.
- Store them in one table with a required reason and an audit log; validate with typed defaults in code.
- Cache for a few seconds; read switches before the run, when building the request, and between turns.
- Decide each switch's failure direction: side-effect tools fail closed, the global pause fails open.
- Keep a five-step runbook in the repo so the choice is made before the incident.

<!-- site-only -->

*Agentwright Starter has an admin area and per-plan rate limits in Postgres, which is where switches like these plug in. Details and launch status are in the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed before publishing.*

<!-- /site-only -->
