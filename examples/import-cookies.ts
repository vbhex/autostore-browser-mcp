/**
 * Transplant Puppeteer-style cookies (the format used by the legacy
 * ebay/ and amazon/ projects) into a browser-mcp Playwright persistent
 * profile. Skips the interactive login flow entirely when the old
 * projects already have a working session on disk.
 *
 *   node dist/examples/import-cookies.js --profile ebay \
 *     --from ~/projects/autostore/ebay/data/ebay-cookies.json
 *
 *   node dist/examples/import-cookies.js --profile amazon \
 *     --from ~/projects/autostore/amazon/data/amazon-cookies.json
 *
 * After import, the next time any MCP tool calls `open_tab` with the
 * same profile name, the persistent context picks up these cookies and
 * Seller Hub / Seller Central opens already authenticated. No password
 * or 2FA needed.
 *
 * Puppeteer exports CDP-format cookies with fields Playwright doesn't
 * recognise (priority, sourceScheme, sameParty, size, session). We strip
 * those and map everything else directly onto Playwright's Cookie type.
 */
import { chromium, type Cookie } from "playwright";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join, isAbsolute, resolve } from "path";
import { mkdirSync } from "fs";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k: string) => {
    const i = args.indexOf(k);
    if (i < 0) return undefined;
    return args[i + 1];
  };
  const profile = get("--profile");
  const from = get("--from");
  if (!profile || !from) {
    console.error("usage: import-cookies --profile <name> --from <path-to-cookies.json>");
    process.exit(2);
  }
  return { profile, from };
}

interface PuppeteerCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;       // unix seconds, -1 = session
  httpOnly?: boolean;
  secure?: boolean;
  session?: boolean;
  sameSite?: string;      // "Strict" | "Lax" | "None" | "no_restriction" | "unspecified"
  // CDP extras we drop:
  priority?: string;
  sourceScheme?: string;
  sameParty?: boolean;
  size?: number;
}

function normalizeSameSite(raw: unknown): Cookie["sameSite"] | undefined {
  if (typeof raw !== "string") return undefined;
  const low = raw.toLowerCase();
  if (low === "strict") return "Strict";
  if (low === "lax") return "Lax";
  if (low === "none" || low === "no_restriction") return "None";
  return undefined; // "unspecified" etc.
}

function toPlaywright(c: PuppeteerCookie): Cookie | null {
  if (!c.name || c.value === undefined) return null;
  const out: Cookie = {
    name: c.name,
    value: c.value,
    domain: c.domain ?? "",
    path: c.path ?? "/",
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    // Playwright wants -1 for session cookies.
    expires: typeof c.expires === "number" && c.expires > 0 ? c.expires : -1,
    sameSite: normalizeSameSite(c.sameSite) ?? "Lax",
  };
  return out;
}

const DATA_ROOT =
  process.env.AUTOSTORE_BROWSER_DATA_DIR ??
  join(homedir(), ".autostore-browser-mcp", "profiles");

async function main() {
  const { profile, from } = parseArgs();
  const fromAbs = isAbsolute(from) ? from : resolve(process.cwd(), from);

  console.log(`[import-cookies] reading ${fromAbs}`);
  const raw: PuppeteerCookie[] = JSON.parse(readFileSync(fromAbs, "utf8"));
  console.log(`[import-cookies] loaded ${raw.length} cookies`);

  const cookies = raw.map(toPlaywright).filter((c): c is Cookie => c !== null);
  const dropped = raw.length - cookies.length;
  if (dropped) console.log(`[import-cookies] dropped ${dropped} invalid cookies`);

  const profileDir = join(DATA_ROOT, profile);
  mkdirSync(profileDir, { recursive: true });
  console.log(`[import-cookies] target profile dir: ${profileDir}`);

  // Launch persistent context briefly just to write cookies, then close.
  // Headless is fine — we're not navigating anywhere.
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  });

  try {
    await context.addCookies(cookies);
    const after = await context.cookies();
    console.log(`[import-cookies] ✅ profile "${profile}" now has ${after.length} cookies`);
  } finally {
    await context.close();
  }
}

main().catch((e) => { console.error("[import-cookies] failed:", e); process.exit(1); });
