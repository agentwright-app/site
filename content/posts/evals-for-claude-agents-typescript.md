---
title: "Evals for a Claude agent in 140 lines of TypeScript: golden cases, tool checks and a CI gate"
description: "A minimal eval harness that runs real cases through your actual agent loop, checks tool calls, answers and turn counts, prints cost per case, and fails CI when behaviour regresses. No framework, no database."
date: 2026-11-09
slug: evals-for-claude-agents-typescript
tags: [claude, testing, agents, typescript]
---

<p class="lede">Unit tests tell you your tool functions work. They do not tell you whether the agent still calls the right tool after you edited the system prompt, switched to a cheaper model or added a new tool with an overlapping description. That is what evals are for, and a useful first version is much smaller than most eval frameworks suggest.</p>

This post builds the harness we use: a list of cases, a runner that sends each one through the same agent loop production uses, a pass/fail table with cost, and an exit code CI can act on. Around 140 lines in total.

## What an eval should catch

Most agent regressions are one of four things:

1. **The wrong tool, or no tool.** The agent answers from memory when it should have looked something up, or calls `search_orders` when it should call `get_order`.
2. **A tool when none was needed.** Simple questions that trigger a lookup cost money and latency.
3. **Wrong or missing facts in the answer.** The tool returned the right data and the answer dropped it.
4. **Runaway loops.** The agent calls tools ten times for something that takes one.

Each of these can be checked with plain code. You do not need a model to grade "did it call `get_time`" or "did the answer contain 391".

## Cases as data

```ts
// evals/cases.ts
export type EvalCase = {
  id: string;
  input: string;
  expectTools?: string[];   // tools the agent must call at least once
  expectNoTools?: boolean;  // the agent must not call any tool
  includes?: string[];      // case-insensitive substrings the final text must contain
  matches?: RegExp[];       // patterns the final text must match
  maxTurns?: number;        // upper bound on model turns
};

export const cases: EvalCase[] = [
  {
    id: "tool-use-time",
    input: "What is the current UTC time? Use your tool and answer with the ISO timestamp.",
    expectTools: ["get_time"],
    matches: [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/],
    maxTurns: 2,
  },
  {
    id: "no-tool-arithmetic",
    input: "What is 17 * 23? Reply with just the number.",
    expectNoTools: true,
    includes: ["391"],
    maxTurns: 1,
  },
  {
    id: "honest-limits",
    input: "Please send an email to my boss saying I'll be late.",
    expectNoTools: true,
    matches: [/can(?:'|’)?t|cannot|unable|don(?:'|’)?t have|no (?:email|tool)/i],
    maxTurns: 1,
  },
];
```

The checks are deliberately loose. `includes: ["391"]` passes for "391", "The answer is 391." and "17 × 23 = 391". Exact string matching on model output makes evals flaky, and a flaky eval gets ignored within a week.

The third case is the one people skip: the agent has no email tool, so the right behaviour is to say so plainly. Without a case like this, a future prompt change that makes the agent pretend ("Done! I've sent the email.") goes unnoticed. Note the curly apostrophe in the pattern; models use both.

## The runner: use the real loop

The most important design decision: **run cases through the same `runAgent` function the product uses**, with the same system prompt and the same tool registry. An eval that calls the API with a copy of the prompt tests the copy.

```ts
// evals/run.ts
import { runAgent } from "../lib/agent/loop";
import { SYSTEM_PROMPT } from "../lib/agent/system-prompt";
import { costMicroUsd, formatUsd } from "../lib/billing/pricing";
import { cases, type EvalCase } from "./cases";

export async function runCase(c: EvalCase, model: string) {
  const started = Date.now();
  const tools: string[] = [];
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let turns = 0;
  let text = "";

  try {
    await runAgent({
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: c.input }],
      maxTokens: 1024,
      onText: (t) => (text += t),
      onToolCall: (name) => tools.push(name),
      onTurn: (m) => {
        turns++;
        usage.input += m.usage.input_tokens;
        usage.output += m.usage.output_tokens;
        usage.cacheRead += m.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
      },
    });
  } catch (e) {
    text += `\n[error] ${(e as Error).message}`;
  }

  const failures: string[] = [];
  for (const t of c.expectTools ?? []) if (!tools.includes(t)) failures.push(`expected tool call: ${t}`);
  if (c.expectNoTools && tools.length) failures.push(`unexpected tool calls: ${tools.join(", ")}`);
  for (const s of c.includes ?? []) if (!text.toLowerCase().includes(s.toLowerCase())) failures.push(`missing text: "${s}"`);
  for (const r of c.matches ?? []) if (!r.test(text)) failures.push(`no match for ${r}`);
  if (c.maxTurns && turns > c.maxTurns) failures.push(`took ${turns} turns (max ${c.maxTurns})`);
  if (text.includes("[error]")) failures.push("agent error");

  return { id: c.id, pass: failures.length === 0, failures, turns, tools, usage, cost: costMicroUsd(model, usage), ms: Date.now() - started, output: text.trim() };
}
```

The loop takes callbacks (`onText`, `onToolCall`, `onTurn`) because the streaming route needs them anyway, and they make the eval runner trivial: it collects the same events the UI renders. If your loop needs a user id for metering, make that optional so evals can run without a database.

## Output you can read in a terminal

```ts
async function main() {
  const model = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "claude-sonnet-5-5";
  const results = [];
  for (const c of cases) {
    const r = await runCase(c, model);
    results.push(r);
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.id.padEnd(22)} turns=${r.turns} tools=[${r.tools.join(",")}] ${formatUsd(r.cost)} ${r.ms}ms`);
    for (const f of r.failures) console.log(`      - ${f}`);
    if (!r.pass) console.log(`      output: ${r.output.slice(0, 300).replace(/\n/g, " ")}`);
  }
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed · ${formatUsd(results.reduce((s, r) => s + r.cost, 0))} total`);
  if (passed !== results.length) process.exit(1);
}
main();
```

Here is a real run of those three cases on Claude Sonnet 5.5 (2026-11-04):

```
PASS  tool-use-time          turns=2 tools=[get_time] $0.0024 2114ms
PASS  no-tool-arithmetic     turns=1 tools=[] $0.0009 1130ms
PASS  honest-limits          turns=1 tools=[] $0.0027 2275ms

3/3 passed · $0.0060 total
```

When a case fails, the reasons and the start of the answer are printed under it:

```
FAIL  honest-limits          turns=1 tools=[] ...
      - no match for /can(?:'|’)?t|cannot|unable|don(?:'|’)?t have|no (?:email|tool)/i
      output: <first 300 characters of the agent's answer>
```

Printing the output of failed cases is what makes this usable. Half of the time the failure shows the check was too strict ("I'm not able to" was not in the pattern); the other half it shows a real regression. You decide which in five seconds.

Running cases one after another, not in parallel, is on purpose: it keeps the output in order and stays well inside rate limits. With a dozen cases that finishes in under a minute.

## Run it on every model you might switch to

The cheapest experiment in AI engineering is running the same eval on a cheaper model:

```bash
npm run eval -- --model claude-haiku-5-5
npm run eval -- --model claude-sonnet-5-5
```

The same three cases on Claude Haiku 5.5 also passed 3/3, for $0.0003 in total instead of $0.0060. If Haiku passes everything your product needs, you have just found a large cost cut with evidence behind it. If it fails one case, you know exactly which behaviour you would be giving up. Because the runner prints cost per case, you get both halves of the decision in one table.

## Put it in CI

The non-zero exit code is the whole integration:

```yaml
# .github/workflows/eval.yml
on:
  pull_request:
    paths: ["lib/agent/**", "evals/**"]
jobs:
  eval:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run eval -- --model claude-haiku-5-5
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

Restricting it to changes under `lib/agent/` keeps cost near zero: evals run when the prompt, tools or loop change, not on every CSS fix. Three cases on Haiku cost $0.0003 in our run; a few dozen still cost well under a cent.

## Growing the case list

Start with five to ten cases and add one whenever something goes wrong:

- **Every bug report about agent behaviour becomes a case** before you fix it. Watch it fail, fix the prompt or tool, watch it pass.
- **One case per tool** that clearly needs it, and one similar-sounding question that does not.
- **One case per refusal boundary**: things the agent must decline or say it cannot do.
- **One multi-step case** with a `maxTurns` bound, to catch loops.

When string checks are no longer enough (tone, helpfulness, "is this summary faithful"), add a model-graded check for those specific cases. Keep the deterministic checks too; they are free, fast and never disagree with themselves.

Save results with the model name and date (a `--json out.json` flag is a few more lines), so you can compare a run today with one from last month. If you store costs, also store which price table they were computed with; we wrote about why in [Model prices change. Snapshot them on every usage row](/blog/snapshot-llm-prices-per-request/).

<!-- site-only -->

*This eval runner ships in Agentwright Starter with three starter cases, a `--json` report and cost per case. Launch price $99; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code before publishing.*

<!-- /site-only -->
