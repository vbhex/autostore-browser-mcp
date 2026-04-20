/**
 * eBay login helper. Run this ONCE per machine to persist Seller Hub cookies
 * under the "ebay" profile. Subsequent agent-driven listing jobs reuse these
 * cookies so the LLM never has to handle credentials.
 *
 *   node dist/examples/ebay-login.js
 *
 * Opens a visible Chromium window at Seller Hub. Log in (password, 2FA, passkey,
 * whatever). When you see the Seller Hub dashboard, press Enter in the terminal
 * and we confirm the session stuck.
 */
import { connect } from "./mcp-client.js";
import readline from "readline";

const PROFILE = "ebay";
const START_URL = "https://www.ebay.com/sh/ovw";

async function waitForEnter(prompt: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  const { call, close } = await connect();
  try {
    console.log(`[ebay-login] opening ${START_URL}`);
    const { tab } = await call<{ tab: string }>("open_tab", { profile: PROFILE, url: START_URL });
    console.log(`[ebay-login] tab=${tab}. Log in in the browser, then come back.`);

    await waitForEnter("[ebay-login] press Enter once you see the Seller Hub dashboard ... ");

    const { url, title } = await call<{ url: string; title: string }>("current_url", { profile: PROFILE, tab });
    console.log(`[ebay-login] final url=${url}`);
    console.log(`[ebay-login] title=${title}`);

    if (/signin|sign-in|login/i.test(url)) {
      console.error("[ebay-login] still on a sign-in page — cookies NOT saved. Re-run when login is complete.");
      process.exit(1);
    }
    console.log("[ebay-login] ✅ cookies saved to ~/.autostore-browser-mcp/profiles/ebay");
  } finally {
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
