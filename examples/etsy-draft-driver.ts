/**
 * Etsy draft-creation driver.
 *
 *   node dist/examples/etsy-draft-driver.js --product ./examples/sample-product.json
 *
 * Proves the browser-MCP architecture end-to-end:
 *   1. Spawns autostore-browser-mcp over stdio (same path the Mac app will use)
 *   2. Reuses persistent `etsy` cookies (run etsy-login.js first)
 *   3. Navigates Shop Manager → "Add a listing"
 *   4. Fills title / description / price / quantity / tags
 *   5. Uploads up to 10 product images
 *   6. Saves as DRAFT (never publishes — preserves the per-product manual
 *      confirmation rule)
 *   7. Captures the draft URL and prints it
 *
 * This is NOT using an LLM yet. It's deterministic MCP calls. The point of
 * doing it this way first is to prove the tool surface is sufficient; once we
 * know the same MCP calls can drive the whole flow, swapping the driver for
 * an LLM loop is straightforward (each "step" below becomes a tool the LLM
 * can pick from based on the current page snapshot).
 *
 * --- Selector notes ---
 * Etsy's listing editor is at /your/shops/me/tools/listings/create . The DOM
 * uses stable `name=` attributes on most fields and human-readable `aria-label`
 * on buttons. Playwright's text= and role= selectors pierce nothing (no shadow
 * DOM here), so simple selectors work.
 */
import { connect, sleep } from "./mcp-client.js";
import { readFileSync, existsSync } from "fs";
import { resolve, isAbsolute } from "path";

const PROFILE = "etsy";
const LISTING_CREATE_URL = "https://www.etsy.com/your/shops/me/tools/listings/create";

interface EtsyProduct {
  title: string;              // <= 140 chars
  description: string;        // multi-line OK
  price_usd: number;
  quantity: number;
  tags: string[];             // <= 13 tags, each <= 20 chars
  image_paths: string[];      // <= 10 absolute paths
  // Optional: skipped for the MVP draft. Agent can revisit later.
  category?: string;
  who_made?: "i_did" | "collective" | "someone_else";
  when_made?: string;         // e.g. "made_to_order", "2020_2025"
  is_supply?: boolean;
}

function parseArgs(): { productPath: string } {
  const i = process.argv.indexOf("--product");
  if (i < 0 || !process.argv[i + 1]) {
    console.error("usage: etsy-draft-driver --product <path-to-product.json>");
    process.exit(2);
  }
  return { productPath: process.argv[i + 1] };
}

function loadProduct(p: string): EtsyProduct {
  const abs = isAbsolute(p) ? p : resolve(process.cwd(), p);
  const raw = JSON.parse(readFileSync(abs, "utf8"));

  // Validate + defaults.
  if (!raw.title) throw new Error("product.title is required");
  if (!raw.description) throw new Error("product.description is required");
  if (typeof raw.price_usd !== "number") throw new Error("product.price_usd must be a number");
  if (typeof raw.quantity !== "number") throw new Error("product.quantity must be a number");

  const tags: string[] = (raw.tags ?? []).slice(0, 13);
  const images: string[] = (raw.image_paths ?? [])
    .map((s: string) => (isAbsolute(s) ? s : resolve(abs, "..", s)))
    .slice(0, 10);

  for (const img of images) {
    if (!existsSync(img)) throw new Error(`image not found: ${img}`);
  }
  return { ...raw, tags, image_paths: images };
}

async function main() {
  const { productPath } = parseArgs();
  const product = loadProduct(productPath);
  console.log(`[driver] product: ${product.title.slice(0, 60)}...  $${product.price_usd} × ${product.quantity}`);

  const { call, close } = await connect();

  try {
    // ── 1. Open the listing editor. Persistent cookies should skip login. ──
    console.log(`[driver] opening ${LISTING_CREATE_URL}`);
    const { tab } = await call<{ tab: string }>("open_tab", { profile: PROFILE, url: LISTING_CREATE_URL });

    // ── 2. Verify we're not on a sign-in wall. ──
    await sleep(1500);
    const { url, title } = await call<{ url: string; title: string }>("current_url", { profile: PROFILE, tab });
    console.log(`[driver] landed on: ${url}`);
    console.log(`[driver] title: ${title}`);
    if (/sign.?in|login/i.test(url)) {
      throw new Error("Etsy redirected to sign-in — run etsy-login first to save cookies.");
    }

    // ── 3. Snapshot so we know what we're looking at. ──
    const { snapshot } = await call<{ snapshot: string }>("snapshot", { profile: PROFILE, tab });
    console.log(`[driver] aria snapshot head:\n${snapshot.split("\n").slice(0, 20).join("\n")}\n...(${snapshot.length} chars total)`);

    // ── 4. Upload images first — Etsy requires at least one before enabling the rest of the form. ──
    //      The file input is hidden behind a custom drop zone; targeting `input[type=file]` directly works.
    console.log(`[driver] uploading ${product.image_paths.length} image(s)`);
    await call("wait_for", { profile: PROFILE, tab, selector: 'input[type="file"]', state: "attached", timeout: 30_000 });
    // setInputFiles accepts one path per call; upload them serially so failures are easy to attribute.
    for (const img of product.image_paths) {
      console.log(`[driver]   + ${img}`);
      await call("upload_file", {
        profile: PROFILE, tab,
        selector: 'input[type="file"]',
        path: img,
      });
      await sleep(800); // let Etsy finish thumbnailing before the next
    }

    // ── 5. Title. Etsy's title field is a <textarea name="title">. ──
    console.log(`[driver] title`);
    await call("wait_for", { profile: PROFILE, tab, selector: 'textarea[name="title"], input[name="title"]', state: "visible" });
    await call("fill", { profile: PROFILE, tab, selector: 'textarea[name="title"], input[name="title"]', value: product.title });

    // ── 6. Description. ──
    console.log(`[driver] description (${product.description.length} chars)`);
    await call("fill", { profile: PROFILE, tab, selector: 'textarea[name="description"]', value: product.description });

    // ── 7. Who/When/Is-supply. Etsy requires these three before letting you save.
    //      They're <select>s. Values are stable internal codes. ──
    if (product.who_made) {
      await call("select_option", { profile: PROFILE, tab, selector: 'select[name="who_made"]', value: product.who_made });
    }
    if (product.when_made) {
      await call("select_option", { profile: PROFILE, tab, selector: 'select[name="when_made"]', value: product.when_made });
    }
    if (typeof product.is_supply === "boolean") {
      await call("select_option", {
        profile: PROFILE, tab,
        selector: 'select[name="is_supply"]',
        value: product.is_supply ? "true" : "false",
      });
    }

    // ── 8. Price + quantity. ──
    console.log(`[driver] price=$${product.price_usd} qty=${product.quantity}`);
    await call("fill", { profile: PROFILE, tab, selector: 'input[name="price"]', value: String(product.price_usd) });
    await call("fill", { profile: PROFILE, tab, selector: 'input[name="quantity"]', value: String(product.quantity) });

    // ── 9. Tags. Each tag is a chip — type + Enter. ──
    if (product.tags.length) {
      console.log(`[driver] tags: ${product.tags.join(", ")}`);
      const tagInput = 'input[name="tag"], input[aria-label*="tag" i]';
      for (const tag of product.tags) {
        await call("fill", { profile: PROFILE, tab, selector: tagInput, value: tag });
        await call("press_key", { profile: PROFILE, tab, key: "Enter" });
        await sleep(200);
      }
    }

    // ── 10. Save as DRAFT (not publish). ──
    //       Button label varies: sometimes "Save as draft", sometimes "Save and continue".
    //       Try both; the first match wins. The LLM will do this branching naturally later.
    console.log(`[driver] saving as draft (NEVER publishing — manual-confirmation rule)`);
    try {
      await call("click", {
        profile: PROFILE, tab,
        selector: 'role=button[name=/save.*draft/i]',
        timeout: 10_000,
      });
    } catch {
      await call("click", {
        profile: PROFILE, tab,
        selector: 'role=button[name=/save/i]',
        timeout: 10_000,
      });
    }

    // ── 11. Wait for redirect to drafts and capture the URL. ──
    await sleep(3000);
    const after = await call<{ url: string; title: string }>("current_url", { profile: PROFILE, tab });
    console.log(`[driver] ✅ draft saved`);
    console.log(`[driver]    url=${after.url}`);
    console.log(`[driver]    review and publish manually in the browser, per CLAUDE.md rule.`);
  } finally {
    // Leave the tab open so the user can inspect the draft. Close the MCP session.
    await close();
  }
}

main().catch((e) => {
  console.error("[driver] failed:", e.message ?? e);
  process.exit(1);
});
