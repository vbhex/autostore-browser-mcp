/**
 * Browser lifecycle manager.
 *
 * One persistent context per "profile" (e.g. "amazon", "ebay", "etsy") so the
 * LLM can log in once and reuse cookies across sessions. Profiles are stored
 * under ~/.autostore-browser-mcp/profiles/<name>. Override with $AUTOSTORE_BROWSER_DATA_DIR.
 *
 * We hand out string tab IDs (tab_1, tab_2, …) so the LLM can address tabs
 * without leaking Playwright objects across the MCP wire.
 */
import { chromium, BrowserContext, Page } from "playwright";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

const DATA_ROOT =
  process.env.AUTOSTORE_BROWSER_DATA_DIR ??
  join(homedir(), ".autostore-browser-mcp", "profiles");

const HEADLESS = process.env.AUTOSTORE_BROWSER_HEADLESS === "true";

interface ProfileState {
  context: BrowserContext;
  tabs: Map<string, Page>;
  nextTabId: number;
}

const profiles = new Map<string, ProfileState>();

export async function getContext(profile: string): Promise<ProfileState> {
  let state = profiles.get(profile);
  if (state && !state.context.pages()) state = undefined;
  if (state) return state;

  const profileDir = join(DATA_ROOT, profile);
  mkdirSync(profileDir, { recursive: true });

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: HEADLESS,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  state = { context, tabs: new Map(), nextTabId: 1 };
  profiles.set(profile, state);

  // Adopt any pages the persistent context opened on startup.
  for (const page of context.pages()) registerPage(state, page);

  context.on("page", (page) => registerPage(state!, page));
  context.on("close", () => profiles.delete(profile));

  return state;
}

function registerPage(state: ProfileState, page: Page): string {
  // Dedup: if already registered, reuse id.
  for (const [id, p] of state.tabs) if (p === page) return id;
  const id = `tab_${state.nextTabId++}`;
  state.tabs.set(id, page);
  page.on("close", () => state.tabs.delete(id));
  return id;
}

export async function openTab(profile: string, url?: string): Promise<{ tabId: string; title: string }> {
  const state = await getContext(profile);
  const page = await state.context.newPage();
  const id = registerPage(state, page);
  if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  return { tabId: id, title: await page.title() };
}

export async function getPage(profile: string, tabId?: string): Promise<Page> {
  const state = await getContext(profile);
  if (tabId) {
    const page = state.tabs.get(tabId);
    if (!page) throw new Error(`No such tab: ${tabId}`);
    return page;
  }
  // Default: most recently opened non-closed tab.
  const all = [...state.tabs.values()];
  const live = all.filter((p) => !p.isClosed());
  if (!live.length) {
    const page = await state.context.newPage();
    registerPage(state, page);
    return page;
  }
  return live[live.length - 1];
}

export async function listTabs(profile: string): Promise<Array<{ tabId: string; url: string; title: string }>> {
  const state = await getContext(profile);
  const out: Array<{ tabId: string; url: string; title: string }> = [];
  for (const [tabId, page] of state.tabs) {
    if (page.isClosed()) continue;
    out.push({ tabId, url: page.url(), title: await page.title().catch(() => "") });
  }
  return out;
}

export async function closeTab(profile: string, tabId: string): Promise<void> {
  const state = await getContext(profile);
  const page = state.tabs.get(tabId);
  if (!page) throw new Error(`No such tab: ${tabId}`);
  await page.close();
}

export async function closeProfile(profile: string): Promise<void> {
  const state = profiles.get(profile);
  if (!state) return;
  await state.context.close();
  profiles.delete(profile);
}

export async function shutdownAll(): Promise<void> {
  await Promise.allSettled([...profiles.values()].map((s) => s.context.close()));
  profiles.clear();
}
