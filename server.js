const express = require("express");
const cors = require("cors");
const axios = require("axios");
const Parser = require("rss-parser");
const XLSX = require("xlsx");
const cheerio = require("cheerio");
const path = require("path");
const fs = require("fs");

const app = express();
const parser = new Parser({
  headers: {
    "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8"
  }
});
const PORT = process.env.PORT || 3000;
let previousSourceSummarySnapshot = null;
let conflictDisplacementSourceHistorySnapshot = [];
let acapsPaginationCapReachedStreak = 0;
const DASHBOARD_CACHE_TTL_SECONDS = parsePositiveIntEnv(process.env.DASHBOARD_CACHE_TTL_SECONDS, 300);
const dashboardResponseCache = {
  strict: null,
  lenient: null
};

const DATA_DIR = path.join(__dirname, "data");
const VALIDATION_LOG_DIR = path.join(DATA_DIR, "validation-logs");
const COUNTRY_FEED_CACHE_FILE = path.join(DATA_DIR, "country-feed-cache.json");
const COUNTRY_FEED_REFRESH_MINUTES = parsePositiveIntEnv(process.env.COUNTRY_FEED_REFRESH_MINUTES, 60);
const COUNTRY_FEED_MAX_STALE_MINUTES = parsePositiveIntEnv(process.env.COUNTRY_FEED_MAX_STALE_MINUTES, 180);
const COUNTRY_FEED_PULL_MODE = parseChoiceEnv(process.env.COUNTRY_FEED_PULL_MODE, ["off", "auto"], "auto");
const COUNTRY_FEED_CSV_URL = String(process.env.COUNTRY_FEED_CSV_URL || "").trim();
const COUNTRY_FEED_LOCAL_FILE = String(process.env.COUNTRY_FEED_LOCAL_FILE || path.join(__dirname, "FCV-Services-Deliveries-Database.csv")).trim();
const COUNTRY_FEED_INGEST_TOKEN = String(process.env.COUNTRY_FEED_INGEST_TOKEN || "").trim();
let countryFeedSnapshot = null;

const FCV_COUNTRY_PROFILE_LOCAL_FILE = String(
  process.env.FCV_COUNTRY_PROFILE_LOCAL_FILE || path.join(__dirname, "FCV-Country-Profile-Data.xlsx")
).trim();
let fcvCountryProfileSnapshot = null;

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = String(line || "").trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      return;
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) {
      process.env[key] = value;
    }
  });
}

loadLocalEnvFile();
countryFeedSnapshot = loadCountryFeedSnapshotFromDisk();
fcvCountryProfileSnapshot = loadFcvCountryProfileData();

function loadFcvCountryProfileData() {
  if (!FCV_COUNTRY_PROFILE_LOCAL_FILE || !fs.existsSync(FCV_COUNTRY_PROFILE_LOCAL_FILE)) {
    return null;
  }
  try {
    const buffer = fs.readFileSync(FCV_COUNTRY_PROFILE_LOCAL_FILE);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) {
      return null;
    }
    const headers = rows[0].map((h) => String(h || "").trim());
    const colIndex = (name) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    const idxCountry      = colIndex("Countries");
    const idxPlanType     = colIndex("Plan type");
    const idxFcv          = colIndex("FCV (Y/N)");
    const idxHcc          = colIndex("HCC (Y/N)");
    const idxPin          = colIndex("People in need");
    const idxPtargeted    = colIndex("People targeted");
    const idxPprioritized = colIndex("People prioritized");
    const idxPreached     = colIndex("People reached (HRP)");
    const idxHealthPin    = colIndex("People in need for health");
    const idxHealthPtarg  = colIndex("People targeted for health");
    const idxHealthPreached = colIndex("People reached for health");
    const idxRefugees     = colIndex("Refugees + Asylum seekers");
    const idxIdps         = colIndex("IDPs");
    const idxReqs         = colIndex("Requirements");
    const idxFunding      = colIndex("Funding");
    const idxPctFunded    = colIndex("% Funded");

    function evalCellValue(raw) {
      if (raw == null) return null;
      if (typeof raw === "number") return raw;
      const s = String(raw).trim();
      if (s.startsWith("=")) {
        const nums = s.slice(1).split("+").map((n) => Number(n.trim())).filter((n) => Number.isFinite(n));
        if (!nums.length) return null;
        return nums.reduce((a, b) => a + b, 0);
      }
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }

    const dataRows = rows.slice(1)
      .filter((row) => row && String(row[idxCountry] || "").trim())
      .map((row) => ({
        country:             String(row[idxCountry] || "").trim(),
        plan_type:           String(row[idxPlanType] || "").trim() || null,
        fcv:                 String(row[idxFcv] || "").trim().toUpperCase() === "Y",
        hcc:                 String(row[idxHcc] || "").trim().toUpperCase() === "Y",
        people_in_need:      evalCellValue(row[idxPin]),
        people_targeted:     evalCellValue(row[idxPtargeted]),
        people_prioritized:  evalCellValue(row[idxPprioritized]),
        people_reached_hrp:  evalCellValue(row[idxPreached]),
        health_people_in_need: evalCellValue(row[idxHealthPin]),
        health_people_targeted: evalCellValue(row[idxHealthPtarg]),
        health_people_reached: evalCellValue(row[idxHealthPreached]),
        refugees_asylum_seekers: evalCellValue(row[idxRefugees]),
        idps:                evalCellValue(row[idxIdps]),
        requirements_usd:    evalCellValue(row[idxReqs]),
        funding_usd:         evalCellValue(row[idxFunding]),
        pct_funded:          evalCellValue(row[idxPctFunded])
      }));

    return {
      loaded_at: new Date().toISOString(),
      row_count: dataRows.length,
      rows: dataRows
    };
  } catch (err) {
    console.error("[FCV Country Profile] Failed to load:", err.message);
    return { loaded_at: new Date().toISOString(), row_count: 0, rows: [], error: err.message };
  }
}

function parsePositiveIntEnv(raw, fallbackValue) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(1, Math.floor(parsed));
}

function parseNonNegativeIntEnv(raw, fallbackValue) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }
  return Math.max(0, Math.floor(parsed));
}

function parseChoiceEnv(raw, allowedValues, fallbackValue) {
  const normalized = String(raw || "").trim().toLowerCase();
  return allowedValues.includes(normalized) ? normalized : fallbackValue;
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// AFRO-focused Africa scope.
// Groups are ordered for presentation as: FCV Prioritized, FCV Accelerated,
// AFRO, then Other Africa.
const FCV_COUNTRIES = [
  // --- FCV Prioritized ---
  { iso3: "BFA", name: "Burkina Faso", aliases: ["Burkina Faso", "Burkina"], fcv_track: "FCV Prioritized" },
  { iso3: "CAF", name: "Central African Republic", aliases: ["Central African Republic", "Central African Rep", "Central African"], fcv_track: "FCV Prioritized" },
  { iso3: "TCD", name: "Chad", aliases: ["Chad", "Republic of Chad", "Chadian"], fcv_track: "FCV Prioritized" },
  {
    iso3: "COD",
    name: "Democratic Republic of the Congo",
    aliases: ["Democratic Republic of the Congo", "Democratic Republic of Congo", "DR Congo", "DRC", "Congo DR", "Congo-Kinshasa"],
    fcv_track: "FCV Prioritized"
  },
  { iso3: "ETH", name: "Ethiopia", aliases: ["Ethiopia", "Ethiopian"], fcv_track: "FCV Prioritized" },
  { iso3: "MLI", name: "Mali", aliases: ["Mali", "Malian"], fcv_track: "FCV Prioritized" },
  { iso3: "MOZ", name: "Mozambique", aliases: ["Mozambique", "Mozambican"], fcv_track: "FCV Prioritized" },
  { iso3: "NER", name: "Niger", aliases: ["Niger", "Republic of Niger", "Nigerien"], fcv_track: "FCV Prioritized" },
  { iso3: "SSD", name: "South Sudan", aliases: ["South Sudan", "Republic of South Sudan", "South Sudanese"], fcv_track: "FCV Prioritized" },
  // --- FCV Accelerated ---
  { iso3: "CMR", name: "Cameroon", aliases: ["Cameroon", "Republic of Cameroon", "Cameroonian"], fcv_track: "FCV Accelerated" },
  { iso3: "ERI", name: "Eritrea", aliases: ["Eritrea", "Eritrean"], fcv_track: "FCV Accelerated" },
  { iso3: "NGA", name: "Nigeria", aliases: ["Nigeria", "Federal Republic of Nigeria", "Nigerian"], fcv_track: "FCV Accelerated" },
  { iso3: "ZWE", name: "Zimbabwe", aliases: ["Zimbabwe", "Zimbabwean"], fcv_track: "FCV Accelerated" },
  // --- WHO AFRO ---
  { iso3: "AGO", name: "Angola", aliases: ["Angola", "Angolan"], fcv_track: "AFRO" },
  { iso3: "BEN", name: "Benin", aliases: ["Benin", "Beninese"], fcv_track: "AFRO" },
  { iso3: "BWA", name: "Botswana", aliases: ["Botswana", "Botswanan"], fcv_track: "AFRO" },
  { iso3: "BDI", name: "Burundi", aliases: ["Burundi", "Burundian"], fcv_track: "AFRO" },
  { iso3: "CPV", name: "Cabo Verde", aliases: ["Cabo Verde", "Cape Verde", "Cape Verdean"], fcv_track: "AFRO" },
  { iso3: "COM", name: "Comoros", aliases: ["Comoros", "Comoro Islands", "Comorian"], fcv_track: "AFRO" },
  { iso3: "COG", name: "Republic of the Congo", aliases: ["Republic of the Congo", "Congo-Brazzaville", "Congo Republic", "Republic of Congo"], fcv_track: "AFRO" },
  { iso3: "CIV", name: "Côte d'Ivoire", aliases: ["Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast", "Ivorian"], fcv_track: "AFRO" },
  { iso3: "GNQ", name: "Equatorial Guinea", aliases: ["Equatorial Guinea", "Equatoguinean"], fcv_track: "AFRO" },
  { iso3: "SWZ", name: "Eswatini", aliases: ["Eswatini", "Swaziland", "Swazi"], fcv_track: "AFRO" },
  { iso3: "GAB", name: "Gabon", aliases: ["Gabon", "Gabonese"], fcv_track: "AFRO" },
  { iso3: "GMB", name: "Gambia", aliases: ["Gambia", "The Gambia", "Gambian"], fcv_track: "AFRO" },
  { iso3: "GHA", name: "Ghana", aliases: ["Ghana", "Ghanaian"], fcv_track: "AFRO" },
  { iso3: "GIN", name: "Guinea", aliases: ["Guinea", "Republic of Guinea", "Guinean"], fcv_track: "AFRO" },
  { iso3: "GNB", name: "Guinea-Bissau", aliases: ["Guinea-Bissau", "Guinea Bissau", "Bissau-Guinean"], fcv_track: "AFRO" },
  { iso3: "KEN", name: "Kenya", aliases: ["Kenya", "Kenyan"], fcv_track: "AFRO" },
  { iso3: "LSO", name: "Lesotho", aliases: ["Lesotho", "Basotho"], fcv_track: "AFRO" },
  { iso3: "LBR", name: "Liberia", aliases: ["Liberia", "Liberian"], fcv_track: "AFRO" },
  { iso3: "MDG", name: "Madagascar", aliases: ["Madagascar", "Malagasy", "Madagascan"], fcv_track: "AFRO" },
  { iso3: "MWI", name: "Malawi", aliases: ["Malawi", "Malawian"], fcv_track: "AFRO" },
  { iso3: "MRT", name: "Mauritania", aliases: ["Mauritania", "Mauritanian"], fcv_track: "AFRO" },
  { iso3: "MUS", name: "Mauritius", aliases: ["Mauritius", "Mauritian"], fcv_track: "AFRO" },
  { iso3: "NAM", name: "Namibia", aliases: ["Namibia", "Namibian"], fcv_track: "AFRO" },
  { iso3: "RWA", name: "Rwanda", aliases: ["Rwanda", "Rwandan"], fcv_track: "AFRO" },
  { iso3: "STP", name: "São Tomé and Príncipe", aliases: ["São Tomé and Príncipe", "Sao Tome and Principe", "Sao Tome"], fcv_track: "AFRO" },
  { iso3: "SEN", name: "Senegal", aliases: ["Senegal", "Senegalese"], fcv_track: "AFRO" },
  { iso3: "SYC", name: "Seychelles", aliases: ["Seychelles", "Seychellois"], fcv_track: "AFRO" },
  { iso3: "SLE", name: "Sierra Leone", aliases: ["Sierra Leone", "Sierra Leonean"], fcv_track: "AFRO" },
  { iso3: "SOM", name: "Somalia", aliases: ["Somalia", "Somali", "Somalian"], fcv_track: "Other Africa" },
  { iso3: "ZAF", name: "South Africa", aliases: ["South Africa", "South African"], fcv_track: "AFRO" },
  { iso3: "TZA", name: "Tanzania", aliases: ["Tanzania", "United Republic of Tanzania", "Tanzanian"], fcv_track: "AFRO" },
  { iso3: "TGO", name: "Togo", aliases: ["Togo", "Togolese"], fcv_track: "AFRO" },
  { iso3: "UGA", name: "Uganda", aliases: ["Uganda", "Ugandan"], fcv_track: "AFRO" },
  { iso3: "ZMB", name: "Zambia", aliases: ["Zambia", "Zambian"], fcv_track: "AFRO" },
  // --- Other Africa (non-AFRO) ---
  { iso3: "SDN", name: "Sudan", aliases: ["Sudan", "Sudanese", "Republic of Sudan"], fcv_track: "Other Africa" }
];

function isApprovedVisibleEventSource(source) {
  const normalized = String(source || "").trim();
  if (!normalized) {
    return false;
  }
  return /^(GDACS|ReliefWeb(?: RSS| API| disease fallback)?|WHO DON(?: RSS)?|OCHA RSS|IDMC RSS|UNHCR(?: RSS| via ReliefWeb| Population Data)?|IOM DTM(?: RSS| Event Tracking| Report)?)$/i.test(normalized);
}

function filterApprovedVisibleEventItems(items = []) {
  return items.filter((item) => isApprovedVisibleEventSource(item?.source || ""));
}

const ACLED_LOGIN_URL = "https://acleddata.com/user/login";
const ACLED_CONFLICT_INDEX_PAGE = "https://acleddata.com/series/acled-conflict-index";
const ACLED_CONFLICT_INDEX_CSV_URL = "https://apps.acleddata.com/conflictindex2025/newindextable2025.csv";
const ACLED_CONFLICT_INDEX_CSV_URLS = String(process.env.ACLED_CONFLICT_INDEX_CSV_URLS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const RELIEFWEB_UNHCR_ORG_URL = "https://reliefweb.int/organization/unhcr";
const RELIEFWEB_UPDATES_RSS_URL = "https://reliefweb.int/updates/rss.xml";
const RELIEFWEB_REPORTS_API_URL = "https://api.reliefweb.int/v2/reports";
const RELIEFWEB_APPNAME = String(process.env.RELIEFWEB_APPNAME || "").trim();
const CEMS_FLOOD_DATA_ACCESS_URL = "https://confluence.ecmwf.int/display/CEMS/Data+Access";
const CEMS_FLOOD_PRODUCTS_URL = "https://global-flood.emergency.copernicus.eu/technical-information/products/";
const GFM_WIKI_URL = "https://extwiki.eodc.eu/en/GFM";
const GFM_PORTAL_URL = "https://portal.gfm.eodc.eu/";
const FILTER_INTEGRITY_WARN_THRESHOLD = parseNonNegativeIntEnv(process.env.FILTER_INTEGRITY_WARN_THRESHOLD, 5);
const FILTER_INTEGRITY_BAD_THRESHOLD = Math.max(
  FILTER_INTEGRITY_WARN_THRESHOLD,
  parseNonNegativeIntEnv(process.env.FILTER_INTEGRITY_BAD_THRESHOLD, 20)
);
const WHO_DON_RSS_URL = "https://www.who.int/rss-feeds/news.xml";
const WHO_DON_PAGE_URL = "https://www.who.int/emergencies/disease-outbreak-news";
const UNHCR_RSS_URL = "https://www.unhcr.org/rss.xml";
const IOM_DTM_REPORTS_URL = "https://dtm.iom.int/reports";
const ACAPS_HOME_URL = "https://www.acaps.org/en";
const ACAPS_ARCHIVES_URL = "https://www.acaps.org/en/countries/archives";
const FLOOD_KEYWORD_REGEX = /\bflood\b|flooding|flash\s+flood|river\s+flood|inundation|overflow|heavy\s+rain/i;
const AFRO_CONTEXT_REGEX = /africa|mozambique|kenya|malawi|zambia|zimbabwe|tanzania|somalia|ethiopia|uganda|madagascar|rwanda|burundi|south\s+sudan|democratic\s+republic\s+of\s+the\s+congo|\bdrc\b|congo|cameroon|chad|niger|nigeria|ghana|mali|burkina|senegal|sudan|angola|namibia|botswana|south\s+africa|eritrea|djibouti|central\s+african|caf|togo|benin|guinea|sierra\s+leone|liberia|lesotho|eswatini|comoros|mauritius|seychelles/i;
const EVENT_SIGNAL_LOOKBACK_DAYS = parsePositiveIntEnv(process.env.EVENT_SIGNAL_LOOKBACK_DAYS, 180);
const CYCLONE_ACTIVE_WINDOW_DAYS = parsePositiveIntEnv(process.env.CYCLONE_ACTIVE_WINDOW_DAYS, 21);
const CYCLONE_GEO_LABELS = [
  "Angola", "Botswana", "Burundi", "Cameroon", "Central African Republic", "Chad", "Comoros", "Democratic Republic of the Congo",
  "Djibouti", "Eritrea", "Eswatini", "Ethiopia", "Kenya", "Lesotho", "Madagascar", "Malawi", "Mauritius", "Mayotte",
  "Mozambique", "Namibia", "Nigeria", "Papua New Guinea", "Republic of the Congo", "Reunion", "Rwanda", "Seychelles",
  "Somalia", "South Africa", "South Sudan", "Sudan", "Tanzania", "Uganda", "Zambia", "Zimbabwe", "Australia", "Off-shore",
  "Southwest Indian Ocean", "SWIO", "Indian Ocean"
];
const ACAPS_CRAWL_MODE = parseChoiceEnv(process.env.ACAPS_CRAWL_MODE, ["fast", "deep"], "deep");
const ACAPS_MAX_ARCHIVE_PAGES_FAST = parsePositiveIntEnv(process.env.ACAPS_MAX_ARCHIVE_PAGES_FAST, 6);
const ACAPS_MAX_ARCHIVE_PAGES_DEEP = parsePositiveIntEnv(process.env.ACAPS_MAX_ARCHIVE_PAGES_DEEP, 10);
const ACAPS_CACHE_FILE = path.join(DATA_DIR, "acaps-cache.json");
const ACAPS_CACHE_TTL_MINUTES = parsePositiveIntEnv(process.env.ACAPS_CACHE_TTL_MINUTES, 30);
const WHO_DON_MODE = parseChoiceEnv(process.env.WHO_DON_MODE, ["auto", "off"], "auto");
const UNHCR_FETCH_MODE = parseChoiceEnv(process.env.UNHCR_FETCH_MODE, ["auto", "reliefweb-first", "unhcr-first"], "reliefweb-first");
const UNHCR_POPULATION_API_URL = "https://api.unhcr.org/population/v1/population/";
const ACLED_EMAIL = process.env.ACLED_EMAIL || "";
const ACLED_PASSWORD = process.env.ACLED_PASSWORD || "";
const ACLED_AUTH_MODE = parseChoiceEnv(process.env.ACLED_AUTH_MODE, ["off", "on-demand", "always"], "on-demand");
const ACLED_CACHE_FILE = path.join(DATA_DIR, "acled-conflict-index-cache.csv");

// DTM Population Displacement data — HDX open CSV (no auth required, updates weekly).
const DTM_HDX_CSV_URL = "https://data.humdata.org/dataset/32d0365c-d513-4721-8d66-1b19b12c4b08/resource/80911e9b-7527-469a-a545-4074860e1288/download/global-iom-dtm-from-api-admin-0-to-2.csv";
const DTM_CACHE_FILE = path.join(DATA_DIR, "dtm-displacement-cache.json");
const DTM_CACHE_TTL_HOURS = parsePositiveIntEnv(process.env.DTM_CACHE_TTL_HOURS, 24);
let dtmDisplacementSnapshot = null;
let dtmFetchInFlight = null;

// ReliefWeb RSS cache — keeps the last successful batch so Render always has seed data.
const RELIEFWEB_RSS_CACHE_FILE = path.join(DATA_DIR, "reliefweb-rss-cache.json");
const RELIEFWEB_RSS_CACHE_TTL_HOURS = 6;
let reliefwebRssSnapshot = null;

// FEWS Data Warehouse IPC API — publicly accessible, no authentication required.
const FEWS_DW_IPC_URL = "https://fdw.fews.net/api/ipcphase/";
const FEWS_IPC_CACHE_FILE = path.join(DATA_DIR, "fews-ipc-cache.json");
const FEWS_IPC_CACHE_TTL_MINUTES = parsePositiveIntEnv(process.env.FEWS_IPC_CACHE_TTL_MINUTES, 360);
const FEWS_IPC_REQUEST_TIMEOUT_MS = parsePositiveIntEnv(process.env.FEWS_IPC_REQUEST_TIMEOUT_MS, 9000);
// ISO-2 codes used by the FEWS Data Warehouse; only countries with active FEWS coverage listed.
const FEWS_COVERAGE_ISO2 = {
  BFA: "BF", TCD: "TD", MLI: "ML", NER: "NE",
  ETH: "ET", SSD: "SS", CMR: "CM", NGA: "NG", ZWE: "ZW"
};
let fewsIpcCacheSnapshot = null;
let acapsCacheSnapshot = null;

function currentAcapsMaxPages() {
  return ACAPS_CRAWL_MODE === "fast" ? ACAPS_MAX_ARCHIVE_PAGES_FAST : ACAPS_MAX_ARCHIVE_PAGES_DEEP;
}

const INDICATORS = [
  { code: "SH.STA.WAST.ZS", key: "wasting_u5_pct", label: "Child Wasting (%)" },
  { code: "SH.STA.STNT.ZS", key: "stunting_u5_pct", label: "Child Stunting (%)" },
  { code: "SH.ANM.PREG.ZS", key: "pregnant_anemia_pct", label: "Pregnant Women Anemia (%)" }
];

const MAX_NUTRITION_DATA_AGE_YEARS = 3;

// Pilot fallback connector for newer acute malnutrition country products on HDX.
// Values are used as a transparent proxy for wasting burden when World Bank latest
// values are stale or absent under the selected freshness mode.
const HDX_ACUTE_MALNUTRITION_URLS = {
  NGA: "https://data.humdata.org/dataset/3797b5fd-9ff3-4971-8e14-81817a335789/resource/bc0c07a5-f18a-420e-ae02-003cfb09ba72/download/nigerian-acute-malnutrition-2026-april-may-september.xlsx",
  TCD: "https://data.humdata.org/dataset/3abcd97a-59ac-4f14-b0ba-e62747bb2e21/resource/e519ec9c-7b1f-4cd0-bcd9-7c1a2941c2f3/download/ipc_tchad_malnutrition_2026.xlsx",
  SSD: "https://data.humdata.org/dataset/e8cf0720-45d4-4f7a-b1a4-b2b602c8f655/resource/de9d61c9-d0f4-4963-a019-c3f0a39fe8f0/download/acute-malnutrition.xlsx",
  COD: "https://data.humdata.org/dataset/163d1b22-52d4-4f26-80bf-d5da720dda8f/resource/869a29e1-a2b4-41fa-9838-49f10f882d87/download/rdc-ipc-amn-juillet2025-juin2026.xlsx",
  CAF: "https://data.humdata.org/dataset/8a686db7-2606-40cc-bdf5-29fc8235f2d4/resource/40da537f-d4ba-4eeb-b835-ec7df13ead71/download/ipc_car_amn_mar2025_feb2026.xlsx",
  MLI: "https://data.humdata.org/dataset/05b2b3be-c38d-4520-a0cd-fe8a7b509690/resource/dccacaee-810c-48b1-a2e8-7a252689f658/download/ipc_mali_acute_malnutrition_june2024_may2025.xlsx",
  MOZ: "https://data.humdata.org/dataset/3af7aa97-3195-4fc1-9dd7-afd6ce020aca/resource/8f73aea3-c08a-44dd-9a2f-2bbbf32949f3/download/mozambique-acute-malnutrition.xlsx"
};

function currentYearUtc() {
  return Number(new Date().getUTCFullYear());
}

function isNutritionYearFresh(year) {
  if (!year || Number.isNaN(Number(year))) {
    return false;
  }
  const ageYears = currentYearUtc() - Number(year);
  return ageYears <= MAX_NUTRITION_DATA_AGE_YEARS;
}

function emptyCountryRecord(country) {
  return {
    iso3: country.iso3,
    country: country.name,
    fcv_track: country.fcv_track,
    indicators: {},
    projections: {},
    ipc: null,
    acled_index: null,
    dtm_idp: null,
    hazard_count: 0,
    flood_count: 0,
    cyclone_count: 0,
    drought_signal_count: 0,
    icpac_forecast_count: 0,
    fews_reference_count: 0,
    fews_ipc: null,
    acaps_reference_count: 0,
    disease_outbreak_signal_count: 0,
    conflict_signal_count: 0,
    displacement_signal_count: 0,
    report_count_30d: 0,
    data_quality: "partial",
    risk_score: 0
  };
}

function readFewsIpcCache() {
  try {
    if (!fs.existsSync(FEWS_IPC_CACHE_FILE)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(FEWS_IPC_CACHE_FILE, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.saved_at || !raw.by_iso3) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeFewsIpcCache(snapshot) {
  try {
    fs.mkdirSync(path.dirname(FEWS_IPC_CACHE_FILE), { recursive: true });
    fs.writeFileSync(FEWS_IPC_CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (err) {
    console.warn("FEWS IPC cache write failed", err.message);
  }
}

function isFewsIpcCacheFresh(snapshot) {
  if (!snapshot?.saved_at) {
    return false;
  }
  const savedMs = new Date(snapshot.saved_at).getTime();
  if (!Number.isFinite(savedMs)) {
    return false;
  }
  const ageMinutes = (Date.now() - savedMs) / 60000;
  return ageMinutes <= FEWS_IPC_CACHE_TTL_MINUTES;
}

function applyFewsIpcSnapshot(countryMap, byIso3 = {}) {
  let mapped = 0;
  Object.entries(byIso3).forEach(([iso3, fewsIpc]) => {
    if (!countryMap[iso3] || !fewsIpc) {
      return;
    }
    countryMap[iso3].fews_ipc = fewsIpc;
    mapped += 1;
  });
  return mapped;
}

// Helper: fetch the most recent FEWS IPC phase record for one country + scenario.
// Uses fast ordered queries only; slower deep pagination is avoided for latency.
async function fetchFewsIpcRecord(iso2, scenario) {
  const commonHeaders = { "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)" };
  const orderedAttempts = ["-projection_end", "-reporting_date"];
  for (const ordering of orderedAttempts) {
    try {
      const resp = await axios.get(FEWS_DW_IPC_URL, {
        params: {
          country_code: iso2,
          unit_type: "admin0",
          scenario,
          page_size: 12,
          ordering,
          format: "json"
        },
        timeout: FEWS_IPC_REQUEST_TIMEOUT_MS,
        headers: commonHeaders
      });
      const rows = resp.data.results || [];
      const row = rows.find((r) => {
        const value = Number(r?.value);
        return Number.isFinite(value) && value >= 1 && value <= 5;
      }) || rows[0] || null;
      if (row) {
        return row;
      }
    } catch (err) {
    }
  }
  return null;
}

async function fetchFewsNetIpcData(countryMap) {
  const status = {
    source: "FEWS NET Data Warehouse",
    endpoint: FEWS_DW_IPC_URL,
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    mapped_countries: 0,
    covered_countries: Object.keys(FEWS_COVERAGE_ISO2),
    error: null
  };

  try {
    if (!fewsIpcCacheSnapshot) {
      fewsIpcCacheSnapshot = readFewsIpcCache();
    }
    if (isFewsIpcCacheFresh(fewsIpcCacheSnapshot)) {
      status.overall = "available";
      status.mapped_countries = applyFewsIpcSnapshot(countryMap, fewsIpcCacheSnapshot.by_iso3 || {});
      status.cache_used = true;
      status.cache_saved_at = fewsIpcCacheSnapshot.saved_at;
      return { status };
    }

    const pairs = Object.entries(FEWS_COVERAGE_ISO2);
    const batchSize = 5;
    const results = [];
    // Bounded concurrency reduces FEWS API throttling risk without making refresh too slow.
    for (let i = 0; i < pairs.length; i += batchSize) {
      const batch = pairs.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async ([iso3, iso2]) => {
          const [cs, ml1] = await Promise.allSettled([
            fetchFewsIpcRecord(iso2, "CS"),
            fetchFewsIpcRecord(iso2, "ML1")
          ]);
          return {
            iso3,
            cs: cs.status === "fulfilled" ? cs.value : null,
            ml1: ml1.status === "fulfilled" ? ml1.value : null
          };
        })
      );
      results.push(...batchResults);
    }
    let mapped = 0;
    const byIso3 = {};

    for (const { iso3, cs, ml1 } of results) {
      if (!countryMap[iso3]) {
        continue;
      }
      if (cs || ml1) {
        mapped++;
        const csValue = Number(cs?.value);
        const ml1Value = Number(ml1?.value);
        const csPhase = Number.isFinite(csValue) && csValue >= 1 && csValue <= 5 ? csValue : null;
        const ml1Phase = Number.isFinite(ml1Value) && ml1Value >= 1 && ml1Value <= 5 ? ml1Value : null;
        countryMap[iso3].fews_ipc = {
          cs_phase: csPhase,
          cs_description: csPhase != null ? (cs?.description ?? null) : null,
          cs_projection_end: csPhase != null ? (cs?.projection_end ?? null) : null,
          ml1_phase: ml1Phase,
          ml1_description: ml1Phase != null ? (ml1?.description ?? null) : null,
          ml1_projection_end: ml1Phase != null ? (ml1?.projection_end ?? null) : null,
          reporting_date: cs?.reporting_date ?? ml1?.reporting_date ?? null,
          source_document: cs?.source_document ?? ml1?.source_document ?? null
        };
        byIso3[iso3] = countryMap[iso3].fews_ipc;
      }
    }

    status.mapped_countries = mapped;
    status.overall = mapped > 0 ? "available" : "unavailable";
    status.cache_used = false;
    if (mapped > 0) {
      fewsIpcCacheSnapshot = {
        saved_at: new Date().toISOString(),
        by_iso3: byIso3
      };
      writeFewsIpcCache(fewsIpcCacheSnapshot);
    }
    return { status };
  } catch (err) {
    status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}`;
    return { status };
  }
}

async function fetchFewsNetSignals(countryMap) {
  const status = {
    source: "FEWS NET",
    endpoint: "https://fews.net/data/acute-food-insecurity",
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    country_hits: 0,
    link_count: 0,
    asset_count: 0,
    error: null
  };

  try {
    const response = await axios.get(status.endpoint, {
      timeout: 20000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    const html = String(response.data || "");
    const $ = cheerio.load(html);
    const signals = [];
    const seen = new Set();

    const countryLinkSignals = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (!href || !text) {
        return;
      }
      status.link_count += 1;

      FCV_COUNTRIES.forEach((country) => {
        const countryMentioned = countCountryMentions(`${text} ${href}`, country);
        if (!countryMentioned) {
          return;
        }
        const key = `${country.iso3}|${href}|${text}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        countryLinkSignals.push({
          source: "FEWS NET",
          title: `FEWS reference detected: ${text}`,
          summary: `Country-linked FEWS page reference for ${country.name}; no country classification value extracted.`,
          url: href.startsWith("http") ? href : `https://fews.net${href}`,
          date_label: status.checked_at,
          countries: [country.iso3],
          horizon: "reference",
          risk_level: "info"
        });
      });
    });

    // Capture static downloadable assets embedded in HTML for automated pulls.
    const assetUrls = [...new Set(
      [...html.matchAll(/https?:\/\/[^"'\s)]+/g)]
        .map((m) => m[0])
        .filter((url) => /fews\.net\/sites\/default\/files|fdw\.fews\.net|\.zip$|\.pdf$/i.test(url))
    )];

    const assetSignals = assetUrls.slice(0, 20).map((url) => ({
      source: "FEWS NET",
      title: `FEWS asset detected: ${url.split("/").pop() || "resource"}`,
      summary: "Automatically discovered FEWS downloadable asset; not parsed into country classification values.",
      url,
      date_label: status.checked_at,
      countries: [],
      horizon: "reference",
      risk_level: "info"
    }));

    const allSignals = [...countryLinkSignals, ...assetSignals];
    allSignals.forEach((signal) => {
      (signal.countries || []).forEach((iso3) => {
        if (countryMap[iso3]) {
          countryMap[iso3].fews_reference_count += 1;
        }
      });
    });

    status.country_hits = Object.values(countryMap).filter((c) => (c.fews_reference_count || 0) > 0).length;
    status.asset_count = assetSignals.length;
    status.overall = allSignals.length ? "available" : "partial";
    signals.push(...allSignals.slice(0, 80));

    return { signals, status };
  } catch (err) {
    status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}`;
    return { signals: [], status };
  }
}

// IPC data via HDX (Humanitarian Data Exchange) — fully public, no auth required.
// Direct ipcinfo.org returns 403 from automated runtimes; HDX re-hosts the same
// IPC datasets under CC0 licence and provides a stable CKAN API.
const HDX_IPC_URLS = {
  ETH: "https://data.humdata.org/dataset/4e035f60-be39-4c6d-bd60-5502082e3be9/resource/1203c8aa-40e5-4514-9b65-922fe1d51c11/download/ipc_eth_national_long_latest.csv",
  SSD: "https://data.humdata.org/dataset/c81bb6db-0f1d-4c59-8bde-52d7edc562e9/resource/5dc31009-611d-44d9-9d1b-00e51d6e8fa3/download/ipc_ssd_national_long_latest.csv",
  MOZ: "https://data.humdata.org/dataset/6ec3aca3-7aa0-49b4-83d8-3df88fa7ae0d/resource/48c9921d-e978-4dea-b001-0355c3b11319/download/ipc_moz_national_long_latest.csv",
  CAF: "https://data.humdata.org/dataset/0ce50ddb-17d5-447d-9c61-bd330c4457e9/resource/5f046902-c01f-4803-8a2f-e0e5a1cd733f/download/ipc_caf_national_long_latest.csv",
  TCD: "https://data.humdata.org/dataset/e7315ba9-c0c0-46c5-972f-6ab41201ebc1/resource/c52c7ed7-9f4b-4878-82ee-643385266b9a/download/ipc_tcd_national_long_latest.csv",
  COD: "https://data.humdata.org/dataset/1dfc7346-adc8-4dfc-b2ac-dc18549e9068/resource/d631120c-fe5f-4453-a87f-ea30a6614acd/download/ipc_cod_national_long_latest.csv",
  MLI: "https://data.humdata.org/dataset/38958cd5-c20a-4f80-be2f-8cad061f04e9/resource/507215fd-9b28-46d6-ad1d-f07033c84c77/download/ipc_mli_national_long_latest.csv",
  NER: "https://data.humdata.org/dataset/4ab684d9-0b2b-4938-b384-468e2485f70f/resource/29a02f76-c766-458b-a570-f394fbd7ca9c/download/ipc_ner_national_long_latest.csv",
  BFA: "https://data.humdata.org/dataset/17bcb527-9b05-48e8-b4cf-e25180f13e8c/resource/5acad95f-52dc-4028-b50d-d952d17f4a66/download/ipc_bfa_national_long_latest.csv",
  CMR: "https://data.humdata.org/dataset/ce092792-dedc-41db-82ca-94fb64a04825/resource/b9abf926-44fe-4a91-a5e8-82cd56f5dc9f/download/ipc_cmr_national_long_latest.csv",
  NGA: "https://data.humdata.org/dataset/c3d8899b-11d9-4946-8987-89fe2b2b7c15/resource/1b4ca57a-a406-461b-b36d-613735985f17/download/ipc_nga_national_long_latest.csv",
  ZWE: "https://data.humdata.org/dataset/87ddf300-4686-4fb1-ae02-efb9c2a92ad5/resource/1cde52a1-c8c6-4536-9af2-ce025f721aa8/download/ipc_zwe_national_long_latest.csv"
};

// CSV columns: Date of analysis, Country, Total country population,
//              Validity period, From, To, Phase, Number, Percentage
function parseIpcCsv(csvText, iso3) {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return null;
  }

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const phaseIdx = headers.indexOf("phase");
  const numberIdx = headers.indexOf("number");
  const pctIdx = headers.indexOf("percentage");
  const dateIdx = headers.indexOf("date_of_analysis");
  const validityIdx = headers.indexOf("validity_period");

  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return {
      date: cells[dateIdx]?.trim() || null,
      validity: cells[validityIdx]?.trim().toLowerCase() || null,
      phase: cells[phaseIdx]?.trim() || null,
      number: cells[numberIdx] != null ? Math.round(Number(cells[numberIdx])) : null,
      pct: cells[pctIdx] != null ? Number(Number(cells[pctIdx]).toFixed(3)) : null
    };
  });

  const periods = [...new Set(rows.map((r) => r.date).filter(Boolean))].sort();
  const latestDate = periods[periods.length - 1];
  const currentRows = rows.filter((r) => r.date === latestDate && /current/i.test(String(r.validity || "")));

  const projectedDates = [...new Set(
    rows
      .filter((r) => /project|outlook/i.test(String(r.validity || "")))
      .map((r) => r.date)
      .filter(Boolean)
  )].sort();
  const projectionDate = projectedDates[projectedDates.length - 1] || null;
  const projectedRows = projectionDate
    ? rows.filter((r) => r.date === projectionDate && /project|outlook/i.test(String(r.validity || "")))
    : [];

  const phaseOf = (set, phase) => set.find((r) => r.phase === String(phase));
  const all = phaseOf(currentRows, "all");
  const p3plus = phaseOf(currentRows, "3+");
  const p4 = phaseOf(currentRows, "4");
  const p5 = phaseOf(currentRows, "5");
  const p3plusProj = phaseOf(projectedRows, "3+");
  const p4Proj = phaseOf(projectedRows, "4");
  const p5Proj = phaseOf(projectedRows, "5");

  return {
    iso3,
    source: "IPC via HDX",
    analysis_date: latestDate,
    total_population: all?.number || null,
    phase3plus_number: p3plus?.number || null,
    phase3plus_pct: p3plus?.pct || null,
    phase4_number: p4?.number || null,
    phase4_pct: p4?.pct || null,
    phase5_number: p5?.number || null,
    phase5_pct: p5?.pct || null,
    projection_date: projectionDate,
    projection_phase3plus_number: p3plusProj?.number || null,
    projection_phase3plus_pct: p3plusProj?.pct || null,
    projection_phase4_number: p4Proj?.number || null,
    projection_phase4_pct: p4Proj?.pct || null,
    projection_phase5_number: p5Proj?.number || null,
    projection_phase5_pct: p5Proj?.pct || null,
    ipc_crisis_level: (p3plus?.pct || 0) >= 0.3 ? "crisis" : (p3plus?.pct || 0) >= 0.2 ? "stress" : "watch"
  };
}

function parseCsvLine(line) {
  const cells = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => String(c || "").trim());
}

function isMissingValue(value) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  return !normalized || normalized === "na" || normalized === "n/a" || normalized === "null" || normalized === "nil" || normalized === "none";
}

function toFiniteNumber(value) {
  if (isMissingValue(value)) {
    return null;
  }
  const parsed = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeIso3(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function classifyIpcLevel(phase3plusPct) {
  const pct = Number(phase3plusPct || 0);
  if (pct >= 0.3) {
    return "crisis";
  }
  if (pct >= 0.2) {
    return "stress";
  }
  return "watch";
}

function coalesceString(...values) {
  for (const value of values) {
    if (isMissingValue(value)) {
      continue;
    }
    const candidate = String(value || "").trim();
    if (candidate) {
      return candidate;
    }
  }
  return null;
}

function averageOf(values = []) {
  const valid = values.filter((value) => value != null && Number.isFinite(Number(value))).map((value) => Number(value));
  if (!valid.length) {
    return null;
  }
  return Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(3));
}

function parseMonthReportLabel(value) {
  if (isMissingValue(value)) {
    return null;
  }
  const input = String(value || "").trim();
  const parsed = new Date(`1 ${input} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return {
    label: input,
    iso_month: `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`,
    sort_value: parsed.getTime(),
    month_start: parsed.toISOString()
  };
}

function hasServiceDeliverySchema(records = []) {
  const row = records.find((item) => item && typeof item === "object");
  if (!row) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(row, "Admin0 (Country/State)")
    && Object.prototype.hasOwnProperty.call(row, "Month Report");
}

function parseServiceDeliveryFeedRows(records = []) {
  const grouped = new Map();
  let rawRowCount = 0;

  function addNullableMetric(bucket, metricKey, value) {
    if (value == null) {
      return;
    }
    bucket[metricKey] += value;
    bucket[`${metricKey}_reported_count`] += 1;
  }

  records.forEach((row) => {
    if (!row || typeof row !== "object") {
      return;
    }
    const iso3 = findFcvIso3FromCountryName(row["Admin0 (Country/State)"]);
    const month = parseMonthReportLabel(row["Month Report"]);
    if (!iso3 || !month) {
      return;
    }

    rawRowCount += 1;
    const key = `${iso3}__${month.iso_month}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        iso3,
        country: row["Admin0 (Country/State)"],
        month_label: month.label,
        iso_month: month.iso_month,
        month_start: month.month_start,
        sort_value: month.sort_value,
        admin1: new Set(),
        admin2: new Set(),
        respondent_names: new Set(),
        reporting_rows: 0,
        mental_health_beneficiaries: 0,
        mental_health_beneficiaries_reported_count: 0,
        gbv_cases_managed: 0,
        gbv_cases_managed_reported_count: 0,
        people_reached: 0,
        people_reached_reported_count: 0,
        children_screened_malnutrition: 0,
        children_screened_malnutrition_reported_count: 0,
        opd_consultations_per_person_per_month_values: [],
        deliveries_in_health_institution_pct_values: [],
        anc_visits_mean_values: [],
        measles_vaccination_coverage_pct_values: [],
        penta_vaccination_coverage_pct_values: [],
        sam_complications_pct_values: [],
        sam_complications_managed_pct_values: []
      });
    }

    const bucket = grouped.get(key);
    bucket.reporting_rows += 1;
    if (row["Admin1 (Province/Region/LGA)"]) {
      const admin1 = coalesceString(row["Admin1 (Province/Region/LGA)"]);
      if (admin1) {
        bucket.admin1.add(admin1);
      }
    }
    if (row["Admin2 (District)"]) {
      const admin2 = coalesceString(row["Admin2 (District)"]);
      if (admin2) {
        bucket.admin2.add(admin2);
      }
    }
    if (row["Name of Respondent"]) {
      const respondentName = coalesceString(row["Name of Respondent"]);
      if (respondentName) {
        bucket.respondent_names.add(respondentName);
      }
    }

    addNullableMetric(bucket, "mental_health_beneficiaries", toFiniteNumber(row["Number of persons benefiting from mental health services and psychological support"]));
    addNullableMetric(bucket, "gbv_cases_managed", toFiniteNumber(row["Number of GBV cases identified and clinically managed (GBVIMS)"]));
    addNullableMetric(bucket, "people_reached", toFiniteNumber(row["Number of people reached"]));
    addNullableMetric(bucket, "children_screened_malnutrition", toFiniteNumber(row["Number of children screened for malnutrition"]));

    bucket.opd_consultations_per_person_per_month_values.push(toFiniteNumber(row["Total outpatient department (OPD) consultations per person per month"]));
    bucket.deliveries_in_health_institution_pct_values.push(toFiniteNumber(row["% of deliveries in a health institution"]));
    bucket.anc_visits_mean_values.push(toFiniteNumber(row["Mean number of ANC visits per pregnant woman during the time period"]));
    bucket.measles_vaccination_coverage_pct_values.push(toFiniteNumber(row["Measles vaccination coverage (%)"]));
    bucket.penta_vaccination_coverage_pct_values.push(toFiniteNumber(row["PENTA vaccination coverage (%)"]));
    bucket.sam_complications_pct_values.push(toFiniteNumber(row["Percentage of severe acute malnutrition (SAM) cases with complications"]));
    bucket.sam_complications_managed_pct_values.push(toFiniteNumber(row["Percentage of severe acute malnutrition (SAM) cases with complications managed"]));
  });

  const monthlyRows = Array.from(grouped.values())
    .map((bucket) => ({
      iso3: bucket.iso3,
      country: bucket.country,
      month_label: bucket.month_label,
      iso_month: bucket.iso_month,
      month_start: bucket.month_start,
      sort_value: bucket.sort_value,
      reporting_rows: bucket.reporting_rows,
      admin1_count: bucket.admin1.size,
      admin2_count: bucket.admin2.size,
      respondent_count: bucket.respondent_names.size,
      mental_health_beneficiaries: bucket.mental_health_beneficiaries_reported_count > 0 ? Math.round(bucket.mental_health_beneficiaries) : null,
      gbv_cases_managed: bucket.gbv_cases_managed_reported_count > 0 ? Math.round(bucket.gbv_cases_managed) : null,
      people_reached: bucket.people_reached_reported_count > 0 ? Math.round(bucket.people_reached) : null,
      children_screened_malnutrition: bucket.children_screened_malnutrition_reported_count > 0 ? Math.round(bucket.children_screened_malnutrition) : null,
      opd_consultations_per_person_per_month: averageOf(bucket.opd_consultations_per_person_per_month_values),
      deliveries_in_health_institution_pct: averageOf(bucket.deliveries_in_health_institution_pct_values),
      anc_visits_mean: averageOf(bucket.anc_visits_mean_values),
      measles_vaccination_coverage_pct: averageOf(bucket.measles_vaccination_coverage_pct_values),
      penta_vaccination_coverage_pct: averageOf(bucket.penta_vaccination_coverage_pct_values),
      sam_complications_pct: averageOf(bucket.sam_complications_pct_values),
      sam_complications_managed_pct: averageOf(bucket.sam_complications_managed_pct_values)
    }))
    .sort((a, b) => a.sort_value - b.sort_value || a.country.localeCompare(b.country));

  const byIso3 = new Map();
  monthlyRows.forEach((row) => {
    if (!byIso3.has(row.iso3)) {
      byIso3.set(row.iso3, []);
    }
    byIso3.get(row.iso3).push(row);
  });

  const latestCountryRows = Array.from(byIso3.entries()).map(([iso3, rows]) => {
    const series = rows.sort((a, b) => a.sort_value - b.sort_value);
    const latest = series[series.length - 1];
    return {
      iso3,
      source: "WHO FCV Services Deliveries",
      updated_at: new Date().toISOString(),
      service_delivery: {
        latest_month: latest.iso_month,
        latest_month_label: latest.month_label,
        latest,
        monthly_series: series.map(({ sort_value, ...item }) => item)
      }
    };
  }).sort((a, b) => a.service_delivery.latest.country.localeCompare(b.service_delivery.latest.country));

  const months = [...new Set(monthlyRows.map((row) => row.iso_month))];
  return {
    schema_kind: "service_delivery",
    raw_row_count: rawRowCount,
    country_count: latestCountryRows.length,
    month_count: months.length,
    latest_month: months[months.length - 1] || null,
    months,
    records: latestCountryRows,
    monthly_rows: monthlyRows
  };
}

function parseCountryFeedRows(records = []) {
  if (hasServiceDeliverySchema(records)) {
    return parseServiceDeliveryFeedRows(records);
  }

  const parsed = [];
  for (const row of records) {
    if (!row || typeof row !== "object") {
      continue;
    }

    const iso3 = normalizeIso3(
      row.iso3 || row.ISO3 || row.country_iso3 || row.country_code || row.code
    ) || findFcvIso3FromCountryName(row.country || row.country_name || row.Country);

    if (!iso3) {
      continue;
    }

    const latestYear = toFiniteNumber(row.latest_year || row.nutrition_year || row.year);
    const updatedAt = coalesceString(row.updated_at, row.updatedAt, row.timestamp) || new Date().toISOString();
    const source = coalesceString(row.source, row.data_source) || "WHO country feed";

    const item = {
      iso3,
      source,
      updated_at: updatedAt,
      ipc: {
        phase3plus_pct: toFiniteNumber(row.ipc_phase3plus_pct),
        phase3plus_number: toFiniteNumber(row.ipc_phase3plus_number),
        phase4_number: toFiniteNumber(row.ipc_phase4_number),
        phase5_number: toFiniteNumber(row.ipc_phase5_number),
        analysis_date: coalesceString(row.ipc_analysis_date),
        projection_phase3plus_pct: toFiniteNumber(row.ipc_projection_phase3plus_pct),
        projection_phase3plus_number: toFiniteNumber(row.ipc_projection_phase3plus_number),
        projection_date: coalesceString(row.ipc_projection_date)
      },
      fews_ipc: {
        cs_phase: toFiniteNumber(row.fews_cs_phase),
        ml1_phase: toFiniteNumber(row.fews_ml1_phase)
      },
      indicators: {
        wasting_u5_pct: toFiniteNumber(row.wasting_u5_pct),
        stunting_u5_pct: toFiniteNumber(row.stunting_u5_pct),
        pregnant_anemia_pct: toFiniteNumber(row.pregnant_anemia_pct),
        year: latestYear
      },
      counts: {
        hazard_count: toFiniteNumber(row.hazard_count),
        flood_count: toFiniteNumber(row.flood_count),
        cyclone_count: toFiniteNumber(row.cyclone_count),
        drought_signal_count: toFiniteNumber(row.drought_signal_count),
        report_count_30d: toFiniteNumber(row.report_count_30d),
        conflict_signal_count: toFiniteNumber(row.conflict_signal_count),
        displacement_signal_count: toFiniteNumber(row.displacement_signal_count),
        icpac_forecast_count: toFiniteNumber(row.icpac_forecast_count)
      }
    };

    const hasAnyValue = [
      ...Object.values(item.ipc),
      ...Object.values(item.fews_ipc),
      item.indicators.wasting_u5_pct,
      item.indicators.stunting_u5_pct,
      item.indicators.pregnant_anemia_pct,
      ...Object.values(item.counts)
    ].some((v) => v != null);

    if (hasAnyValue) {
      parsed.push(item);
    }
  }
  return {
    schema_kind: "country_override",
    raw_row_count: parsed.length,
    country_count: parsed.length,
    month_count: 0,
    latest_month: null,
    months: [],
    records: parsed,
    monthly_rows: []
  };
}

function parseCountryFeedCsv(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return [];
  }
  const headers = parseCsvLine(lines[0]);
  const records = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return headers.reduce((acc, header, idx) => {
      acc[header] = cells[idx] != null ? cells[idx] : "";
      return acc;
    }, {});
  });
  return parseCountryFeedRows(records);
}

function persistCountryFeedSnapshot(snapshot) {
  try {
    fs.mkdirSync(path.dirname(COUNTRY_FEED_CACHE_FILE), { recursive: true });
    fs.writeFileSync(COUNTRY_FEED_CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (err) {
    console.warn("Country feed cache write failed", err.message);
  }
}

function loadCountryFeedSnapshotFromDisk() {
  try {
    if (!fs.existsSync(COUNTRY_FEED_CACHE_FILE)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(COUNTRY_FEED_CACHE_FILE, "utf8"));
    if (!raw || typeof raw !== "object") {
      return null;
    }
    if (!Array.isArray(raw.records)) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function countryFeedAgeMinutes(snapshot) {
  if (!snapshot?.saved_at) {
    return Number.POSITIVE_INFINITY;
  }
  const ms = new Date(snapshot.saved_at).getTime();
  if (!Number.isFinite(ms)) {
    return Number.POSITIVE_INFINITY;
  }
  return (Date.now() - ms) / 60000;
}

function mergeCountryFeedIntoCountryMap(countryMap, snapshot) {
  const records = Array.isArray(snapshot?.records) ? snapshot.records : [];
  let applied = 0;
  records.forEach((entry) => {
    const country = countryMap[entry.iso3];
    if (!country) {
      return;
    }

    if (entry.service_delivery) {
      country.service_delivery = entry.service_delivery;
      applied += 1;
      return;
    }

    const ipc = entry.ipc || {};
    if (Object.values(ipc).some((v) => v != null)) {
      const existing = country.ipc || {};
      const merged = {
        ...existing,
        analysis_date: ipc.analysis_date || existing.analysis_date || null,
        phase3plus_pct: ipc.phase3plus_pct != null ? Number(ipc.phase3plus_pct) : existing.phase3plus_pct,
        phase3plus_number: ipc.phase3plus_number != null ? Math.round(Number(ipc.phase3plus_number)) : existing.phase3plus_number,
        phase4_number: ipc.phase4_number != null ? Math.round(Number(ipc.phase4_number)) : existing.phase4_number,
        phase5_number: ipc.phase5_number != null ? Math.round(Number(ipc.phase5_number)) : existing.phase5_number,
        projection_date: ipc.projection_date || existing.projection_date || null,
        projection_phase3plus_pct: ipc.projection_phase3plus_pct != null ? Number(ipc.projection_phase3plus_pct) : existing.projection_phase3plus_pct,
        projection_phase3plus_number: ipc.projection_phase3plus_number != null ? Math.round(Number(ipc.projection_phase3plus_number)) : existing.projection_phase3plus_number,
        source: entry.source || existing.source || "WHO country feed"
      };
      merged.ipc_crisis_level = classifyIpcLevel(merged.phase3plus_pct);
      country.ipc = merged;
    }

    const fews = entry.fews_ipc || {};
    if (Object.values(fews).some((v) => v != null)) {
      country.fews_ipc = {
        ...(country.fews_ipc || {}),
        cs_phase: fews.cs_phase != null ? Number(fews.cs_phase) : country.fews_ipc?.cs_phase,
        ml1_phase: fews.ml1_phase != null ? Number(fews.ml1_phase) : country.fews_ipc?.ml1_phase,
        source: entry.source || country.fews_ipc?.source || "WHO country feed"
      };
    }

    const year = Number(entry?.indicators?.year || new Date().getUTCFullYear());
    ["wasting_u5_pct", "stunting_u5_pct", "pregnant_anemia_pct"].forEach((key) => {
      const value = entry?.indicators?.[key];
      if (value == null) {
        return;
      }
      country.indicators[key] = {
        label: country.indicators?.[key]?.label || key,
        series: [{ year, value: Number(value) }],
        latest: { year, value: Number(value) },
        latest_any: { year, value: Number(value) },
        excluded_as_stale: false,
        stale_warning: false,
        backtest: null,
        source: entry.source || "WHO country feed"
      };
      country.projections[key] = [];
    });

    const counts = entry.counts || {};
    [
      "hazard_count",
      "flood_count",
      "cyclone_count",
      "drought_signal_count",
      "report_count_30d",
      "conflict_signal_count",
      "displacement_signal_count",
      "icpac_forecast_count"
    ].forEach((key) => {
      if (counts[key] == null) {
        return;
      }
      country[key] = Math.max(0, Math.round(Number(counts[key])));
    });

    applied += 1;
  });
  return applied;
}

async function refreshCountryFeedFromRemote(force = false) {
  if (COUNTRY_FEED_PULL_MODE !== "auto") {
    return { attempted: false, reason: "disabled" };
  }

  const localFileAvailable = Boolean(COUNTRY_FEED_LOCAL_FILE) && fs.existsSync(COUNTRY_FEED_LOCAL_FILE);
  if (localFileAvailable) {
    try {
      const stat = fs.statSync(COUNTRY_FEED_LOCAL_FILE);
      const mtimeMs = Number(stat.mtimeMs || 0);
      const currentAge = countryFeedAgeMinutes(countryFeedSnapshot);
      const sameLocalFileSnapshot = countryFeedSnapshot?.mode === "local_file"
        && Number(countryFeedSnapshot?.source_file_mtime_ms || 0) === mtimeMs;

      if (!force && sameLocalFileSnapshot && currentAge <= COUNTRY_FEED_REFRESH_MINUTES) {
        return { attempted: false, reason: "fresh_cache", age_minutes: currentAge, source: "local_file" };
      }

      const fileText = fs.readFileSync(COUNTRY_FEED_LOCAL_FILE, "utf8");
      const parsed = parseCountryFeedCsv(fileText || "");
      countryFeedSnapshot = {
        mode: "local_file",
        schema_kind: parsed.schema_kind,
        source_url: null,
        source_file: COUNTRY_FEED_LOCAL_FILE,
        source_file_mtime_ms: mtimeMs,
        saved_at: new Date().toISOString(),
        records: parsed.records,
        monthly_rows: parsed.monthly_rows,
        row_count: parsed.raw_row_count,
        country_count: parsed.country_count,
        month_count: parsed.month_count,
        latest_month: parsed.latest_month,
        months: parsed.months,
        last_error: null
      };
      persistCountryFeedSnapshot(countryFeedSnapshot);
      return {
        attempted: true,
        success: true,
        row_count: parsed.raw_row_count,
        schema_kind: parsed.schema_kind,
        source: "local_file"
      };
    } catch (err) {
      if (countryFeedSnapshot) {
        countryFeedSnapshot.last_error = err.message;
      }
      return { attempted: true, success: false, error: err.message, source: "local_file" };
    }
  }

  if (!COUNTRY_FEED_CSV_URL) {
    return { attempted: false, reason: "no_source_configured" };
  }

  try {
    const currentAge = countryFeedAgeMinutes(countryFeedSnapshot);
    const sameRemoteSnapshot = countryFeedSnapshot?.mode === "remote_csv"
      && String(countryFeedSnapshot?.source_url || "") === COUNTRY_FEED_CSV_URL;
    if (!force && sameRemoteSnapshot && currentAge <= COUNTRY_FEED_REFRESH_MINUTES) {
      return { attempted: false, reason: "fresh_cache", age_minutes: currentAge, source: "remote_csv" };
    }

    const response = await axios.get(COUNTRY_FEED_CSV_URL, {
      timeout: 20000,
      responseType: "text",
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+country-feed)",
        Accept: "text/csv,application/octet-stream,text/plain"
      }
    });
    const parsed = parseCountryFeedCsv(response.data || "");
    countryFeedSnapshot = {
      mode: "remote_csv",
      schema_kind: parsed.schema_kind,
      source_url: COUNTRY_FEED_CSV_URL,
      saved_at: new Date().toISOString(),
      records: parsed.records,
      monthly_rows: parsed.monthly_rows,
      row_count: parsed.raw_row_count,
      country_count: parsed.country_count,
      month_count: parsed.month_count,
      latest_month: parsed.latest_month,
      months: parsed.months,
      last_error: null
    };
    persistCountryFeedSnapshot(countryFeedSnapshot);
    return { attempted: true, success: true, row_count: parsed.raw_row_count, schema_kind: parsed.schema_kind, source: "remote_csv" };
  } catch (err) {
    if (countryFeedSnapshot) {
      countryFeedSnapshot.last_error = err.message;
    }
    return { attempted: true, success: false, error: err.message, source: "remote_csv" };
  }
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findFcvIso3FromCountryName(countryName) {
  const normalized = normalizeName(countryName);
  if (!normalized) {
    return null;
  }
  for (const c of FCV_COUNTRIES) {
    const allNames = [c.name, ...(c.aliases || [])];
    const matched = allNames.some((candidate) => normalizeName(candidate) === normalized);
    if (matched) {
      return c.iso3;
    }
  }
  return null;
}

function findFcvIso3FromSlug(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) {
    return null;
  }
  for (const c of FCV_COUNTRIES) {
    const candidates = [c.name, ...(c.aliases || [])]
      .map((item) => String(item || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
    const matched = candidates.some((candidate) => normalized === candidate || normalized.startsWith(`${candidate}-`) || normalized.includes(`-${candidate}-`));
    if (matched) {
      return c.iso3;
    }
  }
  return null;
}

function absoluteUrl(base, href) {
  const value = String(href || "").trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

function extractDateToIso(text) {
  const input = String(text || "").trim();
  if (!input) {
    return null;
  }
  const match = input.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{4}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (!match) {
    return null;
  }
  const candidate = match[1].includes("/") || match[1].includes("-")
    ? match[1].replace(/(\d{1,2})-(\d{1,2})-(\d{4})/, "$3-$2-$1")
    : `${match[1]} UTC`;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function fetchReliefWebOrganizationReports(orgUrl, sourceLabel) {
  const response = await axios.get(orgUrl, {
    timeout: 20000,
    headers: {
      "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  const $ = cheerio.load(response.data || "");
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const links = uniqueBy(
    $("a[href*='/report/']")
      .toArray()
      .map((node) => {
        const link = $(node);
        const url = absoluteUrl(orgUrl, link.attr("href"));
        const title = link.text().replace(/\s+/g, " ").trim();
        if (!url || !title) {
          return null;
        }
        const containers = [link.closest("article"), link.closest("li"), link.parent(), link.parent().parent()].filter((item) => item && item.length);
        const containerText = containers.map((item) => item.text().replace(/\s+/g, " ").trim()).find(Boolean) || title;
        const created = extractDateToIso(containerText);
        const ageDays = created ? Math.floor((now - new Date(created)) / dayMs) : null;
        return {
          id: url,
          title,
          summary: containerText === title ? null : containerText,
          content: containerText,
          source: sourceLabel,
          created,
          url,
          countries: FCV_COUNTRIES.filter((c) => countCountryMentions(`${title} ${containerText}`, c)).map((c) => c.iso3),
          in30Days: ageDays != null ? ageDays <= 30 : true
        };
      })
      .filter(Boolean),
    (item) => item.url
  );

  return links.filter((item) => item.countries.length > 0 && item.in30Days).slice(0, 80);
}

function compactText(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

async function fetchCemsFloodSourceStatus() {
  const checkedAt = new Date().toISOString();
  const pages = [
    {
      key: "data_access",
      source: "CEMS Flood Data Access",
      url: CEMS_FLOOD_DATA_ACCESS_URL,
      type: "documentation"
    },
    {
      key: "products",
      source: "Copernicus Global Flood Products",
      url: CEMS_FLOOD_PRODUCTS_URL,
      type: "documentation"
    },
    {
      key: "gfm_wiki",
      source: "Global Flood Monitoring Wiki",
      url: GFM_WIKI_URL,
      type: "documentation"
    },
    {
      key: "gfm_portal",
      source: "Global Flood Monitoring Portal",
      url: GFM_PORTAL_URL,
      type: "portal"
    }
  ];

  const headers = {
    "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
    Accept: "text/html,application/xhtml+xml"
  };

  const sources = await Promise.all(pages.map(async (page) => {
    try {
      const response = await axios.get(page.url, {
        timeout: 20000,
        headers
      });
      const $ = cheerio.load(response.data || "");
      const text = compactText($.text());
      const lower = text.toLowerCase();
      // Special handling for GFM Portal: known to require credentials, even if HTML doesn't contain login text (JS-rendered form)
      const requiresLogin = page.key === "gfm_portal" 
        ? true 
        : /\blogin\b|sign in|enter your gfm credentials/.test(lower);
      const webServicesDocumented = /web services|rest api|rest-apis|wms|wms-t|web push/.test(lower);
      const archiveAccessDocumented = /ewds|mars|ftp|openly available|freely any hydrological simulation/.test(lower);
      const realtimeHydrologyDocumented = /30-day|seasonal forecast|rapid risk assessment|continuous monitoring of floods worldwide/.test(lower);
      const hasGlofasReference = /glofas|global flood awareness system/.test(lower);
      return {
        key: page.key,
        source: page.source,
        url: page.url,
        type: page.type,
        available: true,
        requires_login: requiresLogin,
        web_services_documented: webServicesDocumented,
        archive_access_documented: archiveAccessDocumented,
        realtime_hydrology_documented: realtimeHydrologyDocumented,
        glofas_reference_detected: hasGlofasReference,
        title: compactText($("title").first().text()) || page.source,
        summary: page.type === "portal"
          ? (requiresLogin
            ? "Portal reachable, but live flood portal access is credentialed."
            : "Portal reachable without explicit credential prompt.")
          : (webServicesDocumented || archiveAccessDocumented || realtimeHydrologyDocumented
            ? "Public documentation confirms flood products or access pathways."
            : "Public documentation page reachable, but no automation markers were detected."),
        checked_at: checkedAt,
        error: null
      };
    } catch (err) {
      return {
        key: page.key,
        source: page.source,
        url: page.url,
        type: page.type,
        available: false,
        requires_login: null,
        web_services_documented: false,
        archive_access_documented: false,
        realtime_hydrology_documented: false,
        glofas_reference_detected: false,
        title: page.source,
        summary: null,
        checked_at: checkedAt,
        error: err.message
      };
    }
  }));

  const documentationSources = sources.filter((item) => item.type === "documentation");
  const availableDocumentation = documentationSources.filter((item) => item.available);
  const portalSource = sources.find((item) => item.key === "gfm_portal") || null;
  const webServicesDocumented = documentationSources.some((item) => item.web_services_documented);
  const archiveAccessDocumented = documentationSources.some((item) => item.archive_access_documented);
  const realtimeHydrologyDocumented = documentationSources.some((item) => item.realtime_hydrology_documented);
  const livePortalRequiresLogin = !!portalSource?.requires_login;

  const overall = availableDocumentation.length === 0
    ? "error"
    : (webServicesDocumented || archiveAccessDocumented || realtimeHydrologyDocumented)
      ? (livePortalRequiresLogin ? "partial" : "available")
      : "limited";

  return {
    source: "Copernicus CEMS Flood / GloFAS",
    endpoint: CEMS_FLOOD_DATA_ACCESS_URL,
    checked_at: checkedAt,
    overall,
    public_docs_checked: documentationSources.length,
    public_docs_available: availableDocumentation.length,
    web_services_documented: webServicesDocumented,
    archive_access_documented: archiveAccessDocumented,
    realtime_hydrology_documented: realtimeHydrologyDocumented,
    live_portal_requires_login: livePortalRequiresLogin,
    automated_realtime_feed_connected: false,
    automation_readiness: livePortalRequiresLogin ? "documentation-only" : "public-web-services-documented",
    interpretation: availableDocumentation.length === 0
      ? "Copernicus flood documentation could not be verified in this refresh."
      : livePortalRequiresLogin
        ? "Copernicus flood documentation is publicly reachable, but the live portal requires credentials, so no direct real-time event extraction is claimed."
        : "Copernicus flood documentation is reachable and public access pathways are documented.",
    sources
  };
}

function readAcapsCache() {
  try {
    if (!fs.existsSync(ACAPS_CACHE_FILE)) {
      return null;
    }
    const raw = JSON.parse(fs.readFileSync(ACAPS_CACHE_FILE, "utf8"));
    if (!raw || typeof raw !== "object" || !raw.saved_at || !Array.isArray(raw.items) || !raw.status) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function writeAcapsCache(snapshot) {
  try {
    fs.mkdirSync(path.dirname(ACAPS_CACHE_FILE), { recursive: true });
    fs.writeFileSync(ACAPS_CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (err) {
    console.warn("ACAPS cache write failed", err.message);
  }
}

function isAcapsCacheFresh(snapshot) {
  if (!snapshot?.saved_at) {
    return false;
  }
  const savedMs = new Date(snapshot.saved_at).getTime();
  if (!Number.isFinite(savedMs)) {
    return false;
  }
  const ageMinutes = (Date.now() - savedMs) / 60000;
  return ageMinutes <= ACAPS_CACHE_TTL_MINUTES;
}

function applyAcapsItemsToCountryMap(countryMap, items = []) {
  items.forEach((item) => {
    (item.countries || []).forEach((iso3) => {
      if (countryMap[iso3]) {
        countryMap[iso3].acaps_reference_count += 1;
      }
    });
  });
}

async function fetchAcapsUpdates(countryMap) {
  const status = {
    source: "ACAPS",
    endpoint: ACAPS_HOME_URL,
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    total_items: 0,
    risk_items: 0,
    analysis_items: 0,
    country_hits: 0,
    pages_scanned: 0,
    pages_with_cards: 0,
    pages_with_new_items: 0,
    pages_cap: 0,
    crawl_mode: ACAPS_CRAWL_MODE,
    pagination_cap_reached: false,
    pagination_cap_reached_streak: 0,
    pagination_warning: null,
    pagination_stopped_reason: null,
    error: null
  };

  if (!acapsCacheSnapshot) {
    acapsCacheSnapshot = readAcapsCache();
  }
  if (isAcapsCacheFresh(acapsCacheSnapshot)) {
    const cachedItems = (acapsCacheSnapshot.items || []).slice(0, 30);
    applyAcapsItemsToCountryMap(countryMap, cachedItems);
    const cachedStatus = {
      ...(acapsCacheSnapshot.status || {}),
      checked_at: new Date().toISOString(),
      cache_used: true,
      cache_saved_at: acapsCacheSnapshot.saved_at,
      country_hits: Object.values(countryMap).filter((c) => (c.acaps_reference_count || 0) > 0).length
    };
    return { items: cachedItems, status: cachedStatus };
  }

  try {
    const response = await axios.get(ACAPS_HOME_URL, {
      timeout: 20000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const $ = cheerio.load(response.data || "");
    const items = [];

    $(".risk-card").each((_, node) => {
      const card = $(node);
      const title = card.find("p").first().text().replace(/\s+/g, " ").trim();
      const countryName = card.find(".card-info span").eq(1).text().replace(/\s+/g, " ").trim();
      const riskLevel = card.find(".risk-legend").text().replace(/\s+/g, " ").trim();
      const riskType = card.find(".subtitle").filter((_, el) => /Risk type/i.test($(el).text())).parent().text().replace(/\s+/g, " ").trim();
      const href = card.find("a.single-risk-detail-link").attr("data-url") || card.find("a.single-risk-detail-link").attr("href");
      const url = absoluteUrl(ACAPS_HOME_URL, href);
      const created = extractDateToIso(card.find(".card-info").first().text()) || status.checked_at;
      const iso3 = findFcvIso3FromCountryName(countryName);
      if (!title || !iso3) {
        return;
      }
      items.push({
        id: `acaps-risk-${iso3}-${title}`,
        title,
        summary: riskType || null,
        content: `${countryName}. ${title}. ${riskType || ""}`.trim(),
        source: "ACAPS Risk Radar",
        created,
        url,
        countries: [iso3],
        in30Days: true,
        risk_level: riskLevel || null,
        content_type: "risk"
      });
    });

    const parseArchivesCards = (page$, pushedIds) => {
      const before = pushedIds.size;
      page$(".data-product").each((_, node) => {
        const card = page$(node);
        const title = card.find("h2.title").first().text().replace(/\s+/g, " ").trim();
        const summary = card.find(".text").first().text().replace(/\s+/g, " ").trim();
        const dateText = card.find("p.date").first().text().replace(/\s+/g, " ").trim();
        const href =
          card.find(".document-thumbnail a[href]").first().attr("href") ||
          card.find(".content-right a[href]").first().attr("href");
        const url = absoluteUrl(ACAPS_ARCHIVES_URL, href);
        const countries = FCV_COUNTRIES
          .filter((country) => countCountryMentions(`${title} ${summary}`, country))
          .map((country) => country.iso3);
        const tags = card.find(".badge").map((__, badge) => page$(badge).text().replace(/\s+/g, " ").trim()).get().filter(Boolean);
        if (!title || !url || !countries.length) {
          return;
        }
        const itemId = `acaps-analysis-${url}`;
        if (pushedIds.has(itemId)) {
          return;
        }
        pushedIds.add(itemId);
        items.push({
          id: itemId,
          title,
          summary: summary || null,
          content: [title, summary, tags.join(", ")].filter(Boolean).join(". "),
          source: "ACAPS Analysis",
          created: extractDateToIso(dateText) || status.checked_at,
          url,
          countries,
          in30Days: true,
          content_type: "analysis",
          topics: tags
        });
      });
      return pushedIds.size - before;
    };

    const archivesHeaders = {
      "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
      Accept: "text/html,application/xhtml+xml"
    };
    const pushedArchiveIds = new Set();
    const maxArchivePages = currentAcapsMaxPages();
    status.pages_cap = maxArchivePages;

    for (let page = 1; page <= maxArchivePages; page += 1) {
      status.pages_scanned = page;
      try {
        const pageUrl = page === 1
          ? ACAPS_ARCHIVES_URL
          : `${ACAPS_ARCHIVES_URL}?tx_acapspackage_dataproductlist%5BcurrentPage%5D=${page}`;
        const pageResponse = await axios.get(pageUrl, {
          timeout: 20000,
          headers: archivesHeaders
        });
        const page$ = cheerio.load(pageResponse.data || "");
        const pageCards = page$(".data-product").length;
        if (!pageCards) {
          status.pagination_stopped_reason = `no_cards_page_${page}`;
          break;
        }
        status.pages_with_cards += 1;
        const added = parseArchivesCards(page$, pushedArchiveIds);
        if (added > 0) {
          status.pages_with_new_items += 1;
        }
        if (page > 1 && added === 0) {
          status.pagination_stopped_reason = `no_new_items_page_${page}`;
          break;
        }
      } catch (archiveErr) {
        if (page === 1) {
          throw archiveErr;
        }
        // Additional pages are best effort and should not fail the whole ACAPS fetch.
        console.error(`ACAPS archives page ${page} fetch failed`, archiveErr.message);
        status.pagination_stopped_reason = `fetch_error_page_${page}`;
        break;
      }
    }

    if (!status.pagination_stopped_reason) {
      status.pagination_stopped_reason = status.pages_scanned >= maxArchivePages
        ? `max_pages_${maxArchivePages}`
        : "completed";
    }

    status.pagination_cap_reached = status.pagination_stopped_reason === `max_pages_${maxArchivePages}`;
    acapsPaginationCapReachedStreak = status.pagination_cap_reached ? acapsPaginationCapReachedStreak + 1 : 0;
    status.pagination_cap_reached_streak = acapsPaginationCapReachedStreak;
    if (acapsPaginationCapReachedStreak >= 3) {
      status.pagination_warning = `acaps_cap_reached_streak_${acapsPaginationCapReachedStreak}`;
    }

    const uniqueItems = uniqueBy(items, (item) => item.id).slice(0, 30);

    uniqueItems.forEach((item) => {
      (item.countries || []).forEach((iso3) => {
        if (countryMap[iso3]) {
          countryMap[iso3].acaps_reference_count += 1;
        }
      });
    });

    status.total_items = uniqueItems.length;
    status.risk_items = uniqueItems.filter((item) => item.content_type === "risk").length;
    status.analysis_items = uniqueItems.filter((item) => item.content_type === "analysis").length;
    status.country_hits = Object.values(countryMap).filter((c) => (c.acaps_reference_count || 0) > 0).length;
    status.overall = uniqueItems.length ? "available" : "partial";
    status.cache_used = false;
    acapsCacheSnapshot = {
      saved_at: new Date().toISOString(),
      items: uniqueItems,
      status: { ...status }
    };
    writeAcapsCache(acapsCacheSnapshot);
    return { items: uniqueItems, status };
  } catch (err) {
    if (!status.pagination_stopped_reason) {
      status.pagination_stopped_reason = "fetch_failed_before_pagination";
    }
    status.pagination_cap_reached = false;
    acapsPaginationCapReachedStreak = 0;
    status.pagination_cap_reached_streak = acapsPaginationCapReachedStreak;
    status.pagination_warning = null;
    status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}`;
    return { items: [], status };
  }
}

function setCookieHeader(setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders) || !setCookieHeaders.length) {
    return "";
  }
  return setCookieHeaders.map((item) => String(item).split(";")[0]).join("; ");
}

function getAcledCsvCandidates() {
  const currentYear = new Date().getUTCFullYear();
  const defaults = [
    ACLED_CONFLICT_INDEX_CSV_URL,
    `https://apps.acleddata.com/conflictindex${currentYear}/newindextable${currentYear}.csv`,
    `https://apps.acleddata.com/conflictindex${currentYear - 1}/newindextable${currentYear - 1}.csv`
  ];
  return [...new Set([...ACLED_CONFLICT_INDEX_CSV_URLS, ...defaults].filter(Boolean))];
}

function writeAcledCsvCache(csvText) {
  try {
    fs.mkdirSync(path.dirname(ACLED_CACHE_FILE), { recursive: true });
    fs.writeFileSync(ACLED_CACHE_FILE, csvText, "utf8");
  } catch (err) {
    console.warn("ACLED cache write failed", err.message);
  }
}

function readAcledCsvCache() {
  try {
    if (!fs.existsSync(ACLED_CACHE_FILE)) {
      return null;
    }
    const text = String(fs.readFileSync(ACLED_CACHE_FILE, "utf8") || "").trim();
    return text || null;
  } catch (err) {
    console.warn("ACLED cache read failed", err.message);
    return null;
  }
}

function isUnhcrReliefWebItem(item) {
  const creator = String(item?.creator || "").trim();
  const categories = Array.isArray(item?.categories) ? item.categories.map((cat) => String(cat || "").trim()) : [];
  const blob = [
    item?.title,
    item?.contentSnippet,
    item?.content,
    item?.link,
    creator,
    categories.join(" ")
  ].filter(Boolean).join(" ");
  return /(\bunhcr\b|united nations high commissioner for refugees)/i.test(blob);
}

function formatDisplacementCount(n) {
  const num = Number(n) || 0;
  if (num <= 0) return null;
  if (num >= 1e6) return (num / 1e6).toFixed(1) + "M";
  if (num >= 1e3) return Math.round(num / 1e3) + "K";
  return String(num);
}

async function fetchUnhcrPopulationStats() {
  const results = await Promise.allSettled(
    FCV_COUNTRIES.map((country) =>
      axios.get(UNHCR_POPULATION_API_URL, {
        params: { yearFrom: 2022, yearTo: 2024, coa: country.iso3, limit: 5 },
        timeout: 10000,
        headers: { "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)" }
      }).then((r) => ({
        iso3: country.iso3,
        name: country.name,
        rows: (r.data.items || []).sort((a, b) => b.year - a.year)
      }))
    )
  );

  const items = [];
  for (const result of results) {
    if (result.status !== "fulfilled" || !result.value.rows.length) {
      continue;
    }
    const { iso3, name, rows } = result.value;
    const latest = rows[0];
    const idps = formatDisplacementCount(latest.idps);
    const refugees = formatDisplacementCount(latest.refugees);
    const asylumSeekers = formatDisplacementCount(latest.asylum_seekers);
    if (!idps && !refugees && !asylumSeekers) {
      continue;
    }
    const parts = [
      idps ? `${idps} IDPs` : null,
      refugees ? `${refugees} refugees hosted` : null,
      asylumSeekers ? `${asylumSeekers} asylum seekers` : null
    ].filter(Boolean);
    const summary = parts.join(", ");
    items.push({
      id: `unhcr-stats-${iso3}-${latest.year}`,
      title: `${name}: ${summary} (${latest.year})`,
      summary: `UNHCR displacement statistics: ${summary}. Year of estimate: ${latest.year}.`,
      content: `${name}: ${summary} (UNHCR Population Data ${latest.year})`,
      source: "UNHCR Population Data",
      created: `${latest.year}-12-31T00:00:00.000Z`,
      url: "https://www.unhcr.org/data/",
      countries: [iso3],
      in30Days: true
    });
  }
  return items;
}

async function authenticateAcledSession() {
  if (!ACLED_EMAIL || !ACLED_PASSWORD) {
    return { cookieHeader: "", authenticated: false };
  }

  try {
    const loginPage = await axios.get(ACLED_LOGIN_URL, {
      timeout: 15000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml"
      }
    });
    const cookieHeader = setCookieHeader(loginPage.headers["set-cookie"] || []);
    const $ = cheerio.load(String(loginPage.data || ""));
    const token = $('input[name="form_build_id"]').attr("value") || "";
    const formId = $('input[name="form_id"]').attr("value") || "user_login_form";
    const body = new URLSearchParams({
      name: ACLED_EMAIL,
      pass: ACLED_PASSWORD,
      form_build_id: token,
      form_id: formId,
      op: "Log in"
    }).toString();

    const loginResponse = await axios.post(ACLED_LOGIN_URL, body, {
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: ACLED_LOGIN_URL,
        Cookie: cookieHeader
      }
    });

    const loginCookieHeader = setCookieHeader(loginResponse.headers["set-cookie"] || []);
    const mergedCookies = [cookieHeader, loginCookieHeader].filter(Boolean).join("; ");
    return {
      cookieHeader: mergedCookies,
      authenticated: !!mergedCookies
    };
  } catch (err) {
    console.error("ACLED login attempt failed:", err.message);
    return { cookieHeader: "", authenticated: false };
  }
}

// ─── DTM Population Displacement (IOM / HDX) ────────────────────────────────

function readDtmCache() {
  try {
    if (!fs.existsSync(DTM_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(DTM_CACHE_FILE, "utf8"));
    return raw && raw.saved_at ? raw : null;
  } catch (e) { return null; }
}

function writeDtmCache(snapshot) {
  try {
    fs.mkdirSync(path.dirname(DTM_CACHE_FILE), { recursive: true });
    fs.writeFileSync(DTM_CACHE_FILE, JSON.stringify(snapshot, null, 2), "utf8");
  } catch (e) { console.error("[DTM] Cache write failed:", e.message); }
}

function isDtmCacheFresh(snapshot) {
  if (!snapshot || !snapshot.saved_at) return false;
  const ageHours = (Date.now() - new Date(snapshot.saved_at).getTime()) / 3600000;
  return ageHours < DTM_CACHE_TTL_HOURS;
}

async function fetchDtmPopulationData(countryMap = {}) {
  if (!dtmDisplacementSnapshot) {
    dtmDisplacementSnapshot = readDtmCache();
  }
  if (isDtmCacheFresh(dtmDisplacementSnapshot)) {
    applyDtmToCountryMap(dtmDisplacementSnapshot.by_iso3 || {}, countryMap);
    return { source: "cache", saved_at: dtmDisplacementSnapshot.saved_at, countries: Object.keys(dtmDisplacementSnapshot.by_iso3 || {}).length };
  }

  if (dtmFetchInFlight) {
    await dtmFetchInFlight;
    applyDtmToCountryMap(dtmDisplacementSnapshot?.by_iso3 || {}, countryMap);
    return { source: "cache", saved_at: dtmDisplacementSnapshot?.saved_at, countries: Object.keys(dtmDisplacementSnapshot?.by_iso3 || {}).length };
  }

  console.log("[DTM] Fetching displacement CSV from HDX...");
  dtmFetchInFlight = (async () => {
  try {
    const response = await axios.get(DTM_HDX_CSV_URL, {
      responseType: "text",
      timeout: 45000,
      headers: { "User-Agent": "WHO-AFRO-Dashboard/1.0" },
      maxRedirects: 5
    });

    const lines = String(response.data).split(/\r?\n/);
    if (lines.length < 2) throw new Error("DTM CSV empty or malformed");

    const header = lines[0].split(",");
    const idxAdminLevel = header.indexOf("adminLevel");
    const idxIso3 = header.indexOf("admin0Pcode");
    const idxIdps = header.indexOf("numPresentIdpInd");
    const idxDate = header.indexOf("reportingDate");
    const idxReason = header.indexOf("displacementReason");

    if (idxAdminLevel < 0 || idxIso3 < 0 || idxIdps < 0) {
      throw new Error("DTM CSV missing expected columns");
    }

    // Collect admin0-level rows per country, keeping the latest reportingDate entry
    const latest = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const lvl = cols[idxAdminLevel];
      if (lvl !== "0") continue;
      const iso3 = cols[idxIso3];
      if (!iso3 || iso3.length !== 3) continue;
      const dt = cols[idxDate] || "";
      const idps = parseInt(cols[idxIdps], 10) || 0;
      const reason = cols[idxReason] || "";

      if (!latest[iso3] || dt > latest[iso3].reporting_date) {
        latest[iso3] = { idp_count: idps, reporting_date: dt.slice(0, 10), displacement_reason: reason };
      } else if (dt === latest[iso3].reporting_date) {
        latest[iso3].idp_count += idps;
      }
    }

    const snapshot = { saved_at: new Date().toISOString(), by_iso3: latest };
    dtmDisplacementSnapshot = snapshot;
    writeDtmCache(snapshot);
    applyDtmToCountryMap(latest, countryMap);
    console.log(`[DTM] Loaded ${Object.keys(latest).length} countries from HDX CSV`);
    return { source: "live", saved_at: snapshot.saved_at, countries: Object.keys(latest).length };
  } catch (err) {
    console.error("[DTM] Fetch failed:", err.message);
    return { source: "error", error: err.message, countries: 0 };
  }
  })();
  dtmFetchInFlight.finally(() => { dtmFetchInFlight = null; });
  const result = await dtmFetchInFlight;
  applyDtmToCountryMap(dtmDisplacementSnapshot?.by_iso3 || {}, countryMap);
  return result;
}

function applyDtmToCountryMap(byIso3, countryMap) {
  Object.entries(byIso3).forEach(([iso3, d]) => {
    if (countryMap[iso3]) {
      countryMap[iso3].dtm_idp = {
        idp_count: d.idp_count,
        reporting_date: d.reporting_date,
        displacement_reason: d.displacement_reason
      };
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────

async function fetchAcledConflictIndex(countryMap = {}) {
  const status = {
    source: "ACLED Conflict Index",
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    authenticated: false,
    account_configured: !!(ACLED_EMAIL && ACLED_PASSWORD),
    account_email: ACLED_EMAIL || null,
    endpoint: null,
    endpoints_checked: [],
    used_cached_csv: false,
    total_rows: 0,
    fcv_rows: 0,
    mapped_countries: 0,
    error: null
  };

  try {
    const endpoints = getAcledCsvCandidates();
    const requestCsv = async (endpoint, cookieHeader) => axios.get(endpoint, {
      timeout: 20000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/csv,text/plain,*/*",
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      responseType: "text"
    });

    let auth = { cookieHeader: "", authenticated: false };
    if (ACLED_AUTH_MODE === "always") {
      auth = await authenticateAcledSession();
      status.authenticated = auth.authenticated;
    }

    let csvText = "";
    let lastError = null;

    for (const endpoint of endpoints) {
      status.endpoints_checked.push(endpoint);
      status.endpoint = endpoint;
      try {
        let response;
        try {
          response = await requestCsv(endpoint, auth.cookieHeader);
        } catch (err) {
          const statusCode = Number(err?.response?.status || 0);
          const shouldRetryWithAuth =
            (statusCode === 401 || statusCode === 403) &&
            ACLED_AUTH_MODE !== "off" &&
            status.account_configured &&
            !auth.authenticated;

          if (!shouldRetryWithAuth) {
            throw err;
          }

          auth = await authenticateAcledSession();
          status.authenticated = auth.authenticated;
          if (!auth.cookieHeader) {
            throw err;
          }
          response = await requestCsv(endpoint, auth.cookieHeader);
        }

        csvText = String(response.data || "").trim();
        if (csvText) {
          writeAcledCsvCache(csvText);
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!csvText) {
      const cached = readAcledCsvCache();
      if (cached) {
        csvText = cached;
        status.used_cached_csv = true;
        status.overall = "partial";
      }
    }

    if (!csvText) {
      throw lastError || new Error("acled_csv_unavailable");
    }

    const lines = csvText.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      status.error = "csv_empty";
      return { reports: [], status };
    }

    const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    const rankIdx = headers.indexOf("rank");
    const countryIdx = headers.indexOf("country");
    const levelIdx = headers.indexOf("index_level");
    const changeIdx = headers.indexOf("ranking_change");
    const deadlinessIdx = headers.indexOf("deadliness_rank");
    const diffusionIdx = headers.indexOf("diffusion_rank");
    const dangerIdx = headers.indexOf("danger_rank");
    const fragmentationIdx = headers.indexOf("fragmentation_rank");

    const entries = [];
    const mappedCountries = new Set();

    lines.slice(1).forEach((line) => {
      const cells = parseCsvLine(line);
      const countryName = cells[countryIdx] || "";
      const iso3 = findFcvIso3FromCountryName(countryName);
      status.total_rows += 1;
      if (!iso3) {
        return;
      }
      status.fcv_rows += 1;
      const rank = cells[rankIdx] || null;
      const level = cells[levelIdx] || "Unknown";
      const change = cells[changeIdx] || null;
      const deadliness = cells[deadlinessIdx] || null;
      const diffusion = cells[diffusionIdx] || null;
      const danger = cells[dangerIdx] || null;
      const fragmentation = cells[fragmentationIdx] || null;

      mappedCountries.add(iso3);
      if (countryMap[iso3]) {
        countryMap[iso3].acled_index = {
          source: "ACLED Conflict Index",
          checked_at: status.checked_at,
          rank: rank ? Number(rank) : null,
          index_level: level,
          ranking_change: change ? Number(change) : null,
          deadliness_rank: deadliness ? Number(deadliness) : null,
          diffusion_rank: diffusion ? Number(diffusion) : null,
          danger_rank: danger ? Number(danger) : null,
          fragmentation_rank: fragmentation ? Number(fragmentation) : null
        };
      }

      entries.push({
        id: `acled-index-${iso3}-${rank || "na"}`,
        title: `ACLED Conflict Index: ${countryName} (${level})`,
        summary: `Rank ${rank || "n/a"}; change ${change || "n/a"}; deadliness ${deadliness || "n/a"}; diffusion ${diffusion || "n/a"}; danger ${danger || "n/a"}; fragmentation ${fragmentation || "n/a"}.`,
        content: `ACLED Conflict Index context entry for ${countryName}.`,
        source: "ACLED Conflict Index",
        checked_at: status.checked_at,
        url: ACLED_CONFLICT_INDEX_PAGE,
        countries: [iso3],
        rank: rank ? Number(rank) : null,
        index_level: level,
        ranking_change: change ? Number(change) : null
      });
    });

    status.mapped_countries = mappedCountries.size;
    if (!status.used_cached_csv) {
      status.overall = entries.length ? "available" : "partial";
    }
    return { entries, status };
  } catch (err) {
    status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}`;
    return { entries: [], status };
  }
}

function deriveDroughtSignals(countryMap, forecasts, reports) {
  const droughtRegex = /drought|dry\s+spell|rainfall\s+deficit|below\s+normal\s+rainfall|arid\s+conditions|water\s+stress/i;
  const items = (forecasts || []).filter((f) => droughtRegex.test(String(f.title || "")));
  const signals = [];

  items.forEach((item) => {
    const text = `${item.title || ""}`;
    const mentioned = FCV_COUNTRIES.filter((c) => countCountryMentions(text, c)).map((c) => c.iso3);
    mentioned.forEach((iso3) => {
      if (countryMap[iso3]) {
        countryMap[iso3].drought_signal_count += 1;
      }
    });

    signals.push({
      source: "ICPAC",
      title: item.title,
      url: item.url || null,
      horizon: item.horizon || null,
      date_label: item.date_label || null,
      countries: mentioned
    });
  });

  const reportItems = (reports || []).filter((r) => {
    if (!r.in30Days) {
      return false;
    }
    const text = `${r.title || ""} ${r.summary || ""} ${r.content || ""}`;
    return droughtRegex.test(text);
  });
  reportItems.forEach((item) => {
    const mentioned = (item.countries || []).filter((iso3) => !!countryMap[iso3]);
    mentioned.forEach((iso3) => {
      if (countryMap[iso3]) {
        countryMap[iso3].drought_signal_count += 1;
      }
    });

    signals.push({
      source: "ReliefWeb",
      title: item.title,
      url: item.url || null,
      horizon: "advisory",
      date_label: item.created || null,
      countries: mentioned
    });
  });

  return signals.slice(0, 40);
}

function deriveConflictDisplacementSignals(countryMap, reports) {
  const conflictRegex = /conflict|violence|violent|armed|attack|attacks|clash|clashes|insecurity|hostilit|airstrike|shelling|abduction|militia|insurgent|security\s+incident|fighting|ceasefire\s+violation|intercommunal\s+violence|massacre/i;
  const displacementRegex = /displacement|displaced|internally\s+displaced|idp\b|idps\b|refugee|refugees|asylum\s*seeker|asylum\s*seekers|returnee|returnees|forced\s+movement|population\s+movement|people\s+on\s+the\s+move|fleeing|fled|evacuat|relocat|cross[-\s]?border/i;
  const signals = [];

  (reports || [])
    .filter((item) => item.in30Days)
    .forEach((item) => {
      const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`;
      const hasConflict = conflictRegex.test(text);
      const hasDisplacement = displacementRegex.test(text);

      if (!hasConflict && !hasDisplacement) {
        return;
      }

      const mentioned = (item.countries || []).filter((iso3) => !!countryMap[iso3]);
      mentioned.forEach((iso3) => {
        if (hasConflict) {
          countryMap[iso3].conflict_signal_count += 1;
        }
        if (hasDisplacement) {
          countryMap[iso3].displacement_signal_count += 1;
        }
      });

      signals.push({
        source: item.source || "Unknown",
        title: item.title || "Untitled",
        summary: item.summary || null,
        url: item.url || null,
        date_label: item.created || null,
        signal_tags: [
          ...(hasConflict ? ["Conflict"] : []),
          ...(hasDisplacement ? ["Displacement"] : [])
        ],
        countries: mentioned
      });
    });

  return signals.slice(0, 80);
}

function deriveDiseaseOutbreakSignals(countryMap, reports, whoDonReports) {
  const diseaseRegex = /disease\s+outbreak|outbreak|cholera|meningitis|measles|ebola|marburg|yellow\s+fever|dengue|mpox|monkeypox|polio|avian\s+influenza|h5n1|lassa\s+fever|rift\s+valley\s+fever/i;
  const signals = [];

  (reports || [])
    .filter((item) => item.in30Days)
    .forEach((item) => {
      const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`;
      if (!diseaseRegex.test(text)) {
        return;
      }

      const mentioned = (item.countries || []).filter((iso3) => !!countryMap[iso3]);
      mentioned.forEach((iso3) => {
        countryMap[iso3].disease_outbreak_signal_count += 1;
      });
      const diseaseLabel = extractDiseaseLabel(text);

      signals.push({
        source: item.source || "Unknown",
        title: item.title || "Untitled",
        summary: item.summary || null,
        url: item.url || null,
        date_label: item.created || null,
        signal_tags: ["Disease Outbreak", diseaseLabel],
        countries: mentioned
      });
    });

  (whoDonReports || [])
    .filter((item) => item.in30Days)
    .forEach((item) => {
      const mentioned = (item.countries || []).filter((iso3) => !!countryMap[iso3]);
      const diseaseLabel = item.disease || extractDiseaseLabel(`${item.title || ""} ${item.summary || ""}`);
      signals.push({
        source: item.source || "WHO DON RSS",
        title: item.title || "Untitled",
        summary: item.summary || null,
        url: item.url || null,
        date_label: item.created || null,
        signal_tags: ["Disease Outbreak", diseaseLabel],
        countries: mentioned
      });
    });

  return signals.slice(0, 80);
}

function buildWhoDonFallbackFromReliefWebReports(reports) {
  const diseaseRegex = /disease\s+outbreak|outbreak|cholera|meningitis|measles|ebola|marburg|yellow\s+fever|dengue|mpox|monkeypox|polio|avian\s+influenza|h5n1|lassa\s+fever|rift\s+valley\s+fever/i;
  return (reports || [])
    .filter((item) => item.in30Days)
    .filter((item) => {
      const text = `${item.title || ""} ${item.summary || ""} ${item.content || ""}`;
      return diseaseRegex.test(text);
    })
    .map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary || null,
      content: item.content || null,
      source: "ReliefWeb disease fallback",
      disease: extractDiseaseLabel(`${item.title || ""} ${item.summary || ""} ${item.content || ""}`),
      created: item.created || null,
      url: item.url || null,
      countries: item.countries || [],
      in30Days: true
    }))
    .slice(0, 60);
}

async function fetchIpcData(countryMap) {
  const results = {};
  const entries = Object.entries(HDX_IPC_URLS);

  const fetches = entries.map(async ([iso3, url]) => {
    try {
      const response = await axios.get(url, {
        timeout: 25000,
        headers: {
          "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
          Accept: "text/csv,text/plain,*/*"
        },
        responseType: "text"
      });
      const parsed = parseIpcCsv(response.data, iso3);
      if (parsed) {
        results[iso3] = parsed;
        if (countryMap[iso3]) {
          countryMap[iso3].ipc = parsed;
        }
      }
    } catch (err) {
      console.error(`IPC HDX fetch failed for ${iso3}:`, err.message);
      const offlinePath = path.join(DATA_DIR, "ipc", `${iso3}.csv`);
      if (fs.existsSync(offlinePath)) {
        try {
          const parsed = parseIpcCsv(fs.readFileSync(offlinePath, "utf8"), iso3);
          if (parsed) {
            results[iso3] = parsed;
            if (countryMap[iso3]) {
              countryMap[iso3].ipc = parsed;
            }
            console.log(`IPC ${iso3}: using offline fallback data`);
          }
        } catch (offErr) {
          console.error(`IPC offline load failed for ${iso3}:`, offErr.message);
        }
      }
    }
  });

  await Promise.all(fetches);
  return results;
}

async function checkIpcSourceHealth() {
  const testUrl = HDX_IPC_URLS.ETH;
  try {
    const response = await axios.get(testUrl, {
      timeout: 20000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/csv,text/plain,*/*"
      },
      responseType: "text"
    });
    const firstLine = String(response.data || "").split(/\r?\n/)[0];
    return {
      source: "IPC via HDX",
      endpoint: testUrl,
      status: "available",
      http_status: response.status,
      note: `IPC data is accessible via HDX open datasets. Sample header: ${firstLine.slice(0, 80)}`
    };
  } catch (err) {
    return {
      source: "IPC via HDX",
      endpoint: testUrl,
      status: "blocked",
      http_status: err.response?.status || null,
      note: `HDX IPC fetch failed (${err.response?.status || err.code || "request_failed"}).`
    };
  }
}

const ICPAC_SOURCE_URLS = [
  { horizon: "weekly", url: "https://www.icpac.net/weekly-forecast/" },
  { horizon: "monthly", url: "https://www.icpac.net/monthly-forecast/" },
  { horizon: "seasonal", url: "https://www.icpac.net/seasonal-forecast/" }
];

const ENSO_CPC_DISCUSSION_URL = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml";

const CYCLONE_DEDICATED_SOURCES = [
  {
    source: "Meteo-France La Reunion",
    url: "https://www.meteofrance.re/cyclone",
    region_scope: "Southwest Indian Ocean",
    include_non_projection: true,
    afro_filter: false
  },
  {
    source: "Cyclocane",
    url: "https://www.cyclocane.com/",
    region_scope: "Indian Ocean and Africa-relevant basins",
    include_non_projection: true,
    afro_filter: true,
    require_storm_tracker: true
  },
  {
    source: "WMO Severe Weather Information Centre",
    url: "https://severeweather.wmo.int/",
    region_scope: "Global (AFRO filtered)",
    include_non_projection: false,
    afro_filter: true
  }
];

const ICPAC_FCV_FOCUS = ["ETH", "SSD", "ERI"];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/");
}

function stripHtmlTags(text) {
  return String(text || "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(base, pathOrUrl) {
  if (!pathOrUrl) {
    return null;
  }
  try {
    return new URL(pathOrUrl, base).toString();
  } catch (_err) {
    return null;
  }
}

function absoluteIcpacUrl(pathOrUrl) {
  if (!pathOrUrl) {
    return null;
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  if (pathOrUrl.startsWith("/")) {
    return `https://www.icpac.net${pathOrUrl}`;
  }
  return `https://www.icpac.net/${pathOrUrl}`;
}

function classifyIcpacRisk(title) {
  const text = String(title || "").toLowerCase();
  if (/flood|heavy rainfall|heat stress|drought/.test(text)) {
    return "high";
  }
  if (/anomal|rainfall|temperature/.test(text)) {
    return "watch";
  }
  return "info";
}

function classifyEnsoRisk(alertStatus) {
  const text = String(alertStatus || "").toLowerCase();
  if (/warning/.test(text)) {
    return "high";
  }
  if (/watch|advisory/.test(text)) {
    return "watch";
  }
  return "info";
}

function extractEnsoAdvisoryFromHtml(html) {
  const $ = cheerio.load(String(html || ""));
  const pageText = $("body").text().replace(/\s+/g, " ").trim();
  if (!pageText) {
    return null;
  }

  const issuedMatch = pageText.match(/ENSO\s*DIAGNOSTIC\s*DISCUSSION.*?(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+ENSO Alert System Status:/i);
  const alertStatusMatch = pageText.match(/ENSO Alert System Status:\s*(.+?)(?=\s+(?:Synopsis:|In summary,|The next ENSO Diagnostics Discussion is scheduled for))/i);
  const synopsisMatch = pageText.match(/Synopsis:\s*(.+?)(?=\s+(?:La Niña|El Niño|ENSO-neutral)\s+(?:continued|is present|remains)|\s+The North American Multi-Model Ensemble|\s+In summary,|\s+Oceanic and atmospheric conditions are updated weekly|\s+The next ENSO Diagnostics Discussion is scheduled for)/i);
  const nextUpdateMatch = pageText.match(/The next ENSO Diagnostics Discussion is scheduled for\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i);
  const summaryMatch = pageText.match(/In summary,\s*(.+?)(?=\s+\[\[Fig\.|\s+This discussion is a consolidated effort|\s+The next ENSO Diagnostics Discussion is scheduled for)/i);

  const alert_status = (alertStatusMatch?.[1] || "").trim() || null;
  const synopsis = (summaryMatch?.[1] || synopsisMatch?.[1] || "").trim() || null;
  const issued_on = (issuedMatch?.[1] || "").trim() || null;
  const next_update = (nextUpdateMatch?.[1] || "").trim() || null;

  if (!alert_status && !synopsis && !issued_on) {
    return null;
  }

  return {
    source: "NOAA CPC ENSO Diagnostic Discussion",
    url: ENSO_CPC_DISCUSSION_URL,
    issued_on,
    next_update,
    alert_status,
    synopsis,
    risk_level: classifyEnsoRisk(alert_status)
  };
}

async function fetchEnsoAdvisory() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await axios.get(ENSO_CPC_DISCUSSION_URL, {
      timeout: 25000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml,*/*"
      }
    });

    const advisory = extractEnsoAdvisoryFromHtml(response.data);
    const overall = advisory ? "available" : "partial";
    return {
      advisory,
      source_status: {
        source: "NOAA CPC ENSO Diagnostic Discussion",
        endpoint: ENSO_CPC_DISCUSSION_URL,
        overall,
        http_status: response.status,
        checked_at: checkedAt,
        last_success_at: checkedAt,
        note: advisory?.alert_status || "ENSO page reached but operational status could not be parsed cleanly"
      }
    };
  } catch (err) {
    return {
      advisory: null,
      source_status: {
        source: "NOAA CPC ENSO Diagnostic Discussion",
        endpoint: ENSO_CPC_DISCUSSION_URL,
        overall: "unavailable",
        http_status: err.response?.status || null,
        checked_at: checkedAt,
        last_success_at: null,
        note: String(err.response?.status || err.code || "request_failed")
      }
    };
  }
}

function extractIcpacDateLabel(text) {
  const input = String(text || "");
  const monthPattern = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*-?\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\s*-?\s*\d{4}/i;
  const rangePattern = /\d{1,2}\s*-\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}/i;
  return (input.match(rangePattern) || input.match(monthPattern) || [null])[0];
}

function extractIcpacEntriesFromHtml(html, horizon) {
  const content = String(html || "");
  const entries = [];

  const shareRegex = /twitter\.com\/share\?url=([^"'\s<>]+)&amp;text=([^"'<>]+)/gi;
  let shareMatch;
  while ((shareMatch = shareRegex.exec(content)) !== null) {
    const url = decodeHtml(shareMatch[1]);
    const title = decodeHtml(shareMatch[2]).trim();
    if (!title) {
      continue;
    }
    entries.push({
      source: "ICPAC",
      horizon,
      title,
      url,
      date_label: extractIcpacDateLabel(title),
      risk_level: classifyIcpacRisk(title)
    });
  }

  const linkRegex = /href="([^"]+)"/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    const rawHref = decodeHtml(linkMatch[1]);
    if (!/(weekly|monthly|seasonal)-forecast\//i.test(rawHref)) {
      continue;
    }
    if (/twitter\.com|facebook\.com|sharer/i.test(rawHref)) {
      continue;
    }
    const url = absoluteIcpacUrl(rawHref);
    if (!url) {
      continue;
    }
    // Extract a date from the URL path to form a meaningful title.
    // Skip the entry entirely if no date found — generic link adds no value.
    const dateInUrl = rawHref.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{4}[-\/]\d{1,2})/);
    if (!dateInUrl) {
      continue;
    }
    const dateStr = dateInUrl[1].replace(/\//g, "-");
    const title = `ICPAC ${horizon} forecast — ${dateStr}`;
    entries.push({
      source: "ICPAC",
      horizon,
      title,
      url,
      date_label: dateStr,
      risk_level: "info"
    });
  }

  const uniq = new Map();
  entries.forEach((entry) => {
    const key = `${entry.title}|${entry.url}`;
    if (!uniq.has(key)) {
      uniq.set(key, entry);
    }
  });

  return Array.from(uniq.values()).slice(0, 40);
}

function isAfroCycloneContext(text) {
  return /africa|mozambique|madagascar|comoros|mauritius|seychelles|somalia|kenya|tanzania|ethiopia|eritrea|sudan|south\s+sudan|dr\s+congo|democratic\s+republic\s+of\s+the\s+congo|congo|burundi|rwanda|uganda|malawi|zambia|zimbabwe|angola|namibia|botswana|swio|southwest\s+indian\s+ocean|indian\s+ocean|reunion|mayotte/i.test(String(text || ""));
}

function classifyCycloneSignalRisk(text) {
  const input = String(text || "").toLowerCase();
  if (/warning|red\s+alert|severe|danger/.test(input)) {
    return "high";
  }
  if (/watch|advisory|outlook|forecast|expected/.test(input)) {
    return "watch";
  }
  return "info";
}

function extractCycloneSignalsFromHtml(html, sourceConfig) {
  const content = String(html || "");
  const plainText = stripHtmlTags(content);
  const entryMap = new Map();
  const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  const afroContextRegex = /africa|mozambique|madagascar|comoros|mauritius|seychelles|somalia|kenya|tanzania|ethiopia|eritrea|sudan|south\s+sudan|dr\s+congo|democratic\s+republic\s+of\s+the\s+congo|congo|burundi|rwanda|uganda|malawi|zambia|zimbabwe|angola|namibia|botswana|swio|southwest\s+indian\s+ocean|indian\s+ocean|reunion|mayotte/i;
  const blockedCyclocaneTitleRegex = /risk|storm\s+names|names|hurricane\s+forecast|spaghetti|national\s+hurricane\s+center|joint\s+typhoon|solitaire/i;
  const nonAfroBasinRegex = /atlantic|caribbean|gulf\s+of\s+mexico|eastern\s+pacific|western\s+pacific|central\s+pacific/i;
  const towardAfricaRegex = /moving\s+toward\s+africa|towards\s+africa|toward\s+mozambique|toward\s+madagascar|landfall\s+in\s+mozambique|landfall\s+in\s+madagascar|approaching\s+africa/i;

  while ((match = linkRegex.exec(content)) !== null) {
    const href = decodeHtml(match[1]);
    const anchorText = stripHtmlTags(decodeHtml(match[2] || ""));
    if (!anchorText || anchorText.length < 8) {
      continue;
    }

    const combined = `${anchorText} ${href}`;
    if (!isCycloneSignalText(combined)) {
      continue;
    }

    const projectionLike = isProjectionSignalText(anchorText);
    if (!projectionLike && !sourceConfig.include_non_projection) {
      continue;
    }

    const localContext = stripHtmlTags(content.slice(Math.max(0, match.index - 320), Math.min(content.length, match.index + 480)));

    if (sourceConfig.source === "Cyclocane") {
      if (blockedCyclocaneTitleRegex.test(anchorText)) {
        continue;
      }
      if (sourceConfig.require_storm_tracker && !/-storm-tracker\/?$/i.test(href)) {
        continue;
      }
      const basinContext = `${anchorText} ${localContext}`;
      if (nonAfroBasinRegex.test(basinContext)) {
        continue;
      }
      if (!afroContextRegex.test(basinContext)) {
        continue;
      }
    }

    const context = `${anchorText} ${href} ${localContext}`;
    const hasAfroContext = afroContextRegex.test(context) || isAfroCycloneContext(context);
    const movingTowardAfrica = towardAfricaRegex.test(context);
    if (sourceConfig.afro_filter && !hasAfroContext) {
      if (!movingTowardAfrica) {
        continue;
      }
    }
    if (sourceConfig.afro_filter && nonAfroBasinRegex.test(context) && !movingTowardAfrica) {
      continue;
    }

    const url = absoluteUrl(sourceConfig.url, href);
    const title = anchorText;
    const key = `${sourceConfig.source}|${title}|${url || ""}`;
    if (entryMap.has(key)) {
      continue;
    }

    const cycloneName = extractCycloneName(title);
    entryMap.set(key, {
      source: sourceConfig.source,
      source_url: sourceConfig.url,
      title,
      url,
      horizon: "advisory",
      date_label: extractIcpacDateLabel(title),
      risk_level: classifyCycloneSignalRisk(title),
      projection_like: projectionLike,
      cyclone_name: cycloneName,
      region_scope: sourceConfig.region_scope
    });
  }

  return Array.from(entryMap.values()).slice(0, 25);
}

async function fetchDedicatedCycloneSignals() {
  const sourceStatus = [];
  const allSignals = [];
  const checkedAt = new Date().toISOString();

  const calls = CYCLONE_DEDICATED_SOURCES.map(async (source) => {
    try {
      const response = await axios.get(source.url, {
        timeout: 25000,
        headers: {
          "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
          Accept: "text/html,application/xhtml+xml,*/*"
        }
      });

      const signals = extractCycloneSignalsFromHtml(response.data, source);
      allSignals.push(...signals);
      sourceStatus.push({
        source: source.source,
        url: source.url,
        region_scope: source.region_scope,
        status: "available",
        http_status: response.status,
        signal_count: signals.length,
        checked_at: checkedAt,
        last_success_at: checkedAt
      });
    } catch (err) {
      sourceStatus.push({
        source: source.source,
        url: source.url,
        region_scope: source.region_scope,
        status: "failed",
        http_status: err.response?.status || null,
        signal_count: 0,
        checked_at: checkedAt,
        last_success_at: null,
        note: String(err.response?.status || err.code || "request_failed")
      });
    }
  });

  await Promise.all(calls);

  const uniqueSignals = [];
  const seen = new Set();
  allSignals.forEach((signal) => {
    const key = `${signal.source}|${signal.title}|${signal.url || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueSignals.push(signal);
    }
  });

  const availableCount = sourceStatus.filter((s) => s.status === "available").length;
  const withSignalsCount = sourceStatus.filter((s) => (s.signal_count || 0) > 0).length;
  const overall = availableCount === 0 ? "unavailable" : availableCount === sourceStatus.length ? "available" : "partial";

  return {
    signals: uniqueSignals.slice(0, 60),
    status: {
      overall,
      checked_at: checkedAt,
      checked_count: sourceStatus.length,
      available_count: availableCount,
      with_signal_count: withSignalsCount,
      sources: sourceStatus
    }
  };
}

async function fetchIcpacForecastData(countryMap) {
  try {
    const pages = await Promise.all(
      ICPAC_SOURCE_URLS.map(async (source) => {
        const response = await axios.get(source.url, {
          timeout: 25000,
          headers: {
            "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
            Accept: "text/html,application/xhtml+xml"
          }
        });
        return extractIcpacEntriesFromHtml(response.data, source.horizon);
      })
    );

    const allEntries = pages.flat().slice(0, 80);

    const highOrWatch = allEntries.filter((e) => e.risk_level === "high" || e.risk_level === "watch");
    ICPAC_FCV_FOCUS.forEach((iso3) => {
      if (countryMap[iso3]) {
        countryMap[iso3].icpac_forecast_count = highOrWatch.length;
      }
    });

    return allEntries;
  } catch (err) {
    console.error("ICPAC fetch failed", err.message);
    return [];
  }
}

function normalize(value, min, max) {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  if (max === min) {
    return 0;
  }
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function linearProjection(series, yearsAhead = [1, 2, 3]) {
  const valid = (series || [])
    .filter((d) => d.value != null && !Number.isNaN(d.value))
    .sort((a, b) => Number(a.year) - Number(b.year));

  if (valid.length < 3) {
    return [];
  }

  const recent = valid.slice(-6);
  const x = recent.map((d) => Number(d.year));
  const y = recent.map((d) => Number(d.value));

  const xMean = x.reduce((a, b) => a + b, 0) / x.length;
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;
  let num = 0;
  let den = 0;

  for (let i = 0; i < x.length; i += 1) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }

  if (den === 0) {
    return [];
  }

  const slope = num / den;
  const intercept = yMean - slope * xMean;
  const lastYear = x[x.length - 1];

  return yearsAhead.map((n) => {
    const year = lastYear + n;
    const projected = slope * year + intercept;
    return {
      year,
      value: Math.max(0, Number(projected.toFixed(2))),
      method: "linear-trend",
      based_on_points: recent.length
    };
  });
}

function projectLinearAtYear(series, targetYear) {
  const valid = (series || [])
    .filter((d) => d.value != null && !Number.isNaN(d.value))
    .sort((a, b) => Number(a.year) - Number(b.year));

  if (valid.length < 3) {
    return null;
  }

  const recent = valid.slice(-6);
  const x = recent.map((d) => Number(d.year));
  const y = recent.map((d) => Number(d.value));
  const xMean = x.reduce((a, b) => a + b, 0) / x.length;
  const yMean = y.reduce((a, b) => a + b, 0) / y.length;

  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i += 1) {
    num += (x[i] - xMean) * (y[i] - yMean);
    den += (x[i] - xMean) ** 2;
  }

  if (den === 0) {
    return null;
  }

  const slope = num / den;
  const intercept = yMean - slope * xMean;
  return Math.max(0, slope * Number(targetYear) + intercept);
}

function projectionBacktest(series) {
  const valid = (series || [])
    .filter((d) => d.value != null && !Number.isNaN(d.value) && d.year != null)
    .sort((a, b) => Number(a.year) - Number(b.year));

  if (valid.length < 5) {
    return null;
  }

  const errors = [];
  for (let i = 3; i < valid.length; i += 1) {
    const train = valid.slice(0, i);
    const actual = Number(valid[i].value);
    const targetYear = Number(valid[i].year);
    const predicted = projectLinearAtYear(train, targetYear);

    if (predicted == null || Number.isNaN(actual)) {
      continue;
    }

    const err = predicted - actual;
    errors.push({
      year: targetYear,
      actual,
      predicted: Number(predicted.toFixed(2)),
      error: Number(err.toFixed(2))
    });
  }

  if (!errors.length) {
    return null;
  }

  const mae = errors.reduce((sum, e) => sum + Math.abs(e.error), 0) / errors.length;
  const rmse = Math.sqrt(errors.reduce((sum, e) => sum + (e.error ** 2), 0) / errors.length);
  const mapeDen = errors.filter((e) => e.actual !== 0);
  const mape = mapeDen.length
    ? (mapeDen.reduce((sum, e) => sum + Math.abs(e.error / e.actual), 0) / mapeDen.length) * 100
    : null;

  return {
    method: "rolling-one-step-linear",
    samples: errors.length,
    mae: Number(mae.toFixed(2)),
    rmse: Number(rmse.toFixed(2)),
    mape_pct: mape == null ? null : Number(mape.toFixed(1)),
    last_test_year: errors[errors.length - 1].year
  };
}

async function fetchWorldBankIndicator(indicatorCode) {
  const iso3List = FCV_COUNTRIES.map((c) => c.iso3).join(";");
  const url = `https://api.worldbank.org/v2/country/${iso3List}/indicator/${indicatorCode}`;
  const params = {
    format: "json",
    per_page: 20000
  };

  try {
    const response = await axios.get(url, { params, timeout: 20000 });
    if (!Array.isArray(response.data) || response.data.length < 2) {
      return [];
    }
    return response.data[1] || [];
  } catch (err) {
    console.error(`World Bank fetch failed for ${indicatorCode}:`, err.message);
    const offlinePath = path.join(DATA_DIR, "worldbank", `${indicatorCode}.json`);
    if (fs.existsSync(offlinePath)) {
      try {
        const offline = JSON.parse(fs.readFileSync(offlinePath, "utf8"));
        console.log(`World Bank ${indicatorCode}: using offline fallback data`);
        return Array.isArray(offline) ? offline : [];
      } catch (offErr) {
        console.error(`World Bank offline load failed for ${indicatorCode}:`, offErr.message);
      }
    }
    throw err;
  }
}

async function fetchNutritionData(countryMap, freshnessMode = "strict") {
  const status = {
    source: "World Bank API",
    mode: freshnessMode,
    overall: "available",
    error_count: 0,
    indicators: {},
    coverage: {}
  };

  for (const indicator of INDICATORS) {
    try {
      const rows = await fetchWorldBankIndicator(indicator.code);
      const grouped = {};

      rows.forEach((row) => {
        const iso3 = row?.countryiso3code;
        if (!iso3 || !countryMap[iso3]) {
          return;
        }
        if (!grouped[iso3]) {
          grouped[iso3] = [];
        }
        grouped[iso3].push({
          year: Number(row.date),
          value: row.value == null ? null : Number(row.value)
        });
      });

      Object.keys(grouped).forEach((iso3) => {
        const series = grouped[iso3]
          .filter((x) => x.year && x.value != null)
          .sort((a, b) => a.year - b.year);

        const latestAny = [...series].reverse().find((x) => x.value != null);
        const latestFresh = latestAny && isNutritionYearFresh(latestAny.year) ? latestAny : null;
        // In lenient mode, fall back to the most recent available value even if stale.
        const latestDisplay = freshnessMode === "lenient" ? (latestFresh || latestAny || null) : latestFresh;
        const isStaleWarning = freshnessMode === "lenient" && !!latestAny && !latestFresh;

        countryMap[iso3].indicators[indicator.key] = {
          label: indicator.label,
          series,
          latest: latestDisplay,
          latest_any: latestAny || null,
          excluded_as_stale: !!latestAny && !latestFresh,
          stale_warning: isStaleWarning,
          backtest: projectionBacktest(series)
        };
        countryMap[iso3].projections[indicator.key] = latestDisplay ? linearProjection(series, [1, 2, 3]) : [];
      });

      status.indicators[indicator.key] = {
        code: indicator.code,
        rows_fetched: rows.length,
        fcv_with_any_data: Object.keys(grouped).length,
        success: true
      };
    } catch (err) {
      console.error(`World Bank indicator failed: ${indicator.code}`, err.message);
      status.error_count += 1;
      status.indicators[indicator.key] = {
        code: indicator.code,
        rows_fetched: 0,
        fcv_with_any_data: 0,
        success: false,
        error: err.message
      };
    }
  }

  INDICATORS.forEach((indicator) => {
    const latestAny = Object.values(countryMap).filter((c) => c.indicators?.[indicator.key]?.latest_any != null).length;
    const latestDisplay = Object.values(countryMap).filter((c) => c.indicators?.[indicator.key]?.latest != null).length;
    status.coverage[indicator.key] = {
      latest_any: latestAny,
      latest_display: latestDisplay
    };
  });

  if (status.error_count >= INDICATORS.length) {
    status.overall = "unavailable";
  } else if (status.error_count > 0) {
    status.overall = "partial";
  }

  return status;
}

function refreshNutritionCoverage(status, countryMap) {
  if (!status?.coverage) {
    return status;
  }
  INDICATORS.forEach((indicator) => {
    const latestAny = Object.values(countryMap).filter((c) => c.indicators?.[indicator.key]?.latest_any != null).length;
    const latestDisplay = Object.values(countryMap).filter((c) => c.indicators?.[indicator.key]?.latest != null).length;
    status.coverage[indicator.key] = {
      latest_any: latestAny,
      latest_display: latestDisplay
    };
  });
  return status;
}

function yearFromIsoOrNow(value) {
  const dt = value ? new Date(value) : null;
  const y = dt && !Number.isNaN(dt.getTime()) ? dt.getUTCFullYear() : currentYearUtc();
  return Number(y);
}

function weightedMean(values) {
  const valid = values.filter((v) => v && v.weight > 0 && v.value != null && !Number.isNaN(v.value));
  if (!valid.length) {
    return null;
  }
  const totalWeight = valid.reduce((s, x) => s + x.weight, 0);
  if (totalWeight <= 0) {
    return null;
  }
  return valid.reduce((s, x) => s + (x.value * x.weight), 0) / totalWeight;
}

function parseHdxGamProxyFromWorkbook(buffer, iso3, updatedAt) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const year = yearFromIsoOrNow(updatedAt);

  // Nigeria structure: row 3 has combined GAM percent at col 3 and child totals at col 2.
  if (iso3 === "NGA") {
    const weighted = [];
    rows.slice(3).forEach((r) => {
      const totalChildren = Number(r?.[2]);
      const gamPct = Number(r?.[3]);
      if (!Number.isNaN(totalChildren) && !Number.isNaN(gamPct) && totalChildren > 0 && gamPct >= 0 && gamPct <= 1) {
        weighted.push({ weight: totalChildren, value: gamPct * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_gam_percent_weighted" };
  }

  // Chad structure: Province, Population 6-59 mois, MAG. Compute weighted MAG rate.
  if (iso3 === "TCD") {
    const weighted = [];
    rows.slice(1).forEach((r) => {
      const pop = Number(r?.[1]);
      const magCases = Number(r?.[4]);
      if (!Number.isNaN(pop) && !Number.isNaN(magCases) && pop > 0 && magCases >= 0) {
        weighted.push({ weight: pop, value: (magCases / pop) * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_mag_cases_over_pop" };
  }

  // South Sudan structure: State, SAM, MAM, Total, Percent (as decimal).
  if (iso3 === "SSD") {
    const weighted = [];
    rows.slice(1).forEach((r) => {
      const totalCases = Number(r?.[3]);
      const pct = Number(r?.[4]);
      if (!Number.isNaN(totalCases) && !Number.isNaN(pct) && totalCases > 0 && pct >= 0 && pct <= 1) {
        weighted.push({ weight: totalCases, value: pct * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_percent_column_weighted" };
  }

  // DRC structure: filles/garcons populations + GAM counts; compute weighted GAM rate.
  if (iso3 === "COD") {
    const weighted = [];
    rows.slice(3).forEach((r) => {
      const popGirls = Number(r?.[2]);
      const popBoys = Number(r?.[3]);
      const gamGirls = Number(r?.[4]);
      const gamBoys = Number(r?.[5]);
      const pop = (Number.isNaN(popGirls) ? 0 : popGirls) + (Number.isNaN(popBoys) ? 0 : popBoys);
      const gam = (Number.isNaN(gamGirls) ? 0 : gamGirls) + (Number.isNaN(gamBoys) ? 0 : gamBoys);
      if (pop > 0 && gam >= 0) {
        weighted.push({ weight: pop, value: (gam / pop) * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_gam_cases_over_pop" };
  }

  // CAR structure: use %MAM + %MAS weighted by children 6-59m population.
  if (iso3 === "CAF") {
    const weighted = [];
    rows.slice(1).forEach((r) => {
      const childPop = Number(r?.[2]);
      const mamPct = Number(r?.[4]);
      const masPct = Number(r?.[5]);
      const gamPct = (!Number.isNaN(mamPct) && !Number.isNaN(masPct)) ? (mamPct + masPct) : Number.NaN;
      if (!Number.isNaN(childPop) && !Number.isNaN(gamPct) && childPop > 0 && gamPct >= 0 && gamPct <= 1) {
        weighted.push({ weight: childPop, value: gamPct * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_mam_plus_mas_percent_weighted" };
  }

  // Mali structure: population under 5 and GAM count by region.
  if (iso3 === "MLI") {
    const weighted = [];
    rows.slice(3).forEach((r) => {
      const pop = Number(r?.[1]);
      const gamCases = Number(r?.[2]);
      if (!Number.isNaN(pop) && !Number.isNaN(gamCases) && pop > 0 && gamCases >= 0) {
        weighted.push({ weight: pop, value: (gamCases / pop) * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_gam_cases_over_pop" };
  }

  // Mozambique structure: DA% already supplied; weight by U5 (6-59m) population.
  if (iso3 === "MOZ") {
    const weighted = [];
    rows.slice(2).forEach((r) => {
      const u5 = Number(r?.[4]);
      const daPct = Number(r?.[6]);
      if (!Number.isNaN(u5) && !Number.isNaN(daPct) && u5 > 0 && daPct >= 0 && daPct <= 1) {
        weighted.push({ weight: u5, value: daPct * 100 });
      }
    });
    const mean = weightedMean(weighted);
    return mean == null ? null : { year, value: Number(mean.toFixed(2)), method: "hdx_da_percent_weighted" };
  }

  return null;
}

async function fetchHdxAcuteMalnutritionFallback(countryMap, freshnessMode = "strict") {
  const status = {
    source: "HDX acute malnutrition packages",
    mode: freshnessMode,
    overall: "available",
    pilot_country_count: Object.keys(HDX_ACUTE_MALNUTRITION_URLS).length,
    applied_country_count: 0,
    countries: {},
    pulled_at: new Date().toISOString()
  };

  const tasks = Object.entries(HDX_ACUTE_MALNUTRITION_URLS).map(async ([iso3, url]) => {
    try {
      const response = await axios.get(url, {
        timeout: 30000,
        responseType: "arraybuffer",
        headers: {
          "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
          Accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*"
        }
      });

      const updatedAt = response.headers?.["last-modified"] || status.pulled_at;
      const parsed = parseHdxGamProxyFromWorkbook(response.data, iso3, updatedAt);
      if (!parsed) {
        status.countries[iso3] = { success: false, reason: "parse_failed" };
        return;
      }

      if (!countryMap[iso3].indicators.wasting_u5_pct) {
        countryMap[iso3].indicators.wasting_u5_pct = {
          label: "Child Wasting (%)",
          series: [],
          latest: null,
          latest_any: null,
          excluded_as_stale: false,
          stale_warning: false,
          backtest: null
        };
      }

      const ind = countryMap[iso3].indicators.wasting_u5_pct;
      const wbFresh = ind.latest;
      const wbAny = ind.latest_any;
      const shouldApplyFallback = !wbFresh || (!!wbAny && !isNutritionYearFresh(wbAny.year));

      ind.hdx_proxy = {
        source: "HDX acute malnutrition",
        value: parsed.value,
        year: parsed.year,
        method: parsed.method,
        updated_at: updatedAt
      };

      if (shouldApplyFallback) {
        ind.latest = {
          value: parsed.value,
          year: parsed.year,
          source: "HDX acute malnutrition proxy",
          method: parsed.method
        };
        if (!ind.latest_any || parsed.year >= Number(ind.latest_any.year || 0)) {
          ind.latest_any = {
            value: parsed.value,
            year: parsed.year,
            source: "HDX acute malnutrition proxy",
            method: parsed.method
          };
        }
        ind.stale_warning = false;
        ind.excluded_as_stale = false;
        status.applied_country_count += 1;
      }

      status.countries[iso3] = {
        success: true,
        proxy_value: parsed.value,
        proxy_year: parsed.year,
        applied_as_latest: shouldApplyFallback
      };
    } catch (err) {
      const offlinePath = path.join(DATA_DIR, "nutrition", `${iso3}.xlsx`);
      if (fs.existsSync(offlinePath)) {
        try {
          const buffer = fs.readFileSync(offlinePath);
          const parsed = parseHdxGamProxyFromWorkbook(buffer, iso3, new Date().toISOString());
          if (parsed) {
            if (!countryMap[iso3].indicators.wasting_u5_pct) {
              countryMap[iso3].indicators.wasting_u5_pct = {
                label: "Child Wasting (%)",
                series: [],
                latest: null,
                latest_any: null,
                excluded_as_stale: false,
                stale_warning: false,
                backtest: null
              };
            }
            const ind = countryMap[iso3].indicators.wasting_u5_pct;
            const wbFresh = ind.latest;
            const wbAny = ind.latest_any;
            const shouldApplyFallback = !wbFresh || (!!wbAny && !isNutritionYearFresh(wbAny.year));
            ind.hdx_proxy = { source: "HDX acute malnutrition (offline)", value: parsed.value, year: parsed.year, method: parsed.method, updated_at: new Date().toISOString() };
            if (shouldApplyFallback) {
              ind.latest = { value: parsed.value, year: parsed.year, source: "HDX acute malnutrition proxy (offline)", method: parsed.method };
              if (!ind.latest_any || parsed.year >= Number(ind.latest_any.year || 0)) {
                ind.latest_any = { value: parsed.value, year: parsed.year, source: "HDX acute malnutrition proxy (offline)", method: parsed.method };
              }
              ind.stale_warning = false;
              ind.excluded_as_stale = false;
              status.applied_country_count += 1;
            }
            status.countries[iso3] = { success: true, proxy_value: parsed.value, proxy_year: parsed.year, applied_as_latest: shouldApplyFallback };
            console.log(`Nutrition ${iso3}: using offline fallback data`);
          } else {
            status.countries[iso3] = { success: false, reason: "offline_parse_failed" };
          }
        } catch (offErr) {
          console.error(`Nutrition offline load failed for ${iso3}:`, offErr.message);
          status.countries[iso3] = { success: false, reason: "offline_load_failed" };
        }
      } else {
        status.countries[iso3] = {
          success: false,
          reason: err.response?.status || err.code || "request_failed"
        };
      }
    }
  });

  await Promise.all(tasks);

  if (!Object.values(status.countries).some((x) => x.success)) {
    status.overall = "unavailable";
  }

  return status;
}

function countCountryMentions(text, country) {
  const base = normalizeForMentionMatch(text || "");
  return country.aliases.some((alias) => {
    const escaped = normalizeForMentionMatch(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Prevent "Niger Delta" / "Niger River" (Nigeria regions) from matching Niger (NER)
    const lookahead = escaped.toLowerCase() === "niger" ? "(?!\\s+(?:delta|river))" : "";
    // Prevent "Papua New Guinea" / "Equatorial Guinea" / "Guinea-Bissau"
    // from being misclassified as Guinea (GIN).
    if (escaped.toLowerCase() === "guinea") {
      const sanitized = base
        .replace(/\bpapua\s+new\s+guinea\b/gi, " ")
        .replace(/\bequatorial\s+guinea\b/gi, " ")
        .replace(/\bguinea\s+bissau\b/gi, " ");
      return /\bguinea\b/i.test(sanitized);
    }
    const regex = new RegExp(`\\b${escaped}${lookahead}\\b`, "i");
    return regex.test(base);
  });
}

function normalizeForMentionMatch(text) {
  return String(text || "")
    .replace(/[()\[\]{}.,;:!?/\\|"'`_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeStrings(values = []) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function extractGeoLabelsFromText(text, labels = CYCLONE_GEO_LABELS) {
  const input = String(text || "");
  return dedupeStrings(labels.filter((label) => {
    const rx = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`, "i");
    return rx.test(input);
  }));
}

function parseGdacsExposedCountries(text) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  const match = compact.match(/Exposed countries\s+(.+?)\s+Exposed population/i);
  if (!match || !match[1]) {
    return [];
  }
  return dedupeStrings(match[1].split(/\s*,\s*/));
}

async function enrichGdacsCycloneEvent(event, countryMap) {
  if (!event || event.hazard_type !== "Cyclone" || !event.link) {
    return event;
  }

  const fallbackText = `${event.title || ""} ${event.summary || ""}`;
  const fallbackGeo = dedupeStrings(event.geo_labels || extractGeoLabelsFromText(fallbackText));
  const fallbackAfro = isAfroCycloneContext(fallbackText);

  try {
    const response = await axios.get(event.link, {
      timeout: 12000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml,*/*"
      }
    });
    const pageText = stripHtmlTags(response.data).replace(/\s+/g, " ").trim();
    const exposedCountries = parseGdacsExposedCountries(pageText);
    const geoLabels = dedupeStrings(exposedCountries.length ? exposedCountries : [...fallbackGeo, ...extractGeoLabelsFromText(pageText)]);
    const mappedCountries = FCV_COUNTRIES
      .filter((country) => countCountryMentions(geoLabels.join(" "), country))
      .map((country) => country.iso3);

    const afroContext = isAfroCycloneContext(`${pageText} ${geoLabels.join(" ")}`) || fallbackAfro;

    return {
      ...event,
      countries: dedupeStrings([...(event.countries || []), ...mappedCountries]),
      geo_labels: geoLabels,
      afro_context: afroContext,
      exposed_countries: exposedCountries
    };
  } catch (err) {
    return {
      ...event,
      geo_labels: fallbackGeo,
      afro_context: fallbackAfro
    };
  }
}

async function fetchGdacsData(countryMap) {
  let feedItems = [];
  try {
    const feed = await parser.parseURL("https://www.gdacs.org/xml/rss.xml");
    feedItems = feed.items || [];
  } catch (err) {
    console.error("GDACS fetch failed", err.message);
    const offlinePath = path.join(DATA_DIR, "feeds", "gdacs.json");
    if (fs.existsSync(offlinePath)) {
      try {
        feedItems = JSON.parse(fs.readFileSync(offlinePath, "utf8")).items || [];
        console.log("GDACS: using offline fallback data");
      } catch (offErr) {
        console.error("GDACS offline load failed:", offErr.message);
      }
    }
  }

  const events = feedItems.slice(0, 120).flatMap((item) => {
    const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`;
    // Exclude events with no African context — drop Cuba, Philippines, Indonesia, etc.
    if (!AFRO_CONTEXT_REGEX.test(combinedText) && !isAfroCycloneContext(combinedText)) {
      return [];
    }
    const matchedCountries = FCV_COUNTRIES.filter((c) => countCountryMentions(combinedText, c)).map((c) => c.iso3);
    const isCyclone = /cyclone|tropical cyclone|hurricane|typhoon/i.test(combinedText);
    const isFlood = /\bflood\b|flooding|flash\s+flood|river\s+flood|inundation|overflow|heavy\s+rain/i.test(combinedText);

    matchedCountries.forEach((iso3) => {
      countryMap[iso3].hazard_count += 1;
      if (isCyclone) {
        countryMap[iso3].cyclone_count += 1;
      }
      if (isFlood) {
        countryMap[iso3].flood_count += 1;
      }
    });

    return [{
      title: item.title,
      summary: item.contentSnippet || null,
      pubDate: item.pubDate,
      link: item.link,
      source: "GDACS",
      countries: matchedCountries,
      geo_labels: matchedCountries.map((iso3) => countryMap[iso3]?.country || iso3),
      afro_context: isCyclone ? isAfroCycloneContext(combinedText) : null,
      linkage_scope: matchedCountries.length ? "afro-linked" : "afro-regional",
      hazard_type: isCyclone ? "Cyclone" : isFlood ? "Flood" : "Other"
    }];
  });

  const cycloneEvents = events.filter((event) => event.hazard_type === "Cyclone" && event.link).slice(0, 10);
  const enrichedCyclones = await Promise.all(cycloneEvents.map((event) => enrichGdacsCycloneEvent(event, countryMap)));
  const enrichedByKey = new Map(enrichedCyclones.map((event) => [`${event.link}|${event.title}`, event]));

  const mergedEvents = events.map((event) => {
    const key = `${event.link}|${event.title}`;
    const enriched = enrichedByKey.get(key);
    if (!enriched) {
      return event;
    }

    const originalCountries = new Set(event.countries || []);
    (enriched.countries || []).forEach((iso3) => {
      if (!originalCountries.has(iso3) && countryMap[iso3]) {
        countryMap[iso3].hazard_count += 1;
        countryMap[iso3].cyclone_count += 1;
      }
    });

    return {
      ...event,
      ...enriched,
      linkage_scope: (enriched.countries || []).length ? "afro-linked" : "afro-regional"
    };
  });

  return mergedEvents.slice(0, 80);
}

function readReliefWebRssCache() {
  try {
    if (!fs.existsSync(RELIEFWEB_RSS_CACHE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(RELIEFWEB_RSS_CACHE_FILE, "utf8"));
    return raw && raw.saved_at && Array.isArray(raw.items) ? raw : null;
  } catch (e) { return null; }
}

function writeReliefWebRssCache(items) {
  try {
    fs.writeFileSync(RELIEFWEB_RSS_CACHE_FILE, JSON.stringify({ saved_at: new Date().toISOString(), items }, null, 2), "utf8");
  } catch (e) { console.error("[ReliefWeb RSS] Cache write failed:", e.message); }
}

function isReliefWebRssCacheFresh(snapshot) {
  if (!snapshot?.saved_at) return false;
  const ageHours = (Date.now() - new Date(snapshot.saved_at).getTime()) / 3600000;
  return ageHours < RELIEFWEB_RSS_CACHE_TTL_HOURS;
}

async function fetchReliefWebData(countryMap) {
  const dedupeFloodSignals = (items = []) => {
    const seen = new Set();
    const deduped = [];
    items.forEach((item) => {
      const key = `${item.link || ""}|${item.title || ""}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(item);
      }
    });
    return deduped;
  };

  const buildReliefWebApiStatus = (overrides = {}) => ({
    checked_at: new Date().toISOString(),
    appname_configured: Boolean(RELIEFWEB_APPNAME),
    overall: RELIEFWEB_APPNAME ? "configured_no_matches" : "disabled",
    reports_returned: 0,
    matching_signals: 0,
    dropped_scope_filtered: 0,
    dropped_unmapped_country: 0,
    dropped_duplicate: 0,
    error: null,
    ...overrides
  });

  const fetchReliefWebAfricaFloodApiSignals = async () => {
    if (!RELIEFWEB_APPNAME) {
      return {
        signals: [],
        status: buildReliefWebApiStatus({ overall: "disabled" })
      };
    }
    try {
      const toDate = new Date();
      const fromDate = new Date(Date.now() - (EVENT_SIGNAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
      const payload = {
        query: {
          value: "flood OR flooding OR flash flood OR inundation OR overflow OR heavy rain"
        },
        sort: ["date.created:desc"],
        limit: 120,
        fields: {
          include: ["title", "date.created", "url_alias", "source.name", "country.name", "primary_country.name", "body", "body-html"]
        }
      };

      const resp = await axios.post(`${RELIEFWEB_REPORTS_API_URL}?appname=${encodeURIComponent(RELIEFWEB_APPNAME)}`, payload, {
        timeout: 20000,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      });

      const rows = resp?.data?.data || [];
      let droppedScopeFiltered = 0;
      let droppedUnmappedCountry = 0;
      const signals = rows.map((row) => {
        const f = row.fields || {};
        const title = String(f.title || "").trim();
        const summary = String(f.summary || f.body || f["body-html"] || "").replace(/<[^>]+>/g, " ").trim();
        const created = f.date?.created ? new Date(f.date.created) : null;
        const combined = `${title} ${summary}`;
        if (!title || !created || Number.isNaN(created.getTime()) || created < fromDate || created > toDate || !FLOOD_KEYWORD_REGEX.test(combined)) {
          return null;
        }
        if (!AFRO_CONTEXT_REGEX.test(combined)) {
          droppedScopeFiltered += 1;
          return null;
        }

        const countryFieldNames = dedupeStrings([
          ...(Array.isArray(f.country) ? f.country.map((entry) => (typeof entry === "string" ? entry : entry?.name)) : []),
          (typeof f.primary_country === "string" ? f.primary_country : f.primary_country?.name)
        ]);
        const primaryCountryName = typeof f.primary_country === "string" ? f.primary_country : f.primary_country?.name;

        const aliasToIso3 = new Map();
        FCV_COUNTRIES.forEach((country) => {
          (country.aliases || []).forEach((alias) => {
            const key = normalizeForMentionMatch(alias).toLowerCase();
            if (key && !aliasToIso3.has(key)) {
              aliasToIso3.set(key, country.iso3);
            }
          });
        });

        let matchedIso3 = dedupeStrings(countryFieldNames
          .map((name) => aliasToIso3.get(normalizeForMentionMatch(name).toLowerCase()))
          .filter(Boolean));

        const primaryIso3 = primaryCountryName
          ? aliasToIso3.get(normalizeForMentionMatch(primaryCountryName).toLowerCase())
          : null;

        if (primaryCountryName && !primaryIso3) {
          droppedScopeFiltered += 1;
          return null;
        }

        if (!primaryCountryName) {
          const titleIso3 = FCV_COUNTRIES
            .filter((c) => countCountryMentions(title, c))
            .map((c) => c.iso3);
          if (titleIso3.length) {
            const overlap = matchedIso3.filter((iso3) => titleIso3.includes(iso3));
            matchedIso3 = overlap.length ? overlap : titleIso3;
          }
        } else if (primaryIso3) {
          matchedIso3 = dedupeStrings([primaryIso3, ...matchedIso3]);
        }

        // Keep only Africa-scope events with an explicit mapped monitored country.
        if (!matchedIso3.length) {
          droppedUnmappedCountry += 1;
          return null;
        }

        const urlAlias = String(f.url_alias || "").trim();
        const link = urlAlias ? (urlAlias.startsWith("http") ? urlAlias : `https://reliefweb.int${urlAlias}`) : null;

        return {
          title,
          summary: summary || null,
          pubDate: f.date?.created || null,
          link,
          source: "ReliefWeb API",
          countries: matchedIso3,
          hazard_type: "Flood",
          linkage_scope: "afro-linked"
        };
      }).filter(Boolean);

      const dedupedSignals = dedupeFloodSignals(signals).slice(0, 80);
      const droppedDuplicate = Math.max(0, signals.length - dedupedSignals.length);
      return {
        signals: dedupedSignals,
        status: buildReliefWebApiStatus({
          overall: dedupedSignals.length > 0 ? "active" : "configured_no_matches",
          reports_returned: rows.length,
          matching_signals: dedupedSignals.length,
          dropped_scope_filtered: droppedScopeFiltered,
          dropped_unmapped_country: droppedUnmappedCountry,
          dropped_duplicate: droppedDuplicate
        })
      };
    } catch (err) {
      console.warn("ReliefWeb API flood fetch failed", err.message);
      return {
        signals: [],
        status: buildReliefWebApiStatus({
          overall: "error",
          error: err.message || "reliefweb_api_request_failed"
        })
      };
    }
  };

  if (!reliefwebRssSnapshot) {
    reliefwebRssSnapshot = readReliefWebRssCache();
  }

  let feedItems = [];
  let rssFromCache = false;
  try {
    const feed = await parser.parseURL(RELIEFWEB_UPDATES_RSS_URL);
    const liveItems = feed.items || [];
    if (liveItems.length > 0) {
      feedItems = liveItems;
      reliefwebRssSnapshot = { saved_at: new Date().toISOString(), items: liveItems };
      writeReliefWebRssCache(reliefwebRssSnapshot);
    } else if (reliefwebRssSnapshot?.items?.length) {
      feedItems = reliefwebRssSnapshot.items;
      rssFromCache = true;
      console.log("[ReliefWeb RSS] Live feed returned 0 items — using cached batch");
    }
  } catch (err) {
    console.error("[ReliefWeb RSS] Fetch failed:", err.message);
    if (reliefwebRssSnapshot?.items?.length) {
      feedItems = reliefwebRssSnapshot.items;
      rssFromCache = true;
      console.log("[ReliefWeb RSS] Using cached batch as fallback");
    }
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const regionalFloodSignals = [];
  const reports = feedItems.slice(0, 200).map((item) => {
    const categoryNames = Array.isArray(item.categories)
      ? item.categories.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""} ${categoryNames.join(" ")}`;
    const textMatchedIso3 = FCV_COUNTRIES
      .filter((c) => countCountryMentions(combinedText, c))
      .map((c) => c.iso3);
    const categoryMatchedIso3 = categoryNames
      .map((name) => findFcvIso3FromCountryName(name))
      .filter(Boolean);
    const fcvIso3 = dedupeStrings([...textMatchedIso3, ...categoryMatchedIso3]);

    const created = item.pubDate ? new Date(item.pubDate) : null;
    const ageDays = created ? Math.floor((now - created) / dayMs) : null;
    const in30Days = ageDays != null && ageDays <= 30;
    const inLookbackDays = ageDays != null && ageDays <= EVENT_SIGNAL_LOOKBACK_DAYS;
    const floodLike = FLOOD_KEYWORD_REGEX.test(combinedText);
    const afroLike = AFRO_CONTEXT_REGEX.test(combinedText);

    if (in30Days) {
      fcvIso3.forEach((iso3) => {
        countryMap[iso3].report_count_30d += 1;
      });
    }

    if (inLookbackDays && floodLike && afroLike) {
      regionalFloodSignals.push({
        title: item.title || "Untitled flood update",
        summary: item.contentSnippet || null,
        pubDate: item.pubDate || null,
        link: item.link || null,
        source: "ReliefWeb RSS",
        countries: fcvIso3,
        hazard_type: "Flood",
        linkage_scope: fcvIso3.length ? "fcv-linked" : "afro-regional"
      });
    }

    return {
      id: item.guid || item.link || item.title,
      title: item.title || "Untitled",
      summary: item.contentSnippet || null,
      content: item.content || null,
      source: "ReliefWeb RSS",
      creator: item.creator || null,
      categories: item.categories || [],
      created: item.pubDate || null,
      url: item.link || null,
      countries: fcvIso3,
      in30Days,
      inLookbackDays
    };
  });

  const apiFloodBundle = await fetchReliefWebAfricaFloodApiSignals();
  const apiFloodSignals = apiFloodBundle.signals || [];
  
  // Increment country flood_count for ReliefWeb API signals (matching GDACS pattern)
  apiFloodSignals.forEach((signal) => {
    if (signal.countries && signal.countries.length > 0) {
      signal.countries.forEach((iso3) => {
        if (countryMap[iso3]) {
          countryMap[iso3].flood_count += 1;
        }
      });
    }
  });
  
  const mergedRegionalFloodSignals = dedupeFloodSignals([...regionalFloodSignals, ...apiFloodSignals]).slice(0, 80);
  const mergedApiSignalCount = mergedRegionalFloodSignals.filter((item) => String(item.source || "") === "ReliefWeb API").length;
  const reliefWebApiStatus = {
    ...(apiFloodBundle.status || buildReliefWebApiStatus()),
    matching_signals: mergedApiSignalCount
  };

  if (reliefWebApiStatus.overall !== "error") {
    reliefWebApiStatus.overall = mergedApiSignalCount > 0
      ? "active"
      : (RELIEFWEB_APPNAME ? "configured_no_matches" : "disabled");
  }

  return {
    reports: reports.filter((r) => r.countries.length > 0).slice(0, 60),
    regional_flood_signals: mergedRegionalFloodSignals,
    api_status: reliefWebApiStatus,
    flood_signal_window_days: EVENT_SIGNAL_LOOKBACK_DAYS
  };
}

function extractDiseaseLabel(text) {
  const input = String(text || "");
  if (/cholera/i.test(input)) return "Cholera";
  if (/meningitis/i.test(input)) return "Meningitis";
  if (/measles/i.test(input)) return "Measles";
  if (/ebola/i.test(input)) return "Ebola";
  if (/marburg/i.test(input)) return "Marburg";
  if (/yellow\s+fever/i.test(input)) return "Yellow fever";
  if (/dengue/i.test(input)) return "Dengue";
  if (/mpox|monkeypox/i.test(input)) return "Mpox";
  if (/polio/i.test(input)) return "Polio";
  if (/avian\s+influenza|h5n1/i.test(input)) return "Avian influenza";
  if (/lassa\s+fever/i.test(input)) return "Lassa fever";
  if (/rift\s+valley\s+fever/i.test(input)) return "Rift Valley fever";
  return "Disease outbreak";
}

function parseWhoDonDate(text) {
  const match = String(text || "").match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  if (!match) {
    return null;
  }
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function fetchWhoDonOutbreakReports(countryMap) {
  const status = {
    source: "WHO DON RSS",
    endpoint: WHO_DON_RSS_URL,
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    total_items_scanned: 0,
    fcv_items_30d: 0,
    mapped_countries: 0,
    error: null
  };

  let feedItems = [];
  let sourceLabel = "WHO DON RSS";
  try {
    const feed = await parser.parseURL(WHO_DON_RSS_URL);
    feedItems = feed.items || [];
  } catch (err) {
    try {
      const response = await axios.get(WHO_DON_PAGE_URL, {
        timeout: 20000,
        headers: {
          "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        }
      });
      const $ = cheerio.load(String(response.data || ""));
      const parsedItems = [];
      const seen = new Set();
      $("a[href*='/emergencies/disease-outbreak-news/item/']").each((_, el) => {
        const href = $(el).attr("href");
        const url = absoluteUrl(WHO_DON_PAGE_URL, href);
        const title = stripHtmlTags($(el).text() || "").trim();
        const context = stripHtmlTags($(el).closest("article, li, div").text() || "");
        if (!url || !title || title.length < 8) {
          return;
        }
        const key = `${title}|${url}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        parsedItems.push({
          guid: key,
          link: url,
          title,
          contentSnippet: context || null,
          content: context || null,
          pubDate: parseWhoDonDate(context) || parseWhoDonDate(title)
        });
      });

      if (!parsedItems.length) {
        const plain = stripHtmlTags(String(response.data || ""));
        const titleRegex = /(\d{1,2}\s+[A-Za-z]+\s+\d{4}\s*\|\s*[^|]{12,220})/g;
        const seenTitles = new Set();
        let titleMatch;
        while ((titleMatch = titleRegex.exec(plain)) !== null) {
          const raw = String(titleMatch[1] || "").replace(/\s+/g, " ").trim();
          if (!raw || seenTitles.has(raw)) {
            continue;
          }
          seenTitles.add(raw);
          const parts = raw.split("|");
          const datePart = (parts[0] || "").trim();
          const titlePart = parts.slice(1).join("|").trim();
          if (!titlePart || titlePart.length < 8) {
            continue;
          }
          parsedItems.push({
            guid: `who-don-text-${seenTitles.size}`,
            link: null,
            title: titlePart,
            contentSnippet: raw,
            content: raw,
            pubDate: parseWhoDonDate(datePart)
          });
        }
      }

      feedItems = parsedItems;
      sourceLabel = "WHO DON page";
      status.source = sourceLabel;
      status.endpoint = WHO_DON_PAGE_URL;
    } catch (fallbackErr) {
      status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}; fallback_failed: ${fallbackErr.response?.status || fallbackErr.code || "request_failed"}: ${fallbackErr.message}`;
      return { items: [], status };
    }
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const mappedCountrySet = new Set();
  const items = feedItems
    .slice(0, 220)
    .map((item) => {
      const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`;
      const fcvIso3 = FCV_COUNTRIES
        .filter((c) => countCountryMentions(combinedText, c))
        .map((c) => c.iso3);

      const created = item.pubDate ? new Date(item.pubDate) : null;
      const ageDays = created ? Math.floor((now - created) / dayMs) : null;
      const in30Days = ageDays == null ? true : ageDays <= 30;
      const diseaseLabel = extractDiseaseLabel(combinedText);

      if (in30Days && fcvIso3.length) {
        fcvIso3.forEach((iso3) => {
          mappedCountrySet.add(iso3);
          if (countryMap[iso3]) {
            countryMap[iso3].disease_outbreak_signal_count += 1;
          }
        });
      }

      return {
        id: item.guid || item.link || item.title,
        title: item.title || "Untitled",
        summary: item.contentSnippet || null,
        content: item.content || null,
        source: sourceLabel,
        disease: diseaseLabel,
        created: item.pubDate || null,
        url: item.link || null,
        countries: fcvIso3,
        in30Days
      };
    })
    .filter((r) => r.in30Days && r.countries.length > 0)
    .slice(0, 60);

  status.total_items_scanned = feedItems.length;
  status.fcv_items_30d = items.length;
  status.mapped_countries = mappedCountrySet.size;
  status.overall = items.length ? "available" : "partial";
  return { items, status };
}

function whoDonDisabledBundle() {
  return {
    items: [],
    status: {
      source: "WHO DON",
      endpoint: WHO_DON_PAGE_URL,
      checked_at: new Date().toISOString(),
      overall: "disabled",
      total_items_scanned: 0,
      fcv_items_30d: 0,
      mapped_countries: 0,
      error: "disabled_by_configuration"
    }
  };
}

async function fetchUnhcrDisplacementData() {
  let feedItems = [];
  let usingReliefwebFallback = false;
  // Always fetch structural population data in parallel with the reporting feed -- not a last resort
  const statsPromise = fetchUnhcrPopulationStats().catch((err) => {
    console.error("UNHCR population stats fetch failed:", err.message);
    return [];
  });
  const fetchReliefWebFallbackItems = async () => {
    try {
      const scraped = await fetchReliefWebOrganizationReports(RELIEFWEB_UNHCR_ORG_URL, "UNHCR via ReliefWeb");
      if (scraped.length) {
        return scraped;
      }
    } catch (rwErr) {
      console.error("UNHCR ReliefWeb organization fallback failed", rwErr.message);
    }

    try {
      const rwFeed = await parser.parseURL(RELIEFWEB_UPDATES_RSS_URL);
      const rwItems = rwFeed.items || [];
      const matched = rwItems.filter((item) => isUnhcrReliefWebItem(item));
      usingReliefwebFallback = true;
      console.log(`UNHCR: using ReliefWeb RSS fallback (${matched.length} candidate items)`);
      return matched;
    } catch (rwErr) {
      console.error("UNHCR ReliefWeb RSS fallback failed", rwErr.message);
      return [];
    }
  };

  const fetchUnhcrRssItems = async () => {
    try {
      const feed = await parser.parseURL(UNHCR_RSS_URL);
      return feed.items || [];
    } catch (err) {
      // UNHCR RSS commonly returns 403 in hosted runtimes. Keep as warning only.
      console.warn("UNHCR RSS fetch skipped/failed", err.message);
      return [];
    }
  };

  if (UNHCR_FETCH_MODE === "unhcr-first") {
    feedItems = await fetchUnhcrRssItems();
  }

  if (!feedItems.length) {
    feedItems = await fetchReliefWebFallbackItems();
  }

  if (!feedItems.length && UNHCR_FETCH_MODE === "auto") {
    feedItems = await fetchUnhcrRssItems();
  }

  const offlinePath = path.join(DATA_DIR, "feeds", "unhcr.json");
  if (!feedItems.length && fs.existsSync(offlinePath)) {
    try {
      feedItems = JSON.parse(fs.readFileSync(offlinePath, "utf8")).items || [];
      console.log("UNHCR: using offline fallback data");
    } catch (offErr) {
      console.error("UNHCR offline load failed:", offErr.message);
    }
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const reports = feedItems.slice(0, 200).map((item) => {
    const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`;
    const fcvIso3 = FCV_COUNTRIES
      .filter((c) => countCountryMentions(combinedText, c))
      .map((c) => c.iso3);

    const created = item.pubDate ? new Date(item.pubDate) : null;
    const ageDays = created ? Math.floor((now - created) / dayMs) : null;
    const in30Days = ageDays != null && ageDays <= 30;

    return {
      id: item.guid || item.link || item.title,
      title: item.title || "Untitled",
      summary: item.contentSnippet || null,
      content: item.content || null,
      source: usingReliefwebFallback ? "UNHCR via ReliefWeb" : "UNHCR RSS",
      created: item.pubDate || null,
      url: item.link || null,
      countries: fcvIso3,
      in30Days
    };
  });

  const reportingItems = reports.filter((r) => r.in30Days && r.countries.length > 0).slice(0, 80);
  const statsItems = await statsPromise;
  if (statsItems.length) {
    console.log(`UNHCR: population stats API returned ${statsItems.length} country records (fetched in parallel)`);
  }
  return [...reportingItems, ...statsItems];
}

async function fetchIdmcDisplacementData() {
  let feedItems = [];
  try {
    const feed = await parser.parseURL("https://www.internal-displacement.org/rss.xml");
    feedItems = feed.items || [];
  } catch (err) {
    console.error("IDMC RSS fetch failed", err.message);
    const offlinePath = path.join(DATA_DIR, "feeds", "idmc.json");
    if (fs.existsSync(offlinePath)) {
      try {
        feedItems = JSON.parse(fs.readFileSync(offlinePath, "utf8")).items || [];
        console.log("IDMC: using offline fallback data");
      } catch (offErr) {
        console.error("IDMC offline load failed:", offErr.message);
      }
    }
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const reports = feedItems.slice(0, 200).map((item) => {
    const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`;
    const fcvIso3 = FCV_COUNTRIES
      .filter((c) => countCountryMentions(combinedText, c))
      .map((c) => c.iso3);

    const created = item.pubDate ? new Date(item.pubDate) : null;
    const ageDays = created ? Math.floor((now - created) / dayMs) : null;
    const in30Days = ageDays != null && ageDays <= 30;

    return {
      id: item.guid || item.link || item.title,
      title: item.title || "Untitled",
      summary: item.contentSnippet || null,
      content: item.content || null,
      source: "IDMC RSS",
      created: item.pubDate || null,
      url: item.link || null,
      countries: fcvIso3,
      in30Days
    };
  });

  return reports.filter((r) => r.in30Days && r.countries.length > 0).slice(0, 80);
}

async function fetchUnochaSituationData() {
  let feedItems = [];
  try {
    const feed = await parser.parseURL("https://www.unocha.org/rss.xml");
    feedItems = feed.items || [];
  } catch (err) {
    console.error("OCHA RSS fetch failed", err.message);
    const offlinePath = path.join(DATA_DIR, "feeds", "ocha.json");
    if (fs.existsSync(offlinePath)) {
      try {
        feedItems = JSON.parse(fs.readFileSync(offlinePath, "utf8")).items || [];
        console.log("OCHA: using offline fallback data");
      } catch (offErr) {
        console.error("OCHA offline load failed:", offErr.message);
      }
    }
  }

  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const reports = feedItems.slice(0, 200).map((item) => {
    const combinedText = `${item.title || ""} ${item.contentSnippet || ""} ${item.content || ""}`;
    const fcvIso3 = FCV_COUNTRIES
      .filter((c) => countCountryMentions(combinedText, c))
      .map((c) => c.iso3);

    const created = item.pubDate ? new Date(item.pubDate) : null;
    const ageDays = created ? Math.floor((now - created) / dayMs) : null;
    const in30Days = ageDays != null && ageDays <= 30;

    return {
      id: item.guid || item.link || item.title,
      title: item.title || "Untitled",
      summary: item.contentSnippet || null,
      content: item.content || null,
      source: "OCHA RSS",
      created: item.pubDate || null,
      url: item.link || null,
      countries: fcvIso3,
      in30Days
    };
  });

  return reports.filter((r) => r.in30Days && r.countries.length > 0).slice(0, 80);
}

async function fetchIomDtmDisplacementData() {
  const status = {
    source: "IOM DTM",
    endpoint: IOM_DTM_REPORTS_URL,
    checked_at: new Date().toISOString(),
    overall: "unavailable",
    total_items_scanned: 0,
    fcv_items_30d: 0,
    mapped_countries: 0,
    error: null
  };

  try {
    const response = await axios.get(IOM_DTM_REPORTS_URL, {
      timeout: 20000,
      headers: {
        "User-Agent": "WHO-AFRO-Dashboard/1.0 (+public-data-mvp)",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    const $ = cheerio.load(response.data || "");
    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    const eventTrackingRegex = /event\s*tracking|\bett\b|tracking\s+report/i;
    const displacementRegex = /displacement|displaced|idp\b|idps\b|returnee|forced\s+movement|population\s+movement|refugee/i;
    
    // Diagnostic check: detect if no links found (possible parser drift)
    const allReportLinks = $("a[href*='/reports/']").toArray();
    const diagnosticNote = allReportLinks.length === 0 ? "possible-parser-drift: no links matching selector" : null;
    
    const sourceRows = uniqueBy(
      allReportLinks
        .map((node) => {
          const link = $(node);
          const title = link.text().replace(/\s+/g, " ").trim();
          const url = absoluteUrl(IOM_DTM_REPORTS_URL, link.attr("href"));
          if (!title || !url) {
            return null;
          }

          const containers = [link.closest("article"), link.closest("li"), link.parent(), link.parent().parent()].filter((item) => item && item.length);
          const containerText = containers.map((item) => item.text().replace(/\s+/g, " ").trim()).find(Boolean) || title;
          const combinedText = `${title} ${containerText}`;
          if (!eventTrackingRegex.test(combinedText) || !displacementRegex.test(combinedText)) {
            return null;
          }

          const created = extractDateToIso(containerText);
          const ageDays = created ? Math.floor((now - new Date(created)) / dayMs) : null;
          const in30Days = ageDays == null ? true : ageDays <= 30;
          const countries = FCV_COUNTRIES.filter((c) => countCountryMentions(`${title} ${containerText}`, c)).map((c) => c.iso3);
          return {
            id: `iom-dtm-${url}`,
            title,
            summary: containerText === title ? null : containerText,
            content: containerText,
            source: "IOM DTM Event Tracking",
            created,
            url,
            countries,
            in30Days
          };
        })
        .filter(Boolean),
      (item) => item.url
    );

    status.total_items_scanned = sourceRows.length;
    const reports = sourceRows.filter((item) => item.in30Days && item.countries.length > 0).slice(0, 80);
    status.fcv_items_30d = reports.length;
    status.mapped_countries = new Set(reports.flatMap((item) => item.countries || [])).size;
    status.overall = reports.length ? "available" : (sourceRows.length ? "partial" : "unavailable");
    if (diagnosticNote && status.overall === "unavailable") {
      status.error = diagnosticNote;
    }
    return { items: reports, status };
  } catch (err) {
    status.error = `${err.response?.status || err.code || "request_failed"}: ${err.message}`;
    return { items: [], status };
  }
}

function summarizeExternalSources(hazards, reports, countries, fewsSignals, acapsItems, whoDonItems, iomDtmItems) {
  const fcvByIso = new Map((countries || []).map((c) => [c.iso3, c.country]));
  const hazardList = hazards || [];
  const reportList = (reports || []).filter((r) => r.in30Days);

  const hazardByType = hazardList.reduce((acc, h) => {
    const key = h.hazard_type || "Other";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const hazardByCountry = {};
  hazardList.forEach((h) => {
    (h.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      hazardByCountry[name] = (hazardByCountry[name] || 0) + 1;
    });
  });

  const reportByCountry = {};
  reportList.forEach((r) => {
    (r.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      reportByCountry[name] = (reportByCountry[name] || 0) + 1;
    });
  });

  const topCountriesByHazard = Object.entries(hazardByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

  const topCountriesByReport = Object.entries(reportByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

  const fewsList = fewsSignals || [];
  const acapsList = acapsItems || [];
  const whoDonList = (whoDonItems || []).filter((r) => r.in30Days);
  const iomDtmList = (iomDtmItems || []).filter((r) => r.in30Days);
  const fewsByCountry = {};
  fewsList.forEach((r) => {
    (r.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      fewsByCountry[name] = (fewsByCountry[name] || 0) + 1;
    });
  });
  const topCountriesByFews = Object.entries(fewsByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));
  const acapsByCountry = {};
  acapsList.forEach((r) => {
    (r.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      acapsByCountry[name] = (acapsByCountry[name] || 0) + 1;
    });
  });
  const topCountriesByAcaps = Object.entries(acapsByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));
  const whoDonByCountry = {};
  whoDonList.forEach((r) => {
    (r.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      whoDonByCountry[name] = (whoDonByCountry[name] || 0) + 1;
    });
  });
  const topCountriesByWhoDon = Object.entries(whoDonByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));
  const iomDtmByCountry = {};
  iomDtmList.forEach((r) => {
    (r.countries || []).forEach((iso3) => {
      const name = fcvByIso.get(iso3) || iso3;
      iomDtmByCountry[name] = (iomDtmByCountry[name] || 0) + 1;
    });
  });
  const topCountriesByIomDtm = Object.entries(iomDtmByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, count]) => ({ country, count }));

  return {
    generated_at: new Date().toISOString(),
    gdacs: {
      total_events: hazardList.length,
      total_fcv_linked_events: hazardList.filter((h) => (h.countries || []).length > 0).length,
      by_type: hazardByType,
      top_countries: topCountriesByHazard,
      latest_items: hazardList.slice(0, 5).map((h) => ({
        title: h.title,
        summary: h.summary || null,
        date: h.pubDate || null,
        countries: h.countries || [],
        linkage_scope: h.linkage_scope || ((h.countries || []).length ? "fcv-linked" : "afro-regional"),
        hazard_type: h.hazard_type || "Other",
        url: h.link || null
      }))
    },
    reliefweb: {
      total_reports_30d: reportList.length,
      top_countries: topCountriesByReport,
      latest_items: reportList.slice(0, 5).map((r) => ({
        title: r.title,
        summary: r.summary || null,
        date: r.created || null,
        countries: r.countries || [],
        url: r.url || null
      }))
    },
    fews_net: {
      total_items: fewsList.length,
      top_countries: topCountriesByFews,
      latest_items: fewsList.slice(0, 5).map((r) => ({
        title: r.title,
        summary: r.summary || null,
        date: r.date_label || null,
        countries: r.countries || [],
        url: r.url || null
      }))
    },
    acaps: {
      total_items: acapsList.length,
      top_countries: topCountriesByAcaps,
      latest_items: acapsList.slice(0, 5).map((r) => ({
        title: r.title,
        summary: r.summary || null,
        date: r.created || null,
        countries: r.countries || [],
        url: r.url || null,
        source: r.source || "ACAPS"
      }))
    },
    who_don: {
      total_reports_30d: whoDonList.length,
      top_countries: topCountriesByWhoDon,
      latest_items: whoDonList.slice(0, 5).map((r) => ({
        title: r.title,
        summary: r.summary || null,
        date: r.created || null,
        countries: r.countries || [],
        url: r.url || null,
        disease: r.disease || null,
        source: r.source || "WHO DON RSS"
      }))
    },
    iom_dtm: {
      total_reports_30d: iomDtmList.length,
      top_countries: topCountriesByIomDtm,
      latest_items: iomDtmList.slice(0, 5).map((r) => ({
        title: r.title,
        summary: r.summary || null,
        date: r.created || null,
        countries: r.countries || [],
        url: r.url || null,
        source: r.source || "IOM DTM Event Tracking"
      }))
    }
  };
}

function addSourceSummaryDeltas(summary) {
  const prev = previousSourceSummarySnapshot;
  const current = summary || {};
  const currentGdacs = current.gdacs || {};
  const currentRelief = current.reliefweb || {};
  const currentFews = current.fews_net || {};
  const currentAcaps = current.acaps || {};
  const currentWhoDon = current.who_don || {};
  const currentIomDtm = current.iom_dtm || {};

  const gdacsDelta = prev
    ? (currentGdacs.total_events || 0) - (prev.gdacs?.total_events || 0)
    : null;
  const reliefDelta = prev
    ? (currentRelief.total_reports_30d || 0) - (prev.reliefweb?.total_reports_30d || 0)
    : null;
  const fewsDelta = prev
    ? (currentFews.total_items || 0) - (prev.fews_net?.total_items || 0)
    : null;
  const acapsDelta = prev
    ? (currentAcaps.total_items || 0) - (prev.acaps?.total_items || 0)
    : null;
  const whoDonDelta = prev
    ? (currentWhoDon.total_reports_30d || 0) - (prev.who_don?.total_reports_30d || 0)
    : null;
  const iomDtmDelta = prev
    ? (currentIomDtm.total_reports_30d || 0) - (prev.iom_dtm?.total_reports_30d || 0)
    : null;

  const withRank = (list, prevList) => {
    const prevRank = new Map((prevList || []).map((x, i) => [x.country, i + 1]));
    return (list || []).map((x, i) => ({
      ...x,
      rank: i + 1,
      rank_delta: prevRank.has(x.country) ? prevRank.get(x.country) - (i + 1) : null
    }));
  };

  const enriched = {
    ...current,
    delta: {
      compared_to_previous_refresh: !!prev,
      gdacs_total_events_delta: gdacsDelta,
      reliefweb_total_reports_30d_delta: reliefDelta,
      fews_total_items_delta: fewsDelta,
      acaps_total_items_delta: acapsDelta,
      who_don_total_reports_30d_delta: whoDonDelta,
      iom_dtm_total_reports_30d_delta: iomDtmDelta
    },
    gdacs: {
      ...currentGdacs,
      top_countries: withRank(currentGdacs.top_countries, prev?.gdacs?.top_countries)
    },
    reliefweb: {
      ...currentRelief,
      top_countries: withRank(currentRelief.top_countries, prev?.reliefweb?.top_countries)
    },
    fews_net: {
      ...currentFews,
      top_countries: withRank(currentFews.top_countries, prev?.fews_net?.top_countries)
    },
    acaps: {
      ...currentAcaps,
      top_countries: withRank(currentAcaps.top_countries, prev?.acaps?.top_countries)
    },
    who_don: {
      ...currentWhoDon,
      top_countries: withRank(currentWhoDon.top_countries, prev?.who_don?.top_countries)
    },
    iom_dtm: {
      ...currentIomDtm,
      top_countries: withRank(currentIomDtm.top_countries, prev?.iom_dtm?.top_countries)
    }
  };

  previousSourceSummarySnapshot = {
    gdacs: {
      total_events: currentGdacs.total_events || 0,
      top_countries: currentGdacs.top_countries || []
    },
    reliefweb: {
      total_reports_30d: currentRelief.total_reports_30d || 0,
      top_countries: currentRelief.top_countries || []
    },
    fews_net: {
      total_items: currentFews.total_items || 0,
      top_countries: currentFews.top_countries || []
    },
    acaps: {
      total_items: currentAcaps.total_items || 0,
      top_countries: currentAcaps.top_countries || []
    },
    who_don: {
      total_reports_30d: currentWhoDon.total_reports_30d || 0,
      top_countries: currentWhoDon.top_countries || []
    },
    iom_dtm: {
      total_reports_30d: currentIomDtm.total_reports_30d || 0,
      top_countries: currentIomDtm.top_countries || []
    }
  };

  return enriched;
}

function updateConflictDisplacementSourceHistory(currentStatus) {
  const candidate = currentStatus?.candidate_items_current || currentStatus?.candidate_items_30d || {};
  const candidateReporting30d = currentStatus?.candidate_items_reporting_30d || {};
  const candidateStructural = currentStatus?.candidate_items_structural || {};
  const matched = currentStatus?.matched_signal_items || {};
  const matchedTotal = Object.values(matched).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const unhcrRssMatched = Number(matched["unhcr rss"] || 0);
  const unhcrReliefwebMatched = Number(matched["unhcr via reliefweb"] || 0);
  const unhcrPopulationMatched = Number(matched["unhcr population data"] || 0);
  const iomDtmMatched = Number(matched["iom dtm event tracking"] || 0);

  const entry = {
    generated_at: currentStatus?.generated_at || new Date().toISOString(),
    candidate_items_current: {
      reliefweb: Number(candidate.reliefweb || 0),
      acled: Number(candidate.acled || 0),
      unocha: Number(candidate.unocha || 0),
      idmc: Number(candidate.idmc || 0),
      unhcr: Number(candidate.unhcr || 0),
      iom_dtm: Number(candidate.iom_dtm || 0)
    },
    candidate_items_reporting_30d: {
      reliefweb: Number(candidateReporting30d.reliefweb || 0),
      acled: Number(candidateReporting30d.acled || 0),
      unocha: Number(candidateReporting30d.unocha || 0),
      idmc: Number(candidateReporting30d.idmc || 0),
      unhcr: Number(candidateReporting30d.unhcr || 0),
      iom_dtm: Number(candidateReporting30d.iom_dtm || 0)
    },
    candidate_items_structural: {
      unhcr_population_data: Number(candidateStructural.unhcr_population_data || 0)
    },
    candidate_items_30d: {
      reliefweb: Number(candidate.reliefweb || 0),
      acled: Number(candidate.acled || 0),
      unocha: Number(candidate.unocha || 0),
      idmc: Number(candidate.idmc || 0),
      unhcr: Number(candidate.unhcr || 0),
      iom_dtm: Number(candidate.iom_dtm || 0)
    },
    matched_signal_items: {
      "reliefweb rss": Number(matched["reliefweb rss"] || 0),
      "acled conflict index": Number(matched["acled conflict index"] || 0),
      "ocha rss": Number(matched["ocha rss"] || 0),
      "idmc rss": Number(matched["idmc rss"] || 0),
      "iom dtm event tracking": iomDtmMatched,
      "unhcr rss": unhcrRssMatched,
      "unhcr via reliefweb": unhcrReliefwebMatched,
      "unhcr population data": unhcrPopulationMatched,
      "unhcr total": unhcrRssMatched + unhcrReliefwebMatched + unhcrPopulationMatched
    },
    matched_total: matchedTotal
  };

  conflictDisplacementSourceHistorySnapshot = [...conflictDisplacementSourceHistorySnapshot, entry].slice(-5);
  return conflictDisplacementSourceHistorySnapshot;
}

function isCycloneSignalText(text) {
  return /cyclone|tropical\s+cyclone|tropical\s+storm|hurricane|typhoon|storm\s+surge/i.test(String(text || ""));
}

function isProjectionSignalText(text) {
  return /forecast|outlook|projection|advisory|warning|watch|anticipated|expected|track/i.test(String(text || ""));
}

function extractCycloneName(text) {
  const input = String(text || "");
  const patterns = [
    /(?:tropical\s+cyclone|cyclone|hurricane|typhoon|storm)\s+([A-Za-z][A-Za-z\-]{2,})/i,
    /\b([A-Z][A-Za-z\-]{2,})\s+(?:cyclone|hurricane|typhoon|storm)\b/i
  ];

  for (const rx of patterns) {
    const m = input.match(rx);
    if (m && m[1]) {
      const candidate = m[1].trim();
      if (!/forecast|warning|advisory|update|watch|tropical/i.test(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function cycloneIntelligence(countryMap, hazards, reports, forecasts, dedicatedCycloneSignals, dedicatedSourceStatus) {
  const now = Date.now();
  const activeWindowDays = CYCLONE_ACTIVE_WINDOW_DAYS;
  const recentWindowDays = EVENT_SIGNAL_LOOKBACK_DAYS;
  const countryEntries = Object.values(countryMap || {});
  const countryByName = new Map(countryEntries.map((c) => [c.country, c]));

  const mapCountriesFromText = (text) => FCV_COUNTRIES
    .filter((c) => countCountryMentions(text, c))
    .map((c) => c.iso3);

  const mapCountryNamesFromIso3 = (iso3List = []) => dedupeStrings(
    (iso3List || []).map((iso3) => countryMap[iso3]?.country || null)
  );

  const cycloneEvents = (hazards || []).filter((h) => isCycloneSignalText(`${h.hazard_type || ""} ${h.title || ""}`) && h.afro_context !== false);
  const recentEvents = cycloneEvents.filter((e) => {
    const t = e.pubDate ? new Date(e.pubDate).getTime() : Number.NaN;
    if (Number.isNaN(t)) {
      return false;
    }
    const ageDays = (now - t) / (1000 * 60 * 60 * 24);
    return ageDays <= recentWindowDays;
  });

  const grouped = {};
  recentEvents.forEach((e) => {
    const name = extractCycloneName(e.title) || "Unnamed System";
    if (!grouped[name]) {
      grouped[name] = {
        name,
        latest_update: e.pubDate || null,
        event_count: 0,
        countries: new Set(),
        geo_labels: new Set(),
        references: []
      };
    }
    grouped[name].event_count += 1;
    (e.countries || []).forEach((iso3) => grouped[name].countries.add(iso3));
    (e.geo_labels || []).forEach((label) => grouped[name].geo_labels.add(label));
    grouped[name].references.push({
      title: e.title || "Cyclone event",
      url: e.link || null,
      date: e.pubDate || null,
      source: "GDACS"
    });
    const currentLatest = grouped[name].latest_update ? new Date(grouped[name].latest_update).getTime() : 0;
    const candidate = e.pubDate ? new Date(e.pubDate).getTime() : 0;
    if (candidate > currentLatest) {
      grouped[name].latest_update = e.pubDate;
    }
  });

  (reports || []).forEach((r) => {
    if (!r.inLookbackDays) {
      return;
    }
    const combinedText = `${r.title || ""} ${r.summary || ""} ${r.content || ""}`;
    if (!isCycloneSignalText(combinedText)) {
      return;
    }
    const reportDate = r.created || null;
    const name = extractCycloneName(r.title || combinedText) || "Unnamed System";
    if (!grouped[name]) {
      grouped[name] = {
        name,
        latest_update: reportDate,
        event_count: 0,
        countries: new Set(),
        geo_labels: new Set(),
        references: []
      };
    }
    grouped[name].event_count += 1;
    (r.countries || []).forEach((iso3) => grouped[name].countries.add(iso3));
    grouped[name].references.push({
      title: r.title || "Cyclone report",
      url: r.url || null,
      date: reportDate,
      source: r.source || "ReliefWeb"
    });
    const currentLatest = grouped[name].latest_update ? new Date(grouped[name].latest_update).getTime() : 0;
    const candidate = reportDate ? new Date(reportDate).getTime() : 0;
    if (candidate > currentLatest) {
      grouped[name].latest_update = reportDate;
    }
  });

  const historicalCyclones = Object.values(grouped)
    .map((g) => ({
      name: g.name,
      latest_update: g.latest_update,
      event_count: g.event_count,
      countries: Array.from(g.countries).map((iso3) => countryMap[iso3]?.country || iso3),
      geo_labels: Array.from(g.geo_labels),
      references: g.references.slice(0, 8)
    }))
    .sort((a, b) => new Date(b.latest_update || 0).getTime() - new Date(a.latest_update || 0).getTime());

  const activeCyclones = historicalCyclones.filter((item) => {
    const t = item.latest_update ? new Date(item.latest_update).getTime() : Number.NaN;
    if (Number.isNaN(t)) {
      return false;
    }
    const ageDays = (now - t) / (1000 * 60 * 60 * 24);
    return ageDays <= activeWindowDays;
  });

  const projectionSignals = [];

  (forecasts || []).forEach((f) => {
    if (isCycloneSignalText(f.title || "")) {
      const inferredCountries = mapCountriesFromText(`${f.title || ""}`);
      projectionSignals.push({
        source: "ICPAC",
        title: f.title,
        url: f.url || null,
        horizon: f.horizon || null,
        date_label: f.date_label || null,
        risk_level: f.risk_level || "info",
        countries: inferredCountries,
        country_names: mapCountryNamesFromIso3(inferredCountries)
      });
    }
  });

  (reports || []).forEach((r) => {
    if (!r.inLookbackDays) {
      return;
    }
    const text = `${r.title || ""}`;
    if (isCycloneSignalText(text) && isProjectionSignalText(text)) {
      const inferredCountries = dedupeStrings([
        ...(r.countries || []),
        ...mapCountriesFromText(`${r.title || ""} ${r.summary || ""} ${r.content || ""}`)
      ]).filter((iso3) => !!countryMap[iso3]);
      projectionSignals.push({
        source: "ReliefWeb",
        title: r.title,
        url: r.url || null,
        horizon: "advisory",
        date_label: r.created || null,
        risk_level: "watch",
        countries: inferredCountries,
        country_names: mapCountryNamesFromIso3(inferredCountries)
      });
    }
  });

  (dedicatedCycloneSignals || []).forEach((signal) => {
    const shouldInclude = signal.projection_like || signal.horizon === "advisory";
    if (!shouldInclude) {
      return;
    }
    const signalText = `${signal.title || ""} ${(signal.geo_labels || []).join(" ")} ${signal.region_scope || ""}`;
    const inferredCountries = mapCountriesFromText(signalText);
    projectionSignals.push({
      source: signal.source,
      title: signal.title,
      url: signal.url || signal.source_url || null,
      horizon: signal.horizon || "advisory",
      date_label: signal.date_label || null,
      risk_level: signal.risk_level || "watch",
      geo_labels: signal.geo_labels || [],
      region_scope: signal.region_scope || null,
      countries: inferredCountries,
      country_names: mapCountryNamesFromIso3(inferredCountries)
    });
  });

  const uniqueProjection = [];
  const seen = new Set();
  projectionSignals.forEach((p) => {
    const key = `${p.source}|${p.title}|${p.url || ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueProjection.push(p);
    }
  });

  const countriesWithCycloneSignal = Object.values(countryMap || {}).filter((c) => c.cyclone_count > 0).length;
  const projectionCountryIso3 = dedupeStrings(uniqueProjection.flatMap((p) => p.countries || [])).filter((iso3) => !!countryMap[iso3]);
  const projectionCountryNames = dedupeStrings(
    projectionCountryIso3.map((iso3) => countryByName.get(countryMap[iso3]?.country)?.country || countryMap[iso3]?.country)
  );

  const managementStatus = activeCyclones.length
    ? "active-cyclone"
    : historicalCyclones.length
      ? "recent-cyclone-history"
    : uniqueProjection.length
      ? "projection-watch"
      : "monitoring";

  return {
    status: managementStatus,
    countries_with_cyclone_signal: countriesWithCycloneSignal,
    countries_with_projection_signal: projectionCountryIso3.length,
    projection_signal_countries: projectionCountryNames,
    projection_signal_count: uniqueProjection.length,
    active_cyclone_count: activeCyclones.length,
    historical_cyclone_count: historicalCyclones.length,
    projection_signals: uniqueProjection.slice(0, 30),
    active_cyclones: activeCyclones,
    historical_cyclones: historicalCyclones.slice(0, 30),
    source_scope: ["GDACS", "ICPAC", "ReliefWeb", ...(dedicatedSourceStatus?.sources || []).map((s) => s.source)],
    dedicated_source_status: dedicatedSourceStatus || {
      overall: "unavailable",
      checked_count: 0,
      available_count: 0,
      with_signal_count: 0,
      sources: []
    },
    active_window_days: activeWindowDays,
    recent_window_days: recentWindowDays
  };
}

function computeRiskScores(countryMap) {
  const countries = Object.values(countryMap);
  const wastingValues = countries.map((c) => c.indicators?.wasting_u5_pct?.latest?.value).filter((v) => v != null);
  const ipcValues = countries.map((c) => c.ipc?.phase3plus_pct ?? 0);
  const fewsValues = countries
    .map((c) => c.fews_ipc?.ml1_phase ?? c.fews_ipc?.cs_phase ?? null)
    .filter((v) => v != null);
  const hazardValues = countries.map((c) => c.hazard_count);
  const floodValues = countries.map((c) => c.flood_count || 0);
  const conflictDisplacementValues = countries.map((c) => (c.conflict_signal_count || 0) + (c.displacement_signal_count || 0));
  const droughtValues = countries.map((c) => c.drought_signal_count || 0);
  const cycloneValues = countries.map((c) => c.cyclone_count || 0);
  const forecastValues = countries.map((c) => c.icpac_forecast_count);
  const reportValues = countries.map((c) => c.report_count_30d);

  const wMin = Math.min(...(wastingValues.length ? wastingValues : [0]));
  const wMax = Math.max(...(wastingValues.length ? wastingValues : [1]));
  const ipcMin = Math.min(...ipcValues);
  const ipcMax = Math.max(...ipcValues);
  const fewsMin = Math.min(...(fewsValues.length ? fewsValues : [1]));
  const fewsMax = Math.max(...(fewsValues.length ? fewsValues : [5]));
  const hMin = Math.min(...hazardValues);
  const hMax = Math.max(...hazardValues);
  const flMin = Math.min(...floodValues);
  const flMax = Math.max(...floodValues);
  const cdMin = Math.min(...conflictDisplacementValues);
  const cdMax = Math.max(...conflictDisplacementValues);
  const dMin = Math.min(...droughtValues);
  const dMax = Math.max(...droughtValues);
  const cMin = Math.min(...cycloneValues);
  const cMax = Math.max(...cycloneValues);
  const fMin = Math.min(...forecastValues);
  const fMax = Math.max(...forecastValues);
  const rMin = Math.min(...reportValues);
  const rMax = Math.max(...reportValues);

  countries.forEach((c) => {
    const w = c.indicators?.wasting_u5_pct?.latest?.value ?? null;
    const fewsPhase = c.fews_ipc?.ml1_phase ?? c.fews_ipc?.cs_phase ?? null;
    // Food security is the top priority signal for decision-making.
    // Conflict/displacement and hazards are the next strongest humanitarian drivers.
    // Nutrition stays as a supporting burden context signal.
    const ipcPct = c.ipc?.phase3plus_pct ?? null;
    const ipcScore = ipcPct != null ? normalize(ipcPct, ipcMin, ipcMax) * 32 : 0;
    const fewsScore = ipcPct != null
      ? normalize(fewsPhase, fewsMin, fewsMax) * 13
      : normalize(fewsPhase, fewsMin, fewsMax) * 32;
    const wScore = ipcPct != null
      ? normalize(w, wMin, wMax) * 5
      : normalize(w, wMin, wMax) * 23;
    const conflictDisplacementScore = normalize((c.conflict_signal_count || 0) + (c.displacement_signal_count || 0), cdMin, cdMax) * 22;
    const hazardScore = normalize(c.hazard_count, hMin, hMax) * 6;
    const floodScore = normalize(c.flood_count || 0, flMin, flMax) * 8;
    const droughtScore = normalize(c.drought_signal_count || 0, dMin, dMax) * 4;
    const cycloneScore = normalize(c.cyclone_count || 0, cMin, cMax) * 4;
    const reportsScore = normalize(c.report_count_30d, rMin, rMax) * 10;
    const forecastScore = normalize(c.icpac_forecast_count, fMin, fMax) * 5;
    c.risk_score = Math.round(ipcScore + fewsScore + wScore + conflictDisplacementScore + hazardScore + floodScore + droughtScore + cycloneScore + reportsScore + forecastScore);

    const hasNutrition = Object.values(c.indicators).some((ind) => ind.latest != null);
    const hasIpc = c.ipc != null;
    c.data_quality = hasIpc ? "good" : hasNutrition ? "partial" : "limited";
  });
}

function buildMetricLedger(payload) {
  const countries = Array.isArray(payload?.countries) ? payload.countries : [];
  const droughtSignals = Array.isArray(payload?.drought_signals) ? payload.drought_signals : [];
  const cycloneProjectionSignals = Array.isArray(payload?.cyclone_intelligence?.projection_signals)
    ? payload.cyclone_intelligence.projection_signals
    : [];

  const priorityCountries = countries
    .filter((country) => Number(country?.risk_score || 0) >= 65)
    .map((country) => ({
      iso3: country.iso3,
      country: country.country,
      risk_score: Number(country.risk_score || 0)
    }))
    .sort((a, b) => b.risk_score - a.risk_score || a.country.localeCompare(b.country));

  const cycloneEvidenceByIso3 = new Map();
  countries.forEach((country) => {
    if (Number(country?.cyclone_count || 0) > 0) {
      cycloneEvidenceByIso3.set(country.iso3, {
        iso3: country.iso3,
        country: country.country,
        cyclone_event_count: Number(country.cyclone_count || 0),
        projection_signal_count: 0
      });
    }
  });

  cycloneProjectionSignals.forEach((signal) => {
    (signal?.countries || []).forEach((iso3) => {
      if (!iso3) {
        return;
      }
      const countryName = countries.find((country) => country.iso3 === iso3)?.country || iso3;
      const existing = cycloneEvidenceByIso3.get(iso3) || {
        iso3,
        country: countryName,
        cyclone_event_count: 0,
        projection_signal_count: 0
      };
      existing.projection_signal_count += 1;
      cycloneEvidenceByIso3.set(iso3, existing);
    });
  });

  const droughtEvidenceByIso3 = new Map();
  countries.forEach((country) => {
    if (Number(country?.drought_signal_count || 0) > 0) {
      droughtEvidenceByIso3.set(country.iso3, {
        iso3: country.iso3,
        country: country.country,
        drought_country_signal_count: Number(country.drought_signal_count || 0),
        drought_source_item_count: 0
      });
    }
  });

  droughtSignals.forEach((signal) => {
    (signal?.countries || []).forEach((iso3) => {
      if (!iso3) {
        return;
      }
      const countryName = countries.find((country) => country.iso3 === iso3)?.country || iso3;
      const existing = droughtEvidenceByIso3.get(iso3) || {
        iso3,
        country: countryName,
        drought_country_signal_count: 0,
        drought_source_item_count: 0
      };
      existing.drought_source_item_count += 1;
      droughtEvidenceByIso3.set(iso3, existing);
    });
  });

  const cycloneCountries = Array.from(cycloneEvidenceByIso3.values())
    .sort((a, b) => (b.cyclone_event_count + b.projection_signal_count) - (a.cyclone_event_count + a.projection_signal_count) || a.country.localeCompare(b.country));
  const droughtCountries = Array.from(droughtEvidenceByIso3.values())
    .sort((a, b) => (b.drought_country_signal_count + b.drought_source_item_count) - (a.drought_country_signal_count + a.drought_source_item_count) || a.country.localeCompare(b.country));

  return {
    generated_at: new Date().toISOString(),
    rule_version: "metric-ledger-v1",
    scope_country_count: Number(payload?.scope?.country_count || countries.length || 0),
    rules: {
      priority_escalation: "risk_score >= 65",
      cyclone_active: "country has cyclone_event_count > 0 OR mapped cyclone projection/advisory signal",
      drought_active: "country has drought_signal_count > 0 OR mapped drought source signal"
    },
    metrics: {
      priority_escalation_countries: {
        count: priorityCountries.length,
        countries: priorityCountries
      },
      cyclone_active_countries: {
        count: cycloneCountries.length,
        countries: cycloneCountries,
        source_summary: {
          cyclone_projection_signals_total: cycloneProjectionSignals.length,
          cyclone_projection_signals_with_country_mapping: Number(payload?.cyclone_intelligence?.countries_with_projection_signal || 0),
          gdacs_or_country_cyclone_event_countries: countries.filter((country) => Number(country?.cyclone_count || 0) > 0).length
        }
      },
      drought_active_countries: {
        count: droughtCountries.length,
        countries: droughtCountries,
        source_summary: {
          drought_signals_total: droughtSignals.length,
          drought_signals_with_country_mapping: droughtSignals.filter((signal) => Array.isArray(signal?.countries) && signal.countries.length > 0).length,
          country_drought_counter_positive: countries.filter((country) => Number(country?.drought_signal_count || 0) > 0).length
        }
      }
    }
  };
}

function metricLedgerResponseFromCache(query = {}) {
  const freshnessMode = query.freshness_mode === "lenient" ? "lenient" : "strict";
  const cached = dashboardResponseCache[freshnessMode];
  if (!cached?.payload) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "Metric ledger is not ready yet",
        details: "Call /api/dashboard-data first to initialize the current refresh payload cache."
      }
    };
  }

  const payload = cached.payload;
  return {
    ok: true,
    status: 200,
    body: payload.metric_ledger || buildMetricLedger(payload)
  };
}

function normalizeUrlForMatch(value) {
  const input = String(value || "").trim();
  if (!input) {
    return null;
  }
  try {
    const parsed = new URL(input);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}${parsed.search}`.toLowerCase();
  } catch {
    return input.replace(/\/+$/, "").toLowerCase();
  }
}

function collectPayloadUrlMatches(payload, targetUrl) {
  const normalizedTarget = normalizeUrlForMatch(targetUrl);
  if (!normalizedTarget || !payload) {
    return [];
  }

  const collections = [
    { key: "reports", label: "reports", urlKey: "url", titleKey: "title" },
    { key: "regional_flood_signals", label: "regional_flood_signals", urlKey: "link", titleKey: "title" },
    { key: "conflict_displacement_signals", label: "conflict_displacement_signals", urlKey: "url", titleKey: "title" },
    { key: "who_don_reports", label: "who_don_reports", urlKey: "url", titleKey: "title" },
    { key: "disease_outbreak_signals", label: "disease_outbreak_signals", urlKey: "url", titleKey: "title" },
    { key: "acaps_updates", label: "acaps_updates", urlKey: "url", titleKey: "title" }
  ];

  const matches = [];
  collections.forEach((collection) => {
    const rows = Array.isArray(payload?.[collection.key]) ? payload[collection.key] : [];
    rows.forEach((row) => {
      const url = row?.[collection.urlKey];
      const normalized = normalizeUrlForMatch(url);
      if (normalized && normalized === normalizedTarget) {
        matches.push({
          collection: collection.label,
          title: row?.[collection.titleKey] || "Untitled",
          url: url || null
        });
      }
    });
  });

  return matches;
}

function sourceValidationResponseFromCache(query = {}) {
  const freshnessMode = query.freshness_mode === "lenient" ? "lenient" : "strict";
  const cached = dashboardResponseCache[freshnessMode];
  if (!cached?.payload) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "Source validation is not ready yet",
        details: "Call /api/dashboard-data first to initialize the current refresh payload cache."
      }
    };
  }

  const payload = cached.payload;
  const iso3 = String(query.iso3 || "").trim().toUpperCase();
  const exactUrl = String(query.exact_url || query.url || "").trim();
  const countries = Array.isArray(payload?.countries) ? payload.countries : [];
  const ipcCountries = countries.filter((country) => country?.ipc && typeof country.ipc === "object");
  const selectedCountry = iso3 ? countries.find((country) => String(country?.iso3 || "").toUpperCase() === iso3) : null;
  const urlMatches = exactUrl ? collectPayloadUrlMatches(payload, exactUrl) : [];

  return {
    ok: true,
    status: 200,
    body: {
      generated_at: new Date().toISOString(),
      freshness_mode: freshnessMode,
      validation: {
        ipc_source_health: payload?.ipc_source_status || null,
        ipc_source_equivalent: {
          requested_iso3: iso3 || null,
          is_present: iso3 ? Boolean(selectedCountry?.ipc) : ipcCountries.length > 0,
          matched_country_count: ipcCountries.length,
          matched_iso3: ipcCountries.map((country) => country.iso3)
        },
        exact_url_match: {
          requested_url: exactUrl || null,
          is_present: exactUrl ? urlMatches.length > 0 : null,
          matches: urlMatches
        }
      },
      notes: [
        "IPC source-equivalent checks read countries[].ipc records (HDX-backed), not report item URLs.",
        "Exact URL checks scan report-like collections in the cached dashboard payload."
      ]
    }
  };
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "who-afro-public-dashboard", timestamp: new Date().toISOString() });
});

app.get("/api/country-feed/status", (req, res) => {
  const ageMinutes = countryFeedAgeMinutes(countryFeedSnapshot);
  const isFresh = ageMinutes <= COUNTRY_FEED_MAX_STALE_MINUTES;
  const localFileAvailable = Boolean(COUNTRY_FEED_LOCAL_FILE) && fs.existsSync(COUNTRY_FEED_LOCAL_FILE);
  res.json({
    ok: true,
    enabled: localFileAvailable || Boolean(COUNTRY_FEED_CSV_URL) || Boolean(countryFeedSnapshot),
    pull_mode: COUNTRY_FEED_PULL_MODE,
    local_file_path: COUNTRY_FEED_LOCAL_FILE || null,
    local_file_available: localFileAvailable,
    source_url_configured: Boolean(COUNTRY_FEED_CSV_URL),
    refresh_minutes: COUNTRY_FEED_REFRESH_MINUTES,
    max_stale_minutes: COUNTRY_FEED_MAX_STALE_MINUTES,
    is_fresh: isFresh,
    age_minutes: Number.isFinite(ageMinutes) ? Math.round(ageMinutes * 10) / 10 : null,
    schema_kind: countryFeedSnapshot?.schema_kind || null,
    row_count: Number(countryFeedSnapshot?.row_count || 0),
    country_count: Number(countryFeedSnapshot?.country_count || 0),
    month_count: Number(countryFeedSnapshot?.month_count || 0),
    latest_month: countryFeedSnapshot?.latest_month || null,
    saved_at: countryFeedSnapshot?.saved_at || null,
    last_error: countryFeedSnapshot?.last_error || null,
    source: countryFeedSnapshot?.mode || null
  });
});

app.post("/api/country-feed", express.text({ type: "*/*", limit: "3mb" }), async (req, res) => {
  try {
    if (COUNTRY_FEED_INGEST_TOKEN) {
      const token = String(req.headers["x-dashboard-ingest-token"] || "").trim();
      if (!token || token !== COUNTRY_FEED_INGEST_TOKEN) {
        return res.status(401).json({ error: "Unauthorized country feed push" });
      }
    }

    const raw = typeof req.body === "string" ? req.body.trim() : "";
    if (!raw) {
      return res.status(400).json({ error: "Empty request body" });
    }

    let records = [];
    let parsedFeed = null;
    if (raw.startsWith("{") || raw.startsWith("[")) {
      const parsed = JSON.parse(raw);
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.records) ? parsed.records : []);
      parsedFeed = parseCountryFeedRows(rows);
    } else {
      parsedFeed = parseCountryFeedCsv(raw);
    }

    records = parsedFeed.records;

    countryFeedSnapshot = {
      mode: "api_push",
      schema_kind: parsedFeed.schema_kind,
      source_url: null,
      saved_at: new Date().toISOString(),
      records,
      monthly_rows: parsedFeed.monthly_rows,
      row_count: parsedFeed.raw_row_count,
      country_count: parsedFeed.country_count,
      month_count: parsedFeed.month_count,
      latest_month: parsedFeed.latest_month,
      months: parsedFeed.months,
      last_error: null
    };
    persistCountryFeedSnapshot(countryFeedSnapshot);
    dashboardResponseCache.strict = null;
    dashboardResponseCache.lenient = null;

    return res.json({
      ok: true,
      schema_kind: parsedFeed.schema_kind,
      ingested_rows: parsedFeed.raw_row_count,
      ingested_countries: parsedFeed.country_count,
      ingested_months: parsedFeed.month_count,
      saved_at: countryFeedSnapshot.saved_at
    });
  } catch (err) {
    return res.status(400).json({
      error: "Country feed ingestion failed",
      details: err.message
    });
  }
});

app.get("/api/metric-ledger", (req, res) => {
  const result = metricLedgerResponseFromCache(req.query || {});
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }
  return res.status(result.status).json(result.body);
});

app.get("/api/source-validation", (req, res) => {
  const result = sourceValidationResponseFromCache(req.query || {});
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }
  return res.status(result.status).json(result.body);
});

app.get("/api/dashboard-data", async (req, res) => {
  try {
    const freshnessMode = req.query.freshness_mode === "lenient" ? "lenient" : "strict";
    const forceRefresh = String(req.query.force_refresh || "").toLowerCase() === "1"
      || String(req.query.force_refresh || "").toLowerCase() === "true";
    const cached = dashboardResponseCache[freshnessMode];
    if (!forceRefresh && cached && (Date.now() - cached.cached_at) <= (DASHBOARD_CACHE_TTL_SECONDS * 1000)) {
      return res.json(cached.payload);
    }

    const countryFeedPullStatus = await refreshCountryFeedFromRemote(forceRefresh);

    // Reload FCV Country Profile from disk on each uncached request so file updates are picked up automatically.
    fcvCountryProfileSnapshot = loadFcvCountryProfileData();

    const countryMap = {};
    FCV_COUNTRIES.forEach((c) => {
      countryMap[c.iso3] = emptyCountryRecord(c);
    });

    const nutrition_source_status = await fetchNutritionData(countryMap, freshnessMode);
    const nutritionPulledAt = new Date().toISOString();
    const nutrition_hdx_status = await fetchHdxAcuteMalnutritionFallback(countryMap, freshnessMode);
    const nutritionHdxPulledAt = new Date().toISOString();
    refreshNutritionCoverage(nutrition_source_status, countryMap);

    const [hazards, reportsBundle, unhcrReports, idmcReports, unochaReports, iomDtmBundle, forecasts, ipc_source_status, dedicatedCycloneBundle, acledBundle, dtmStatus, fewsBundle, fewsIpcBundle, acapsBundle, whoDonBundle, cemsFloodSourceStatus, ensoBundle] = await Promise.all([
      fetchGdacsData(countryMap),
      fetchReliefWebData(countryMap),
      fetchUnhcrDisplacementData(),
      fetchIdmcDisplacementData(),
      fetchUnochaSituationData(),
      fetchIomDtmDisplacementData(),
      fetchIcpacForecastData(countryMap),
      checkIpcSourceHealth(),
      fetchDedicatedCycloneSignals(),
      fetchAcledConflictIndex(countryMap),
      fetchDtmPopulationData(countryMap),
      fetchFewsNetSignals(countryMap),
      fetchFewsNetIpcData(countryMap),
      fetchAcapsUpdates(countryMap),
      WHO_DON_MODE === "off" ? Promise.resolve(whoDonDisabledBundle()) : fetchWhoDonOutbreakReports(countryMap),
      fetchCemsFloodSourceStatus(),
      fetchEnsoAdvisory()
    ]);
    const reports = filterApprovedVisibleEventItems(reportsBundle.reports || []);
    const regionalFloodSignals = filterApprovedVisibleEventItems(reportsBundle.regional_flood_signals || []);
    const reliefwebApiStatus = reportsBundle.api_status || { overall: "disabled", appname_configured: false };
    const hazardPulledAt = new Date().toISOString();
    const reliefwebPulledAt = hazardPulledAt;
    const icpacPulledAt = hazardPulledAt;
    const ensoPulledAt = hazardPulledAt;

    await fetchIpcData(countryMap);
    const drought_signals = deriveDroughtSignals(countryMap, forecasts, reports);
    let whoDonReports = filterApprovedVisibleEventItems(whoDonBundle.items || []);
    let whoDonStatus = whoDonBundle.status || {};
    if (WHO_DON_MODE !== "off" && !whoDonReports.length) {
      const fallbackReports = buildWhoDonFallbackFromReliefWebReports(reports);
      if (fallbackReports.length) {
        whoDonReports = fallbackReports;
        whoDonStatus = {
          ...whoDonStatus,
          source: "ReliefWeb disease fallback",
          endpoint: RELIEFWEB_UPDATES_RSS_URL,
          overall: "fallback",
          fcv_items_30d: fallbackReports.length,
          mapped_countries: new Set(fallbackReports.flatMap((r) => r.countries || [])).size,
          error: whoDonStatus.error || "who_don_unavailable_using_reliefweb"
        };
      }
    }
    const disease_outbreak_signals = deriveDiseaseOutbreakSignals(countryMap, reports, whoDonReports);
    const acledContextEntries = acledBundle.entries || [];
    const iomDtmReports = filterApprovedVisibleEventItems(iomDtmBundle.items || []);
    const conflict_displacement_signals = filterApprovedVisibleEventItems(
      deriveConflictDisplacementSignals(countryMap, [...reports, ...unhcrReports, ...idmcReports, ...unochaReports, ...iomDtmReports])
    );
    const unhcrReportingCandidates30d = (unhcrReports || []).filter((item) => {
      const src = String(item.source || "").toLowerCase();
      return src === "unhcr rss" || src === "unhcr via reliefweb";
    }).length;
    const unhcrStructuralCandidates = (unhcrReports || []).filter((item) => {
      const src = String(item.source || "").toLowerCase();
      return src === "unhcr population data";
    }).length;
    const matchedSignalItems = (conflict_displacement_signals || []).reduce((acc, item) => {
      const key = String(item.source || "Unknown").toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const conflictDisplacementSourceStatus = {
      generated_at: new Date().toISOString(),
      candidate_items_current: {
        reliefweb: reports.length,
        unhcr: unhcrReports.length,
        idmc: idmcReports.length,
        unocha: unochaReports.length,
        iom_dtm: iomDtmReports.length
      },
      candidate_items_reporting_30d: {
        reliefweb: reports.length,
        unhcr: unhcrReportingCandidates30d,
        idmc: idmcReports.length,
        unocha: unochaReports.length,
        iom_dtm: iomDtmReports.length
      },
      candidate_items_structural: {
        unhcr_population_data: unhcrStructuralCandidates
      },
      candidate_items_30d: {
        reliefweb: reports.length,
        unhcr: unhcrReports.length,
        idmc: idmcReports.length,
        unocha: unochaReports.length,
        iom_dtm: iomDtmReports.length
      },
      matched_signal_items: matchedSignalItems
    };
    const conflictDisplacementSourceHistory = updateConflictDisplacementSourceHistory(conflictDisplacementSourceStatus);
    const ipcPulledAt = new Date().toISOString();

    const countryFeedAppliedCount = mergeCountryFeedIntoCountryMap(countryMap, countryFeedSnapshot);

    computeRiskScores(countryMap);
    const serializedHazards = filterApprovedVisibleEventItems((hazards || []).map((hazard) => {
      const geoLabels = Array.isArray(hazard?.geo_labels) && hazard.geo_labels.length
        ? hazard.geo_labels
        : extractGeoLabelsFromText(`${hazard?.summary || ""} ${hazard?.title || ""}`);
      const afroContext = hazard?.afro_context != null
        ? hazard.afro_context
        : (hazard?.hazard_type === "Cyclone" ? isAfroCycloneContext(`${hazard?.summary || ""} ${hazard?.title || ""} ${geoLabels.join(" ")}`) : null);
      return {
        ...hazard,
        geo_labels: geoLabels,
        afro_context: afroContext
      };
    }));
    const cyclone_intelligence = cycloneIntelligence(
      countryMap,
      serializedHazards,
      reports,
      forecasts,
      dedicatedCycloneBundle.signals,
      dedicatedCycloneBundle.status
    );

    const countries = Object.values(countryMap).sort((a, b) => b.risk_score - a.risk_score);
    const topAlerts = countries
      .filter((c) => c.hazard_count > 0 || c.report_count_30d > 0)
      .slice(0, 5)
      .map((c) => ({
        iso3: c.iso3,
        country: c.country,
        risk_score: c.risk_score,
        hazard_count: c.hazard_count,
        flood_count: c.flood_count || 0,
        cyclone_count: c.cyclone_count,
        report_count_30d: c.report_count_30d
      }));

    const fewsSignals = fewsBundle.signals || [];
    const acapsUpdates = acapsBundle.items || [];
    const source_summaries = addSourceSummaryDeltas(summarizeExternalSources(serializedHazards, reports, countries, fewsSignals, acapsUpdates, whoDonReports, iomDtmReports));

    const scopeCounts = FCV_COUNTRIES.reduce((acc, country) => {
      if (country.fcv_track === "FCV Prioritized") acc.fcv_prioritized_count += 1;
      else if (country.fcv_track === "FCV Accelerated") acc.fcv_accelerated_count += 1;
      else if (country.fcv_track === "AFRO") acc.afro_country_count += 1;
      else if (country.fcv_track === "Other Africa") acc.other_africa_country_count += 1;
      return acc;
    }, {
      fcv_prioritized_count: 0,
      fcv_accelerated_count: 0,
      afro_country_count: 0,
      other_africa_country_count: 0
    });

    const responsePayload = {
      generated_at: new Date().toISOString(),
      scope: {
        country_count: FCV_COUNTRIES.length,
        ...scopeCounts,
        countries: FCV_COUNTRIES.map((c) => ({ iso3: c.iso3, country: c.name, group: c.fcv_track }))
      },
      data_notes: [
        "Nutrition indicators are currently pulled from World Bank public data as the primary nutrition source.",
        "The pregnant women metric is anemia prevalence (World Bank indicator SH.ANM.PREG.ZS), not an acute malnutrition prevalence estimate.",
        "No validated pregnant-women acute malnutrition source is currently connected in this dashboard.",
        "When World Bank nutrition values are stale or missing, HDX acute malnutrition country files are used as a transparent pilot fallback proxy for wasting burden in selected countries.",
        "HDX fallback currently applies only to under-5 wasting proxy values and does not replace the pregnant anemia indicator.",
        "Nutrition values older than 3 years are automatically excluded from display and fallback projections.",
        "IPC Acute Food Insecurity phase data is pulled automatically from HDX (Humanitarian Data Exchange) open datasets — same IPC data, no access block.",
        "IPC projected validity rows are used when available to provide source-based food security projection context by country.",
        "Hazard events are pulled from GDACS public RSS feed, with explicit cyclone and flood classification for country-level event pressure tracking.",
        `Regional flood signals are extracted from ReliefWeb RSS and ReliefWeb Reports API over a ${EVENT_SIGNAL_LOOKBACK_DAYS}-day lookback window using flood and AFRO context matching.`,
        "Copernicus CEMS Flood / GloFAS documentation is monitored as a major hydrological flood-source reference; the current implementation reports public access posture and automation limits rather than claiming direct live forecast extraction.",
        "Situation reports are pulled from ReliefWeb public RSS feed.",
        "Disease outbreak signals are derived from ReliefWeb and optional WHO Disease Outbreak News (DON) source titles and summaries using explicit outbreak keywords and FCV country mentions.",
        "FEWS NET references and downloadable assets are detected from the acute food insecurity source page; these are reference signals and not extracted country classification values.",
        "ACAPS homepage risk and analysis cards are scraped as humanitarian context signals and mapped to FCV countries when explicit country references are present.",
        "ACLED Conflict Index rows are scraped as structural conflict context and mapped to FCV countries automatically.",
        "FEWS NET IPC phase values (Current Situation and Near-Term Outlook) are fetched from the FEWS Data Warehouse public API (fdw.fews.net) for 9 of 13 FCV countries with FEWS NET coverage.",
        "Conflict and displacement signals are derived from ReliefWeb, OCHA RSS, IDMC, UNHCR, and IOM DTM event-tracking public reporting items using transparent keyword matching and explicit country mentions.",
        "IOM DTM integration currently prioritizes public metadata, dates, links, and mapped country mentions; this runtime does not parse full PDF caseload tables.",
        "For backward compatibility only, conflict_displacement_source_status.candidate_items_30d is retained as an alias of current-refresh candidate totals and may include structural entries; clients should use candidate_items_current, candidate_items_reporting_30d, and candidate_items_structural for semantically strict interpretation.",
        "Forecast bulletins are pulled from ICPAC weekly, monthly, and seasonal public pages.",
        "ENSO watch/advisory status is pulled from the NOAA CPC ENSO Diagnostic Discussion monthly bulletin and exposed as a regional climate watch layer.",
        "Drought projection signals are derived from ICPAC and ReliefWeb source titles and linked to countries using explicit country mentions.",
        `Cyclone projection/advisory signals are monitored from ICPAC and dedicated cyclone websites, while verified cyclone event history is aggregated from GDACS and ReliefWeb sources within a ${EVENT_SIGNAL_LOOKBACK_DAYS}-day lookback window.`,
        "Dedicated cyclone websites are monitored from Meteo-France La Reunion, Cyclocane, and WMO Severe Weather Information Centre pages with Africa-context filtering.",
        `Active cyclone events are tracked using a ${CYCLONE_ACTIVE_WINDOW_DAYS}-day active window, and recent cyclone history is retained for ${EVENT_SIGNAL_LOOKBACK_DAYS} days.`,
        "When a WHO FCV Services Deliveries file is ingested, district-level operational service rows are aggregated to country-month summaries and exposed as a supplemental service-delivery layer.",
        "Where Copernicus live flood services require credentials, the dashboard labels that limitation explicitly and continues to rely on GDACS and ReliefWeb for automatically extracted visible flood events.",
        "Projection values use transparent linear trend estimates for dashboard exploration and are not official forecasts.",
        "Dashboard outputs are source-linked and refresh-driven but remain decision-support signals; leadership decisions should be finalized after country validation and partner triangulation."
      ],
      freshness_policy: {
        nutrition_max_age_years: MAX_NUTRITION_DATA_AGE_YEARS,
        mode: freshnessMode
      },
      country_feed_status: {
        enabled: Boolean(COUNTRY_FEED_CSV_URL) || Boolean(countryFeedSnapshot),
        schema_kind: countryFeedSnapshot?.schema_kind || null,
        pull_mode: COUNTRY_FEED_PULL_MODE,
        refresh_minutes: COUNTRY_FEED_REFRESH_MINUTES,
        max_stale_minutes: COUNTRY_FEED_MAX_STALE_MINUTES,
        applied_country_rows: countryFeedAppliedCount,
        row_count: Number(countryFeedSnapshot?.row_count || 0),
        country_count: Number(countryFeedSnapshot?.country_count || 0),
        month_count: Number(countryFeedSnapshot?.month_count || 0),
        latest_month: countryFeedSnapshot?.latest_month || null,
        saved_at: countryFeedSnapshot?.saved_at || null,
        age_minutes: Number.isFinite(countryFeedAgeMinutes(countryFeedSnapshot))
          ? Math.round(countryFeedAgeMinutes(countryFeedSnapshot) * 10) / 10
          : null,
        is_fresh: countryFeedAgeMinutes(countryFeedSnapshot) <= COUNTRY_FEED_MAX_STALE_MINUTES,
        source: countryFeedSnapshot?.mode || null,
        source_url_configured: Boolean(COUNTRY_FEED_CSV_URL),
        last_error: countryFeedSnapshot?.last_error || null,
        last_pull: countryFeedPullStatus
      },
      service_delivery_status: countryFeedSnapshot?.schema_kind === "service_delivery"
        ? {
            source: "WHO FCV Services Deliveries",
            row_count: Number(countryFeedSnapshot?.row_count || 0),
            country_count: Number(countryFeedSnapshot?.country_count || 0),
            month_count: Number(countryFeedSnapshot?.month_count || 0),
            latest_month: countryFeedSnapshot?.latest_month || null,
            saved_at: countryFeedSnapshot?.saved_at || null
          }
        : null,
      service_delivery_by_country: countryFeedSnapshot?.schema_kind === "service_delivery"
        ? Object.values(countryMap)
            .filter((country) => country.service_delivery?.latest)
            .map((country) => ({
              iso3: country.iso3,
              country: country.country,
              group: country.fcv_track,
              service_delivery: country.service_delivery
            }))
            .sort((a, b) => a.country.localeCompare(b.country))
        : [],
      countries,
      hazards: serializedHazards,
      regional_flood_signals: regionalFloodSignals,
      flood_signal_window_days: reportsBundle.flood_signal_window_days || EVENT_SIGNAL_LOOKBACK_DAYS,
      forecasts,
      enso_advisory: ensoBundle.advisory,
      drought_signals,
      disease_outbreak_signals,
      who_don_reports: whoDonReports,
      iom_dtm_reports: iomDtmReports,
      who_don_source_status: whoDonStatus,
      fews_references: fewsSignals,
      fews_source_status: fewsBundle.status,
      fews_ipc_source_status: fewsIpcBundle.status,
      cems_flood_source_status: cemsFloodSourceStatus,
      enso_source_status: ensoBundle.source_status,
      acaps_updates: acapsUpdates,
      acaps_source_status: acapsBundle.status,
      conflict_displacement_signals,
      conflict_displacement_source_status: conflictDisplacementSourceStatus,
      conflict_displacement_source_status_history: conflictDisplacementSourceHistory,
      iom_dtm_source_status: iomDtmBundle.status,
      acled_context_entries: acledContextEntries,
      acled_source_status: acledBundle.status,
      dtm_displacement_status: dtmStatus,
      dtm_displacement: Object.values(countryMap)
        .filter((c) => c.dtm_idp != null)
        .map((c) => ({
          iso3: c.iso3,
          country: c.country,
          idp_count: c.dtm_idp.idp_count,
          displacement_reason: c.dtm_idp.displacement_reason,
          reporting_date: c.dtm_idp.reporting_date
        }))
        .sort((a, b) => (b.idp_count || 0) - (a.idp_count || 0)),
      reports,
      reliefweb_api_status: reliefwebApiStatus,
      filter_integrity_policy: {
        metric: "dropped_scope_filtered_plus_unmapped_country",
        warn_threshold: FILTER_INTEGRITY_WARN_THRESHOLD,
        bad_threshold: FILTER_INTEGRITY_BAD_THRESHOLD
      },
      source_summaries,
      cyclone_intelligence,
      nutrition_source_status,
      nutrition_hdx_status,
      cyclone_source_status: dedicatedCycloneBundle.status,
      ipc_source_status,
      top_alerts: topAlerts,
      source_freshness: {
        world_bank: nutritionPulledAt,
        nutrition_hdx: nutritionHdxPulledAt,
        gdacs: hazardPulledAt,
        reliefweb: reliefwebPulledAt,
        cems_flood: cemsFloodSourceStatus?.checked_at || null,
        who_don: whoDonStatus?.checked_at || null,
        iom_dtm: iomDtmBundle.status?.checked_at || null,
        icpac: icpacPulledAt,
        enso: ensoPulledAt,
        cyclone_dedicated: icpacPulledAt,
        ipc_hdx: ipcPulledAt,
        fews_net: fewsBundle.status?.checked_at || null,
        acled: acledBundle.status?.checked_at || null,
        acaps: acapsBundle.status?.checked_at || null,
        country_feed: countryFeedSnapshot?.saved_at || null
      },
      fcv_country_profile: fcvCountryProfileSnapshot || null
    };

    responsePayload.metric_ledger = buildMetricLedger(responsePayload);

    // Auto-save validation snapshot to disk (internal audit trail)
    try {
      if (!fs.existsSync(VALIDATION_LOG_DIR)) {
        fs.mkdirSync(VALIDATION_LOG_DIR, { recursive: true });
      }
      const stamp = (responsePayload.generated_at || new Date().toISOString()).replace(/[:.]/g, "-");
      const ruleVersion = String(responsePayload.metric_ledger.rule_version || "metric-ledger-v1").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
      const snapshot = {
        saved_at: new Date().toISOString(),
        dashboard_generated_at: responsePayload.generated_at || null,
        scope: responsePayload.scope || null,
        metric_ledger: responsePayload.metric_ledger,
        source_freshness: responsePayload.source_freshness || null
      };
      const logFile = path.join(VALIDATION_LOG_DIR, `validation-${ruleVersion}-${stamp}.json`);
      fs.writeFileSync(logFile, JSON.stringify(snapshot, null, 2), "utf8");
      console.log(`Validation snapshot saved: ${logFile}`);
    } catch (logErr) {
      console.error("Validation snapshot auto-save failed:", logErr.message);
    }

    dashboardResponseCache[freshnessMode] = {
      cached_at: Date.now(),
      payload: responsePayload
    };

    res.json(responsePayload);
  } catch (err) {
    console.error("Dashboard data endpoint failed", err);
    res.status(500).json({
      error: "Failed to load dashboard data",
      details: err.message
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`WHO AFRO public dashboard running at http://localhost:${PORT}`);
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Run start-local.bat to clear stale node listeners, or stop the process using this port.`);
      process.exit(1);
    }
    console.error("Server startup failed:", err.message || err);
    process.exit(1);
  });
}

module.exports = {
  app,
  classifyEnsoRisk,
  extractEnsoAdvisoryFromHtml
};
