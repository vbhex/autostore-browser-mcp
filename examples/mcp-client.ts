/**
 * Minimal MCP client wrapper used by the example drivers.
 *
 * Spawns our own dist/index.js as a stdio child and lets callers `call(tool, args)`
 * against it like a normal async RPC. This is the same handshake the AutoStore
 * Mac app (or Claude Code, or Cursor) would use — just no LLM in the loop yet.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __dirname is dist/examples/ at runtime; server lives at dist/src/index.js
const SERVER_ENTRY = join(__dirname, "..", "src", "index.js");

export interface McpSession {
  client: Client;
  call: <T = any>(name: string, args: Record<string, any>) => Promise<T>;
  close: () => Promise<void>;
}

export async function connect(opts: { headless?: boolean } = {}): Promise<McpSession> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      AUTOSTORE_BROWSER_HEADLESS: opts.headless ? "true" : "false",
    },
  });

  const client = new Client({ name: "etsy-driver", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);

  const call = async <T>(name: string, args: Record<string, any>): Promise<T> => {
    const res: any = await client.callTool({ name, arguments: args });
    if (res.isError) throw new Error(res.content?.[0]?.text ?? `${name} failed`);
    const text = res.content?.[0]?.text ?? "{}";
    return JSON.parse(text) as T;
  };

  return {
    client,
    call,
    close: async () => {
      try {
        await client.close();
      } catch {
        /* already gone */
      }
    },
  };
}

/**
 * Sleep helper — used between MCP calls when the LLM would normally
 * deliberate. For deterministic drivers, short pauses look like a human.
 */
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
