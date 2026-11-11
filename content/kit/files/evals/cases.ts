/**
 * Golden eval cases. Each case sends one user message through the real agent loop
 * (same system prompt, same tools) and checks the final answer.
 *
 * Checks are deliberately simple so they are cheap to maintain:
 *  - `expectTools`:   tools the agent must call at least once
 *  - `expectNoTools`: the agent must not call any tool
 *  - `includes`:      case-insensitive substrings that must appear in the final text
 *  - `matches`:       regular expressions the final text must match
 *  - `maxTurns`:      upper bound on model turns (catches runaway loops)
 */
export type EvalCase = {
  id: string;
  input: string;
  expectTools?: string[];
  expectNoTools?: boolean;
  includes?: string[];
  matches?: RegExp[];
  maxTurns?: number;
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
    // The system prompt asks the agent to say plainly when it cannot do something.
    matches: [/can(?:'|’)?t|cannot|unable|don(?:'|’)?t have|no (?:email|tool)/i],
    maxTurns: 1,
  },
];
