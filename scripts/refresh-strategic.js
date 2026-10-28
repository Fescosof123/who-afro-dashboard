/**
 * refresh-strategic.js
 *
 * Run by the GitHub refresh job. Refreshes the strategic data cache (OCHA HDX HAPI,
 * OCHA FTS, OCHA Response Monitoring, WHO SSA) when it is older than
 * STRATEGIC_REFRESH_HOURS, then records this month's KPI snapshot in
 * data/strategic-history.json so the dashboard can show change since last month.
 *
 * Usage: node scripts/refresh-strategic.js
 */

"use strict";

process.env.STRATEGIC_HISTORY_URL = process.env.STRATEGIC_HISTORY_URL || "off";

const strategic = require("../lib/strategic");
const { loadFcvCountryProfileData } = require("../server");

async function main() {
  const age = strategic.hoursSinceAttempt(strategic.readCache());
  if (age >= strategic.REFRESH_HOURS || process.argv.includes("--force")) {
    await strategic.refreshStrategicCache();
  } else {
    console.log(`[strategic] last refresh attempt ${age.toFixed(1)} h ago; refresh not needed`);
  }
  const history = strategic.recordSnapshot(loadFcvCountryProfileData(), new Date(), { target: "repo" });
  console.log(`[strategic] snapshots held: ${history.snapshots.map((s) => s.month).join(", ")}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(`[strategic] ${err.message}`);
  process.exit(1);
});
