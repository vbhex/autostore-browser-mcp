/**
 * Etsy login helper. Run this ONCE per machine to persist Shop Manager cookies
 * under the "etsy" profile. Subsequent driver runs reuse these cookies.
 *
 *   node dist/examples/etsy-login.js
 *
 * Opens a visible Chromium window, points it at etsy.com/your/shops. You log in
 * (email / password, Google SSO, whatever). When you see the Shop Manager
 * dashboard, press Enter in the terminal — we confirm the cookie and quit.
 */
import { connect } from "./mcp-client.js";
import readline from "readline";

const PROFILE = "etsy";
const START_URL = "https://www.etsy.com/your/shops/me";

async function waitForEnter(prompt: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  const { call, close } = await connect();
  try {
    console.log(`[etsy-login] opening ${START_URL}`);
    const { tab } = await call<{ tab: string }>("open_tab", { profile: PROFILE, url: START_URL });
    console.log(`[etsy-login] tab=${tab}. Log in in the browser, then come back.`);

    await waitForEnter("[etsy-login] press Enter once you see the Shop Manager dashboard ... ");

    const { url, title } = await call<{ url: string; title: string }>("current_url", { profile: PROFILE, tab });
    console.log(`[etsy-login] final url=${url}`);
    console.log(`[etsy-login] title=${title}`);

    if (url.includes("/signin") || url.includes("/sign-in")) {
      console.error("[etsy-login] still on a sign-in page — cookies NOT saved. Re-run when login is complete.");
      process.exit(1);
    }
    console.log("[etsy-login] ✅ cookies saved to ~/.autostore-browser-mcp/profiles/etsy");
  } finally {
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
