/**
 * Amazon Seller Central login helper. Run ONCE per machine to persist cookies
 * under the "amazon" profile. Subsequent agent-driven listing jobs reuse them.
 *
 *   node dist/examples/amazon-login.js
 *
 * Opens a visible Chromium window at Seller Central. Log in (password + 2FA —
 * Amazon almost always requires OTP). When you see the Seller Central home
 * (orders / inventory cards visible), press Enter and we confirm.
 *
 * NOTE: Seller Central sessions expire faster than marketplace sessions.
 * Expect to re-run this every ~2 weeks.
 */
import { connect } from "./mcp-client.js";
import readline from "readline";

const PROFILE = "amazon";
const START_URL = "https://sellercentral.amazon.com/";

async function waitForEnter(prompt: string) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<void>((resolve) => rl.question(prompt, () => { rl.close(); resolve(); }));
}

async function main() {
  const { call, close } = await connect();
  try {
    console.log(`[amazon-login] opening ${START_URL}`);
    const { tab } = await call<{ tab: string }>("open_tab", { profile: PROFILE, url: START_URL });
    console.log(`[amazon-login] tab=${tab}. Log in in the browser (2FA required), then come back.`);

    await waitForEnter("[amazon-login] press Enter once you see the Seller Central dashboard ... ");

    const { url, title } = await call<{ url: string; title: string }>("current_url", { profile: PROFILE, tab });
    console.log(`[amazon-login] final url=${url}`);
    console.log(`[amazon-login] title=${title}`);

    if (/signin|ap\/signin|login/i.test(url)) {
      console.error("[amazon-login] still on a sign-in page — cookies NOT saved. Re-run when login is complete.");
      process.exit(1);
    }
    console.log("[amazon-login] ✅ cookies saved to ~/.autostore-browser-mcp/profiles/amazon");
  } finally {
    await close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
