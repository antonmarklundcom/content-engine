/**
 * The one screenshot pass (PLAN.md §4.13).
 *
 * A scaffold in this phase: O4 has no UI to show, so the page list below is the
 * single route that renders without a session. S5 — the phase that builds the
 * one design system — fills it in with the pages it wants a reviewer to look
 * at, and changes nothing else here.
 *
 * Runs against an already-started server (`next start`), writes PNGs to the
 * git-ignored docs/screenshots/, and CI uploads that directory as an artifact.
 * Never committed: a screenshot in the repo is stale the day after it lands.
 *
 *   BASE_URL=http://127.0.0.1:3000 node tests/screenshots.mjs
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT_DIR = "docs/screenshots";

/** Two widths: the phone the inbox is designed for (§1.6), and a desktop. */
const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

/** S5 extends this. Keep it to ≤ 5 pages — the polish cap is one pass, not a suite. */
const PAGES = [{ name: "youtube-login", path: "/youtube/login" }];

async function main() {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  // CI downloads the browser build that matches its Playwright version. On a
  // machine that already has one — a dev box, a sandbox with a preinstalled
  // Chromium — point this at it rather than downloading a second copy.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    for (const viewport of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      for (const target of PAGES) {
        const url = new URL(target.path, BASE_URL).toString();
        const response = await page.goto(url, { waitUntil: "networkidle" });
        // A 500 that still paints something would otherwise be uploaded as if
        // it were the page, and reviewed as if it were fine.
        if (!response || response.status() >= 400) {
          throw new Error(`${url} returned ${response ? response.status() : "no response"}`);
        }
        const file = path.join(OUT_DIR, `${target.name}-${viewport.name}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`wrote ${file}`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }
}

await main();
