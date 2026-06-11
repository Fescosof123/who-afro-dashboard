// Builds data/emdat-cache.json from the newest EM-DAT public export in data/.
//
// EM-DAT has no public API: the xlsx must be downloaded manually from
// https://public.emdat.be (login required; filters: Natural, Africa, 2000+).
// Drop the downloaded public_emdat_*.xlsx into dashboard-app/data/ and run:
//   node scripts/build-emdat-cache.js
// The server reads only the JSON cache produced here, never the xlsx.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DATA_DIR = path.join(__dirname, "..", "data");
const OUTPUT_FILE = path.join(DATA_DIR, "emdat-cache.json");

function newestEmdatExport() {
  const candidates = fs.readdirSync(DATA_DIR)
    .filter((f) => /^public_emdat_.*\.xlsx$/i.test(f))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(DATA_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return candidates.length ? candidates[0].name : null;
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function eventLabel(row) {
  const name = String(row["Event Name"] || "").trim();
  const type = String(row["Disaster Type"] || "Unknown").trim();
  return name ? `${type}: ${name}` : type;
}

const sourceFile = newestEmdatExport();
if (!sourceFile) {
  console.error("No public_emdat_*.xlsx file found in data/. Download one from https://public.emdat.be first.");
  process.exit(1);
}

const wb = XLSX.readFile(path.join(DATA_DIR, sourceFile));
const rows = XLSX.utils.sheet_to_json(wb.Sheets["EM-DAT Data"], { defval: null });
if (!rows.length) {
  console.error(`No rows found in sheet "EM-DAT Data" of ${sourceFile}.`);
  process.exit(1);
}

const events = rows.map((row) => ({
  disno: row["DisNo."],
  type: String(row["Disaster Type"] || "Unknown").trim(),
  subtype: String(row["Disaster Subtype"] || "").trim() || null,
  label: eventLabel(row),
  iso3: String(row["ISO"] || "").trim(),
  country: String(row["Country"] || "").trim(),
  subregion: String(row["Subregion"] || "").trim() || null,
  start_year: toNumber(row["Start Year"]),
  start_month: toNumber(row["Start Month"]),
  deaths: toNumber(row["Total Deaths"]),
  affected: toNumber(row["Total Affected"]),
  damage_adj_usd000: toNumber(row["Total Damage, Adjusted ('000 US$)"])
})).filter((e) => e.iso3 && e.start_year);

const years = events.map((e) => e.start_year);
const yearMin = Math.min(...years);
const yearMax = Math.max(...years);

const yearlyMap = {};
const typeMap = {};
const countryMap = {};
events.forEach((e) => {
  const y = yearlyMap[e.start_year] || (yearlyMap[e.start_year] = { year: e.start_year, events: 0, deaths: 0, affected: 0, by_type: {} });
  y.events += 1;
  y.deaths += e.deaths || 0;
  y.affected += e.affected || 0;
  y.by_type[e.type] = (y.by_type[e.type] || 0) + 1;

  const t = typeMap[e.type] || (typeMap[e.type] = { type: e.type, events: 0, deaths: 0, affected: 0 });
  t.events += 1;
  t.deaths += e.deaths || 0;
  t.affected += e.affected || 0;

  const c = countryMap[e.iso3] || (countryMap[e.iso3] = {
    iso3: e.iso3, country: e.country, events: 0, deaths: 0, affected: 0, by_type: {}, last_event_year: null
  });
  c.events += 1;
  c.deaths += e.deaths || 0;
  c.affected += e.affected || 0;
  c.by_type[e.type] = (c.by_type[e.type] || 0) + 1;
  c.last_event_year = Math.max(c.last_event_year || 0, e.start_year);
});

const slimEvent = (e) => ({
  disno: e.disno,
  label: e.label,
  type: e.type,
  subtype: e.subtype,
  country: e.country,
  iso3: e.iso3,
  year: e.start_year,
  deaths: e.deaths,
  affected: e.affected,
  damage_adj_usd000: e.damage_adj_usd000
});

const cache = {
  generated_at: new Date().toISOString(),
  source: "EM-DAT, CRED / UCLouvain, Brussels, Belgium (public.emdat.be)",
  source_file: sourceFile,
  scope: "Natural disasters, Africa",
  year_min: yearMin,
  year_max: yearMax,
  record_count: events.length,
  yearly: Object.values(yearlyMap).sort((a, b) => a.year - b.year),
  by_type: Object.values(typeMap).sort((a, b) => b.events - a.events),
  countries: Object.values(countryMap)
    .map((c) => ({
      ...c,
      top_type: Object.entries(c.by_type).sort((a, b) => b[1] - a[1])[0]?.[0] || null
    }))
    .sort((a, b) => b.affected - a.affected),
  top_events_by_affected: [...events]
    .filter((e) => e.affected != null)
    .sort((a, b) => b.affected - a.affected)
    .slice(0, 15)
    .map(slimEvent),
  top_events_by_deaths: [...events]
    .filter((e) => e.deaths != null)
    .sort((a, b) => b.deaths - a.deaths)
    .slice(0, 15)
    .map(slimEvent),
  recent_events: [...events]
    .sort((a, b) => (b.start_year - a.start_year) || ((b.start_month || 0) - (a.start_month || 0)))
    .slice(0, 25)
    .map(slimEvent)
};

fs.writeFileSync(OUTPUT_FILE, JSON.stringify(cache, null, 2), "utf8");
console.log(`EM-DAT cache written: ${OUTPUT_FILE}`);
console.log(`Source: ${sourceFile}`);
console.log(`Events: ${cache.record_count} (${yearMin}-${yearMax}), countries: ${cache.countries.length}, types: ${cache.by_type.length}`);
