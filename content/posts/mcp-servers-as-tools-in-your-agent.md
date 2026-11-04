---
title: "Use MCP servers as tools in your own Claude agent loop (stdio and HTTP, in TypeScript)"
description: "Connect Model Context Protocol servers to a hand-written Claude agent: one config variable, stdio and Streamable HTTP transports, namespaced tool names, an allowlist, error handling, and the cache detail most examples miss. Plus when the API's MCP connector is the simpler choice."
date: 2026-11-10
slug: mcp-servers-as-tools-in-your-agent
tags: [claude, mcp, agents, typescript]
---

<p class="lede">The Model Context Protocol (MCP) lets you plug existing tool servers (filesystems, databases, GitHub, your own internal APIs) into an agent without writing a tool wrapper for each one. This post connects MCP servers to a hand-written Claude agent loop in TypeScript, so MCP tools and your own tools sit in one registry and the loop does not know the difference.</p>

The code uses the official `@modelcontextprotocol/sdk` client and `@anthropic-ai/sdk`. It assumes you already have an agent loop that takes a list of tool definitions and a `runTool(name, input)` function; if not, our [comparison of agent loop options](/blog/claude-agent-sdk-vs-your-own-tool-loop/) has one.

## Two ways to use MCP with Claude

Before writing code, pick the right side of the wire:

| | MCP client in your app (this post) | MCP connector in the API |
|---|---|---|
| Who connects to the server | Your server process | Anthropic's API |
| Transports | stdio (local processes) and HTTP | Remote HTTP servers only |
| Tool calls run | In your loop, where you can log, meter and block them | Inside the API request |
| Works with private networks | Yes | Only if the server is reachable from the internet |

The API's MCP connector (`mcp_servers` on the request plus an `mcp_toolset` entry in `tools`, behind a beta header) is less code when you only need a public remote server. Running the client yourself is the better fit when you need local stdio servers, servers on a private network, or control over every call: per-user permissions, logging, and counting tool calls against a plan.

## One environment variable for all servers

Configure servers as JSON, so adding one is a config change rather than a code change:

```bash
MCP_SERVERS='{
  "fs":   { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"], "allowTools": ["read_file", "list_directory"] },
  "docs": { "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
}'
```

A server with `command` is started as a child process and spoken to over stdio. A server with `url` is reached over Streamable HTTP. Validate the shape with zod so a typo fails loudly at startup instead of at the first tool call:

```ts
import { z } from "zod";

const StdioServer = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  allowTools: z.array(z.string()).optional(),
});
const HttpServer = z.object({
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  allowTools: z.array(z.string()).optional(),
});
export const McpConfig = z.record(z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), z.union([StdioServer, HttpServer]));
```

The server name is restricted to characters that are valid in a Claude tool name, because it becomes part of every tool name below.

## Connect and register tools

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function connectMcpServer(name: string, cfg: z.infer<typeof StdioServer> | z.infer<typeof HttpServer>) {
  const transport =
    "url" in cfg
      ? new StreamableHTTPClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
      : new StdioClientTransport({ command: cfg.command, args: cfg.args, env: { ...(process.env as Record<string, string>), ...cfg.env }, stderr: "pipe" });

  const client = new Client({ name: "my-saas-agent", version: "1.0.0" });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const allow = cfg.allowTools ? new Set(cfg.allowTools) : undefined;

  for (const tool of tools) {
    if (allow && !allow.has(tool.name)) continue;
    defineRawTool({
      name: `${name}__${tool.name}`.slice(0, 64),
      description: tool.description ?? `${tool.name} (from MCP server "${name}")`,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      source: `mcp:${name}`,
      run: async (input) => {
        const result = await client.callTool({ name: tool.name, arguments: (input ?? {}) as Record<string, unknown> });
        if (result.isError) throw new Error(contentToText(result.content));
        return result.structuredContent ?? contentToText(result.content);
      },
    });
  }
  return client;
}
```

What each choice is for:

- **`<server>__<tool>` names.** Two servers can both expose `search`. Prefixing with the server name keeps names unique and tells you in logs where a call went. Claude tool names are limited to 64 characters, hence the `slice`.
- **MCP's `inputSchema` is already JSON Schema**, which is exactly what Claude's `input_schema` expects, so it passes straight through. Your own tools can keep using zod and convert; the registry stores both kinds the same way.
- **`allowTools`.** Many servers expose more than you want an agent to have. The filesystem server can write and move files; for a read-only assistant, allow only the reading tools. This is your permission boundary, so default to listing tools explicitly for anything that can change data.
- **`isError` becomes a thrown error**, which the agent loop turns into a `tool_result` with `is_error: true`. Claude sees the message and can try another approach, instead of the whole run failing.
- **`stderr: "pipe"`** keeps a chatty child process from writing into your app's logs unasked.

MCP results are a list of content blocks. Flatten them into text for the model:

```ts
function contentToText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content);
  return content
    .map((b) => (b?.type === "text" ? String(b.text) : b?.type === "resource" && b.resource?.text ? String(b.resource.text) : `[${b?.type ?? "unknown"} content omitted]`))
    .join("\n");
}
```

## Connect once per process

Starting a stdio server takes a moment, and an HTTP handshake is a round trip. Do it once, not per request, and make it safe to call from every request handler:

```ts
let connecting: Promise<unknown[]> | undefined;

export function connectMcpServers(config = loadMcpConfig()) {
  connecting ??= Promise.all(
    Object.entries(config).map(([name, cfg]) =>
      connectMcpServer(name, cfg).catch((e) => {
        console.error(`[mcp] failed to connect "${name}": ${(e as Error).message}`);
        return undefined; // one broken server must not take the agent down
      }),
    ),
  );
  return connecting;
}
```

Call `await connectMcpServers()` at the top of your agent loop. The first request pays the connection cost; later requests reuse it. If one server is down, the agent still runs with the others, and the error is in your logs.

On serverless hosts, "once per process" means once per cold start. That is fine for HTTP servers. For stdio servers, prefer a long-running Node process, because spawning `npx` on every cold start is slow.

## The detail that costs money: tool order

Claude renders tool definitions at the very start of every request, before the system prompt, and prompt caching matches the request as an exact prefix. If your tool list comes out in a different order on two requests, the cache misses on both, for every user.

MCP makes this easy to get wrong: servers connect in parallel and finish in whatever order the network allows, so a registry filled in connection order is not stable across processes. Sort when you build the list:

```ts
export function toolDefinitions(): Anthropic.Tool[] {
  return [...registry.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.toJsonSchema() as Anthropic.Tool.InputSchema }));
}
```

Then check `usage.cache_read_input_tokens` on the second request; it should be above zero. Our post on [prompt caching in an agent loop](/blog/prompt-caching-claude-agent-loop/) covers the other silent cache breakers.

## Security notes

- **Treat MCP tool output as untrusted input.** A document read by a filesystem server or a page fetched by a web server can contain instructions aimed at the model. Keep the tools an agent can reach in one run proportionate: an agent that reads arbitrary documents should not also have a tool that sends email or deletes data.
- **Scope per user, not per process.** The registry above is global. If different customers should reach different data, pass the user's credentials in the HTTP `headers` per connection, or check the user inside `run` before forwarding the call.
- **Keep secrets in the environment.** Server configs often carry tokens. Read them from env vars at startup; never put them in the system prompt or tool descriptions, which are sent to the model.

## Testing a server before wiring it in

The official filesystem server is a good first test because it needs no account:

```bash
mkdir -p /tmp/mcp-demo && echo "hello from MCP" > /tmp/mcp-demo/note.txt
MCP_SERVERS='{"fs":{"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem","/tmp/mcp-demo"]}}' npm run dev
```

Ask the agent "What does note.txt say?" and you should see a call to an `fs__` tool followed by the answer. This first run exposes every tool the server has. Tool names differ between server versions, so log them once (`client.listTools()`), then copy the exact names you want into `allowTools` before giving the agent to users.

<!-- site-only -->

*Agentwright Starter includes this MCP layer (stdio and HTTP, allowlists, sorted tool names, a status helper) wired into its streaming agent loop and usage metering. It launches in December 2026; see the [FAQ](/faq/).*

**Questions or corrections?** Please leave them in the comments below. We check them every day and answer there.

*This post was written with AI assistance (Claude) and reviewed against the code before publishing.*

<!-- /site-only -->
