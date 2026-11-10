---
title: "Build a remote MCP server on Cloudflare Pages without an SDK (about 200 lines of TypeScript)"
description: "A stateless Streamable HTTP MCP server in one Cloudflare Pages Function: the four JSON-RPC methods clients actually call, notifications, errors, CORS, testing with the official client, and publishing to the MCP Registry with DNS auth."
date: 2026-11-10
slug: remote-mcp-server-cloudflare-without-sdk
tags: [mcp, cloudflare, typescript, claude]
---

<p class="lede">If your MCP server only answers questions (look something up, compute something, return text), you do not need a framework, a session store or a long-lived process. One HTTP handler that speaks JSON-RPC is enough, and it runs for free on Cloudflare Pages Functions or Workers.</p>

This post walks through the server we run at `https://agentwright.app/mcp`. It gives Claude, Cursor or any MCP client current Claude API prices and cost estimates. The full source is public in [functions/mcp.ts](https://github.com/agentwright-app/site/blob/main/functions/mcp.ts); the snippets below are trimmed from it.

## What a client actually sends

With the Streamable HTTP transport, everything goes to one URL as an HTTP `POST` with a JSON-RPC body. For a tools-only server, a client session looks like this:

1. `initialize`: the client sends the protocol version it wants and its capabilities. You answer with the version you will speak, your capabilities and your name.
2. `notifications/initialized`: a notification (no `id`), so there is nothing to answer. Reply `202 Accepted` with an empty body.
3. `tools/list`: return your tool definitions with JSON Schema inputs.
4. `tools/call`: run one tool and return its result as content blocks.

Add `ping` (answer `{}`) and you have covered what Claude Code, Claude Desktop, Cursor and the official SDK client do with a tools-only server.

The transport also lets a server answer with a `text/event-stream` and open a `GET` stream for server-to-client messages. Both are optional. If every answer is a single JSON object, reply with `Content-Type: application/json`, and answer `GET` with `405 Method Not Allowed`; clients treat that as "no server stream" and carry on.

## The handler

```ts
export const onRequestPost: PagesFunction = async ({ request }) => {
  const text = await request.text();
  if (text.length > 64_000) return json(rpcError(null, -32600, "Request too large"), 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, -32700, "Parse error"), 400);
  }

  const out = handle(body as Rpc);              // null for notifications
  return out ? json(out) : new Response(null, { status: 202 });
};

export const onRequestGet: PagesFunction = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
```

`handle` is a plain `switch` on `msg.method`:

```ts
function handle(msg: Rpc): object | null {
  if (msg.id === undefined || msg.id === null) return null; // notification
  switch (msg.method) {
    case "initialize":
      return ok(msg.id, {
        protocolVersion: SUPPORTED.includes(msg.params?.protocolVersion)
          ? msg.params.protocolVersion
          : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "claude-pricing", version: "1.0.0" },
      });
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call":
      return ok(msg.id, runTool(msg.params?.name, msg.params?.arguments ?? {}));
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}
```

Two details matter here.

**Version negotiation.** Echo the client's `protocolVersion` if you support it, otherwise answer with your newest one. A stateless tools-only server behaves the same under the recent spec versions, so supporting several costs nothing.

**Two kinds of errors.** An unknown method or unknown tool is a protocol error: a JSON-RPC `error` object. A tool that ran but could not do the job (bad model name, negative token count) should return a normal result with `isError: true` and a readable message. The model sees that text and can correct its own call. If you throw a protocol error instead, many clients show a generic failure and the model never learns what went wrong.

```ts
function runTool(name: string, args: Record<string, unknown>) {
  try {
    return { content: [{ type: "text", text: callTool(name, args) }], isError: false };
  } catch (e) {
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}
```

## Tool definitions the model uses well

Each tool has a name, a one-sentence description of when to use it, and an `inputSchema`. Put units and defaults in the property descriptions, because that is the only documentation the model reads:

```ts
{
  name: "estimate_claude_cost",
  description: "Estimate the USD cost of Claude API calls from token counts. Handles prompt caching, the Batch API discount and long-prompt pricing.",
  inputSchema: {
    type: "object",
    properties: {
      model: { type: "string", description: "Model id, e.g. claude-sonnet-5-5" },
      input_tokens: { type: "number", minimum: 0, description: "Uncached input tokens per request" },
      output_tokens: { type: "number", minimum: 0, description: "Output tokens per request (includes thinking tokens)" },
      requests: { type: "number", minimum: 0, description: "Number of requests (default 1)" },
      batch: { type: "boolean", description: "Use Batch API pricing (default false)" },
    },
    required: ["model", "input_tokens", "output_tokens"],
  },
  annotations: { readOnlyHint: true },
}
```

`readOnlyHint` tells clients the tool changes nothing, so some of them skip the confirmation prompt. More on descriptions in [How to write tool descriptions Claude uses well](/blog/write-tool-descriptions-claude-uses-well/).

## CORS and the Origin header

Browser-based clients (the MCP Inspector, web IDEs) need CORS: answer `OPTIONS` with `204` and send `Access-Control-Allow-Origin` plus the headers clients use (`content-type`, `accept`, `mcp-protocol-version`, `mcp-session-id`).

The spec also asks servers to validate the `Origin` header to stop DNS-rebinding attacks. That matters for servers that sit on `localhost` or act with the user's credentials. Ours is public, read-only and has no authentication, so there is nothing for a rebinding page to steal, and allowing every origin is fine. If your server reads private data, check `Origin` against an allowlist and require a bearer token.

## Testing with the official client

Before publishing, connect with the same SDK most clients use:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://agentwright.app/mcp")));
console.log((await client.listTools()).tools.map((t) => t.name));
console.log(await client.callTool({ name: "list_claude_models", arguments: {} }));
await client.close();
```

If that works, Claude Code works too:

```bash
claude mcp add --transport http claude-pricing https://agentwright.app/mcp
```

## Publishing to the MCP Registry

The [official MCP Registry](https://registry.modelcontextprotocol.io) lists servers by a namespaced name. If you own a domain, you can prove it with a DNS record instead of a GitHub login, and your server gets a reverse-DNS name such as `app.agentwright/claude-pricing`.

1. Generate an Ed25519 key and print the TXT value: `openssl genpkey -algorithm Ed25519 -out key.pem`, then take the last 32 bytes of the public key as base64 and publish `v=MCPv1; k=ed25519; p=<base64>` as a TXT record on the domain.
2. Write a `server.json` with `name`, `description`, `version` and a `remotes` entry of type `streamable-http` pointing at your URL.
3. Run `mcp-publisher login dns --domain <domain> --private-key <hex>` and `mcp-publisher publish`.

The [registry documentation](https://modelcontextprotocol.io/registry/authentication) has the exact commands. Keep the private key out of your repository; you can always generate a new key and replace the TXT record when you publish the next version.

## When to use an SDK instead

This approach stops being the simple option when you need any of these:

- **Streaming progress** for long tool calls (an SSE response with progress notifications).
- **Server-to-client requests**, such as sampling or elicitation, which need a session.
- **Resources and prompts** with subscriptions and change notifications.
- **OAuth** for user-specific data.

For those, the official TypeScript SDK (or Cloudflare's agents library on Workers) handles sessions and streams for you. For a read-only lookup or calculator, one function and a `switch` are easier to read, test and keep running.
