import Anthropic from "@anthropic-ai/sdk";
import { toolDefinitions, runTool } from "./tools";
import { connectMcpServers } from "./mcp";

const client = new Anthropic();
const MAX_TURNS = 12;

/** Default model for the agent. Override per request or via AGENT_MODEL. */
export const DEFAULT_MODEL: Anthropic.Model = (process.env.AGENT_MODEL || "claude-sonnet-5-5") as Anthropic.Model;

export type LoopOptions = {
  /**
   * User to meter usage against. Omit it (eval runner, smoke tests) to skip the
   * database entirely: no plan-cap check and no usage_events row.
   */
  userId?: string;
  model?: Anthropic.Model;
  system: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  signal?: AbortSignal;
  onText?: (delta: string) => void;
  onToolCall?: (name: string, input: unknown) => void;
  onToolResult?: (name: string, result: unknown, isError: boolean) => void;
  onTurn?: (message: Anthropic.Message) => void;
};

export class AgentRefusedError extends Error {
  constructor(public readonly details: Anthropic.Message["stop_details"]) {
    super("The model declined this request.");
  }
}

/**
 * Streaming agent loop with tool calls, a max-turn guard and prompt caching on the
 * system prompt + tool definitions. Usage is metered per turn against the user's plan.
 *
 * Returns the full message history (input + everything the agent produced) so the
 * caller can persist it and continue the conversation later.
 */
export async function runAgent(opts: LoopOptions): Promise<Anthropic.MessageParam[]> {
  const model = opts.model ?? DEFAULT_MODEL;
  const messages = [...opts.messages];
  await connectMcpServers(); // no-op unless MCP_SERVERS is set
  const tools = toolDefinitions();
  // Metering is imported lazily so the loop can run without DATABASE_URL when no userId is given.
  const metering = opts.userId ? await import("@/lib/billing/metering") : undefined;
  // Fail before spending tokens if the model has no price row (it could not be metered).
  if (metering) await metering.assertPriced(model);

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (metering && opts.userId) await metering.assertWithinCap(opts.userId);

    const stream = client.messages.stream(
      {
        model,
        max_tokens: opts.maxTokens ?? 8192,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      },
      { signal: opts.signal },
    );

    stream.on("text", (t) => opts.onText?.(t));
    const final = await stream.finalMessage();

    if (metering && opts.userId) {
      await metering.recordUsage(opts.userId, model, {
        input: final.usage.input_tokens,
        output: final.usage.output_tokens,
        cacheRead: final.usage.cache_read_input_tokens ?? 0,
        cacheWrite: final.usage.cache_creation_input_tokens ?? 0,
      });
    }
    opts.onTurn?.(final);

    messages.push({ role: "assistant", content: final.content });

    if (final.stop_reason === "refusal") throw new AgentRefusedError(final.stop_details);
    if (final.stop_reason !== "tool_use") return messages;

    // Execute every tool call from this turn in parallel and return all results
    // in a single user message (required for parallel tool use to keep working).
    const toolUses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      toolUses.map(async (block): Promise<Anthropic.ToolResultBlockParam> => {
        opts.onToolCall?.(block.name, block.input);
        try {
          const result = await runTool(block.name, block.input);
          opts.onToolResult?.(block.name, result, false);
          return { type: "tool_result", tool_use_id: block.id, content: JSON.stringify(result) };
        } catch (e) {
          const message = (e as Error).message;
          opts.onToolResult?.(block.name, message, true);
          return { type: "tool_result", tool_use_id: block.id, content: `Tool error: ${message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }

  throw new Error(`Agent exceeded ${MAX_TURNS} turns`);
}
