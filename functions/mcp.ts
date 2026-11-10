// Free remote MCP server: Claude API prices and cost estimates.
// Endpoint: POST https://agentwright.app/mcp (MCP Streamable HTTP, stateless, JSON responses only).
// Prices come from the same table as /tools/claude-api-cost-calculator/ (pricing.json), so updating
// that file + deploy updates both. No auth, no storage, no secrets. Listed in the official MCP Registry
// as app.agentwright/claude-pricing (see mcp/server.json).
import pricing from "../tools/claude-api-cost-calculator/pricing.json";

type Rates = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };
type Model = Rates & { id: string; name: string; longPrompt?: Rates & { thresholdTokens: number } };
const MODELS = pricing.models as Model[];
const CALC = "https://agentwright.app/tools/claude-api-cost-calculator/";
const VERSION = "1.0.0";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const footer = () =>
  `\n\nPrices: USD per million tokens, as of ${pricing.updated} (source: ${pricing.source}). ` +
  `Interactive calculator: ${CALC}`;

const num = { type: "number", minimum: 0 } as const;
const TOOLS = [
  {
    name: "list_claude_models",
    title: "List Claude models and prices",
    description:
      "List current Claude API models with their prices in USD per million tokens: input, output, prompt-cache writes (5 min / 1 h), cache reads, and the Batch API discount.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "estimate_claude_cost",
    title: "Estimate Claude API cost",
    description:
      "Estimate the USD cost of Claude API calls from token counts. Handles prompt caching (cache writes and reads), the Batch API 50% discount and long-prompt pricing. Returns cost per request and in total.",
    inputSchema: {
      type: "object",
      properties: {
        model: { type: "string", description: `Model id, e.g. ${MODELS.map((m) => m.id).join(", ")}` },
        input_tokens: { ...num, description: "Uncached input tokens per request" },
        output_tokens: { ...num, description: "Output tokens per request (includes thinking tokens)" },
        cache_write_5m_tokens: { ...num, description: "Tokens written to the 5-minute prompt cache per request" },
        cache_write_1h_tokens: { ...num, description: "Tokens written to the 1-hour prompt cache per request" },
        cache_read_tokens: { ...num, description: "Tokens read from the prompt cache per request" },
        requests: { ...num, description: "Number of requests (default 1)" },
        batch: { type: "boolean", description: "Use Batch API pricing (default false)" },
      },
      required: ["model", "input_tokens", "output_tokens"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "compare_claude_models",
    title: "Compare Claude model costs",
    description:
      "Compare what the same workload costs on every Claude model, cheapest first. Give tokens per request and the number of requests (e.g. per user per month).",
    inputSchema: {
      type: "object",
      properties: {
        input_tokens: { ...num, description: "Input tokens per request" },
        output_tokens: { ...num, description: "Output tokens per request" },
        requests: { ...num, description: "Number of requests (default 1)" },
        batch: { type: "boolean", description: "Use Batch API pricing (default false)" },
      },
      required: ["input_tokens", "output_tokens"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toPrecision(3)}` : `$${n.toFixed(n < 100 ? 4 : 2)}`);

function findModel(id: unknown): Model | undefined {
  const q = String(id ?? "").toLowerCase().trim();
  return MODELS.find((m) => m.id === q || m.name.toLowerCase() === q) ?? MODELS.find((m) => m.id.includes(q.replace(/\s+/g, "-")));
}

function cost(m: Model, a: Record<string, unknown>) {
  const n = (k: string) => {
    const v = Number(a[k] ?? 0);
    if (!Number.isFinite(v) || v < 0) throw new Error(`${k} must be a non-negative number`);
    return v;
  };
  const t = { input: n("input_tokens"), output: n("output_tokens"), w5: n("cache_write_5m_tokens"), w1: n("cache_write_1h_tokens"), read: n("cache_read_tokens") };
  const requests = a.requests === undefined ? 1 : n("requests");
  const promptTokens = t.input + t.w5 + t.w1 + t.read;
  const long = m.longPrompt && promptTokens > m.longPrompt.thresholdTokens;
  const r: Rates = long ? m.longPrompt! : m;
  const mult = a.batch ? pricing.batchDiscount : 1;
  const parts = {
    input: (t.input * r.input) / 1e6,
    output: (t.output * r.output) / 1e6,
    cacheWrite: (t.w5 * r.cacheWrite5m + t.w1 * r.cacheWrite1h) / 1e6,
    cacheRead: (t.read * r.cacheRead) / 1e6,
  };
  const perRequest = (parts.input + parts.output + parts.cacheWrite + parts.cacheRead) * mult;
  return { parts, perRequest, total: perRequest * requests, requests, long: !!long, mult };
}

function callTool(name: string, args: Record<string, unknown>): string {
  if (name === "list_claude_models") {
    const rows = MODELS.map(
      (m) =>
        `- ${m.name} (\`${m.id}\`): input $${m.input}, output $${m.output}, cache write 5m $${m.cacheWrite5m} / 1h $${m.cacheWrite1h}, cache read $${m.cacheRead}` +
        (m.longPrompt ? `; prompts over ${m.longPrompt.thresholdTokens.toLocaleString("en-US")} tokens: input $${m.longPrompt.input}, output $${m.longPrompt.output}` : ""),
    );
    return `Claude API prices (USD per million tokens). Batch API: ${pricing.batchDiscount * 100}% of these prices.\n${rows.join("\n")}${footer()}`;
  }
  if (name === "estimate_claude_cost") {
    const m = findModel(args.model);
    if (!m) throw new Error(`Unknown model "${args.model}". Known: ${MODELS.map((x) => x.id).join(", ")}`);
    const c = cost(m, args);
    const lines = [
      `${m.name}${c.mult < 1 ? " (Batch API)" : ""}${c.long ? " (long-prompt pricing)" : ""}`,
      `Per request: ${usd(c.perRequest)}  (input ${usd(c.parts.input * c.mult)}, output ${usd(c.parts.output * c.mult)}, cache writes ${usd(c.parts.cacheWrite * c.mult)}, cache reads ${usd(c.parts.cacheRead * c.mult)})`,
      `Total for ${c.requests.toLocaleString("en-US")} request(s): ${usd(c.total)}`,
    ];
    return lines.join("\n") + footer();
  }
  if (name === "compare_claude_models") {
    const rows = MODELS.map((m) => ({ m, c: cost(m, args) })).sort((x, y) => x.c.total - y.c.total);
    const requests = rows[0]?.c.requests ?? 1;
    return (
      `Same workload on every Claude model${args.batch ? " (Batch API)" : ""}, ${requests.toLocaleString("en-US")} request(s), cheapest first:\n` +
      rows.map(({ m, c }) => `- ${m.name}: ${usd(c.total)} total, ${usd(c.perRequest)} per request${c.long ? " (long-prompt pricing)" : ""}`).join("\n") +
      footer()
    );
  }
  throw new RpcError(-32602, `Unknown tool: ${name}`);
}

class RpcError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, any> };

function handle(msg: Rpc): object | null {
  const isRequest = msg.id !== undefined && msg.id !== null;
  try {
    if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") throw new RpcError(-32600, "Invalid Request");
    if (!isRequest) return null; // notifications (e.g. notifications/initialized) need no answer
    let result: object;
    switch (msg.method) {
      case "initialize": {
        const asked = msg.params?.protocolVersion;
        result = {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "claude-pricing", title: "Claude API Pricing (Agentwright)", version: VERSION, websiteUrl: CALC },
          instructions: "Look up current Claude API prices and estimate costs from token counts. All tools are read-only.",
        };
        break;
      }
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        if (!TOOLS.some((t) => t.name === name)) throw new RpcError(-32602, `Unknown tool: ${name}`);
        try {
          result = { content: [{ type: "text", text: callTool(name, msg.params?.arguments ?? {}) }], isError: false };
        } catch (e) {
          result = { content: [{ type: "text", text: (e as Error).message }], isError: true };
        }
        break;
      }
      case "resources/list":
        result = { resources: [] };
        break;
      case "prompts/list":
        result = { prompts: [] };
        break;
      default:
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
    return { jsonrpc: "2.0", id: msg.id, result };
  } catch (e) {
    const err = e instanceof RpcError ? e : new RpcError(-32603, "Internal error");
    return isRequest || err.code === -32600 ? { jsonrpc: "2.0", id: msg.id ?? null, error: { code: err.code, message: err.message } } : null;
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-expose-headers": "mcp-session-id",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...CORS } });

export const onRequestOptions: PagesFunction = async () => new Response(null, { status: 204, headers: CORS });

// No server-initiated stream: GET is not offered (spec allows 405). Browsers get a pointer instead.
export const onRequestGet: PagesFunction = async ({ request }) => {
  if ((request.headers.get("accept") ?? "").includes("text/html")) return Response.redirect("https://agentwright.app/tools/claude-pricing-mcp/", 302);
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });
};

export const onRequestDelete: PagesFunction = async () => new Response(null, { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });

export const onRequestPost: PagesFunction = async ({ request }) => {
  const text = await request.text();
  if (text.length > 64_000) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(body)) {
    const out = body.slice(0, 50).map((m) => handle(m as Rpc)).filter(Boolean);
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
  }
  const out = handle(body as Rpc);
  return out ? json(out) : new Response(null, { status: 202, headers: CORS });
};
