/**
 * Tool surface for the LLM.
 *
 * Design notes:
 * - Every tool takes a `profile` (required) so the LLM is always thinking about
 *   which store cookie jar it's in. Profiles: "amazon" | "ebay" | "etsy" | any.
 * - `tab` is optional — omitted means "most recent tab on this profile".
 * - Selectors use Playwright syntax, which includes shadow-DOM piercing via
 *   `css=...`, `>>` chaining, and `role=button[name="Upload"]`. This is the key
 *   reason we picked Playwright over Puppeteer — Amazon's Seller Central Katal
 *   components are shadow DOM, and Playwright pierces them by default.
 * - We never return raw Page/Locator objects — only JSON.
 */
import { z } from "zod";
import { readFileSync } from "fs";
import {
  getPage,
  openTab,
  listTabs,
  closeTab,
  closeProfile,
} from "./browser.js";

const Profile = z.string().min(1).describe("Named cookie profile: 'amazon', 'ebay', 'etsy', or any string.");
const Tab = z.string().optional().describe("Tab id from open_tab / list_tabs. Omit for most recent.");
const Selector = z.string().describe("Playwright selector. Pierces shadow DOM. Examples: 'input[name=\"email\"]', 'role=button[name=\"Save\"]', 'text=Submit'.");
const Timeout = z.number().int().positive().max(120_000).default(30_000).describe("Max milliseconds to wait.");

export const toolDefs = [
  {
    name: "open_tab",
    description: "Open a new browser tab on the given profile, optionally navigating to a URL. Returns a tab id.",
    inputSchema: z.object({
      profile: Profile,
      url: z.string().url().optional(),
    }),
    handler: async ({ profile, url }: { profile: string; url?: string }) => {
      const r = await openTab(profile, url);
      return { tab: r.tabId, title: r.title };
    },
  },

  {
    name: "navigate",
    description: "Navigate an existing tab to a new URL. Waits for DOM content loaded.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      url: z.string().url(),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, url, timeout }: any) => {
      const page = await getPage(profile, tab);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return { url: page.url(), title: await page.title() };
    },
  },

  {
    name: "list_tabs",
    description: "List all live tabs on a profile.",
    inputSchema: z.object({ profile: Profile }),
    handler: async ({ profile }: { profile: string }) => ({ tabs: await listTabs(profile) }),
  },

  {
    name: "close_tab",
    description: "Close a specific tab.",
    inputSchema: z.object({ profile: Profile, tab: z.string() }),
    handler: async ({ profile, tab }: any) => {
      await closeTab(profile, tab);
      return { closed: tab };
    },
  },

  {
    name: "close_profile",
    description: "Close all tabs on a profile and release its browser context. Cookies persist on disk.",
    inputSchema: z.object({ profile: Profile }),
    handler: async ({ profile }: { profile: string }) => {
      await closeProfile(profile);
      return { closed: profile };
    },
  },

  {
    name: "click",
    description: "Click an element. Pierces shadow DOM. Fails if the element is not visible/enabled within timeout.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      timeout: Timeout,
      force: z.boolean().default(false).describe("Bypass actionability checks. Use only as a last resort."),
    }),
    handler: async ({ profile, tab, selector, timeout, force }: any) => {
      const page = await getPage(profile, tab);
      await page.locator(selector).first().click({ timeout, force });
      return { clicked: selector };
    },
  },

  {
    name: "fill",
    description: "Fill a text input, textarea, or contenteditable. Clears existing content first.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      value: z.string(),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, value, timeout }: any) => {
      const page = await getPage(profile, tab);
      await page.locator(selector).first().fill(value, { timeout });
      return { filled: selector, length: value.length };
    },
  },

  {
    name: "select_option",
    description: "Choose an option in a <select> element. Value or label both work.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      value: z.string(),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, value, timeout }: any) => {
      const page = await getPage(profile, tab);
      const picked = await page.locator(selector).first().selectOption(value, { timeout });
      return { picked };
    },
  },

  {
    name: "upload_file",
    description: "Attach a local file to an <input type=file>. Path must be absolute.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      path: z.string().describe("Absolute path to the file on the host. Read to verify existence before attaching."),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, path, timeout }: any) => {
      const page = await getPage(profile, tab);
      // Fail fast with a helpful error if the file is missing.
      readFileSync(path);
      await page.locator(selector).first().setInputFiles(path, { timeout });
      return { uploaded: path };
    },
  },

  {
    name: "press_key",
    description: "Press a keyboard key (Enter, Tab, Escape, ArrowDown, etc.) on the focused element.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      key: z.string(),
    }),
    handler: async ({ profile, tab, key }: any) => {
      const page = await getPage(profile, tab);
      await page.keyboard.press(key);
      return { pressed: key };
    },
  },

  {
    name: "wait_for",
    description: "Wait for an element to reach a state: 'visible', 'hidden', 'attached', or 'detached'.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      state: z.enum(["visible", "hidden", "attached", "detached"]).default("visible"),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, state, timeout }: any) => {
      const page = await getPage(profile, tab);
      await page.locator(selector).first().waitFor({ state, timeout });
      return { ready: selector, state };
    },
  },

  {
    name: "get_text",
    description: "Return the visible text of an element (or the empty string if it has none).",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, timeout }: any) => {
      const page = await getPage(profile, tab);
      const text = await page.locator(selector).first().innerText({ timeout });
      return { text };
    },
  },

  {
    name: "get_attribute",
    description: "Return a single attribute value from an element (e.g. 'href', 'value', 'data-id').",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector,
      name: z.string(),
      timeout: Timeout,
    }),
    handler: async ({ profile, tab, selector, name, timeout }: any) => {
      const page = await getPage(profile, tab);
      const value = await page.locator(selector).first().getAttribute(name, { timeout });
      return { value };
    },
  },

  {
    name: "eval",
    description:
      "Run a JS expression in the page and return the result. Must be JSON-serializable. Prefer this over scraping with many get_text calls.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      expression: z.string().describe("A JavaScript expression or an IIFE. Runs in the page context."),
    }),
    handler: async ({ profile, tab, expression }: any) => {
      const page = await getPage(profile, tab);
      // Wrap bare expressions so the LLM doesn't have to `return` things.
      const wrapped = `(async () => (${expression}))()`;
      const result = await page.evaluate(wrapped);
      return { result };
    },
  },

  {
    name: "screenshot",
    description:
      "Capture a PNG screenshot of the page (or a specific element). Returns base64. Use sparingly — these are large.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector.optional().describe("If set, screenshot just this element."),
      full_page: z.boolean().default(false),
    }),
    handler: async ({ profile, tab, selector, full_page }: any) => {
      const page = await getPage(profile, tab);
      const buf = selector
        ? await page.locator(selector).first().screenshot()
        : await page.screenshot({ fullPage: full_page });
      return { png_base64: buf.toString("base64") };
    },
  },

  {
    name: "snapshot",
    description:
      "Return an ARIA snapshot of the page — a YAML-ish tree of name/role for each interactive node. Best first tool when landing on a new page: cheaper than a screenshot and structured for reasoning. Pass a selector to snapshot just a subtree.",
    inputSchema: z.object({
      profile: Profile,
      tab: Tab,
      selector: Selector.optional(),
    }),
    handler: async ({ profile, tab, selector }: any) => {
      const page = await getPage(profile, tab);
      const root = selector ? page.locator(selector).first() : page.locator("body");
      const yaml = await root.ariaSnapshot();
      return { snapshot: yaml };
    },
  },

  {
    name: "current_url",
    description: "Return the current URL and title of a tab.",
    inputSchema: z.object({ profile: Profile, tab: Tab }),
    handler: async ({ profile, tab }: any) => {
      const page = await getPage(profile, tab);
      return { url: page.url(), title: await page.title() };
    },
  },
] as const;
