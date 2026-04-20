#!/usr/bin/env node
/**
 * MCP stdio server. Exposes a Playwright-backed browser to any MCP-speaking LLM
 * (the AutoStore Mac app's agent, Claude Code, Cursor, etc.).
 *
 * Run: `node dist/index.js` — communicates over stdin/stdout. No network listener.
 *
 * Env:
 *   AUTOSTORE_BROWSER_HEADLESS=true    Run headless (default: headed, so you can see listing jobs).
 *   AUTOSTORE_BROWSER_DATA_DIR=/path   Override profile storage dir.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toolDefs } from "./tools.js";
import { shutdownAll } from "./browser.js";

const server = new Server(
  { name: "autostore-browser-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefs.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as any,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: rawArgs } = req.params;
  const tool = toolDefs.find((t) => t.name === name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  try {
    const args = tool.inputSchema.parse(rawArgs ?? {});
    const result = await (tool.handler as any)(args);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `${name} failed: ${err.message ?? err}` }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Keep stderr quiet — stdout is the MCP wire.
  process.stderr.write("autostore-browser-mcp ready\n");
}

async function shutdown() {
  try {
    await shutdownAll();
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((e) => {
  process.stderr.write(`fatal: ${e.stack ?? e}\n`);
  process.exit(1);
});
