/**
 * refresh-rss-cache.js
 *
 * Fetches every RSS feed that Render's hosted IPs cannot reach (blocked by
 * the upstream CDN) and writes the results to the server's cache files.
 *
 * Run from GitHub Actions on a schedule so Render always has a fresh seed
 * snapshot, regardless of whether its own outbound IP is blocked.
 *
 * Usage:  node scripts/refresh-rss-cache.js
 * Exit 0  — at least one cache file was updated (git commit will have changes)
 * Exit 1  — nothing changed or all fetches failed
 */

"use strict";

const Parser  = require("rss-parser");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");

const parser = new Parser({
  headers: {
    "User-Agent": "WHO-AFRO-Dashboard/1.0 (+cache-refresh-bot)",
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
  }
});

// Wrap parser.parseURL with a hard timeout so a slow feed never blocks CI.
function parseWithTimeout(url, ms = 20000) {
  return Promise.race([
    parser.parseURL(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms)
    )
  ]);
}

// ── feeds to refresh ────────────────────────────────────────────────────────

const RSS_FEEDS = [
  {
    label: "ReliefWeb RSS",
    url:   "https://reliefweb.int/updates/rss.xml",
    file:  path.join(DATA_DIR, "reliefweb-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  },
  {
    label: "WHO DON RSS",
    url:   "https://www.who.int/rss-feeds/news.xml",
    file:  path.join(DATA_DIR, "who-don-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  },
  {
    label: "OCHA RSS",
    url:   "https://www.unocha.org/rss.xml",
    file:  path.join(DATA_DIR, "ocha-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  },
  {
    label: "UNHCR RSS",
    url:   "https://www.unhcr.org/rss.xml",
    file:  path.join(DATA_DIR, "unhcr-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  },
  {
    label: "GDACS RSS",
    url:   "https://www.gdacs.org/xml/rss.xml",
    file:  path.join(DATA_DIR, "gdacs-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  },
  {
    label: "IDMC RSS",
    url:   "https://www.internal-displacement.org/rss.xml",
    file:  path.join(DATA_DIR, "idmc-rss-cache.json"),
    format: (items) => ({ saved_at: new Date().toISOString(), items })
  }
];

// ── main ────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  let updatedCount = 0;

  for (const feed of RSS_FEEDS) {
    try {
      process.stdout.write(`Fetching ${feed.label} … `);
      const result = await parseWithTimeout(feed.url);
      const items  = result.items || [];

      if (items.length === 0) {
        console.log("0 items — skipped");
        continue;
      }

      const snapshot = feed.format(items);
      fs.writeFileSync(feed.file, JSON.stringify(snapshot, null, 2), "utf8");
      console.log(`✓  ${items.length} items → ${path.basename(feed.file)}`);
      updatedCount++;
    } catch (err) {
      console.log(`✗  ${err.message}`);
    }
  }

  console.log(`\nDone. ${updatedCount}/${RSS_FEEDS.length} cache files updated.`);
  process.exit(updatedCount > 0 ? 0 : 1);
}

main();
