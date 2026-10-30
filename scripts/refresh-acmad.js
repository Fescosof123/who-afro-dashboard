/**
 * refresh-acmad.js
 *
 * Run by the GitHub refresh job. Checks acmad.org for a new Continental
 * Multi-Hazard & Advisory Bulletin and, when there is one, saves its vigilance
 * highlights (heavy rainfall, heat wave, meningitis) to data/acmad-hazard-cache.json.
 * Needs pdftotext (poppler-utils). Keeps the last good bulletin if anything fails.
 *
 * Usage: node scripts/refresh-acmad.js
 */

"use strict";

const fs = require("fs");
const axios = require("axios");
const { refreshAcmad, readAcmadCache, CACHE_FILE } = require("../lib/acmad");

const get = (url, opts = {}) => axios.get(url, {
  timeout: 60000,
  headers: { "User-Agent": "WHO-AFRO-Dashboard/1.0 (+acmad-refresh)" },
  ...opts
});

refreshAcmad({ get, previous: readAcmadCache() })
  .then((result) => {
    if (!result) {
      console.log("[acmad] no new bulletin");
      return;
    }
    fs.writeFileSync(CACHE_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.log(`[acmad] saved bulletin of ${result.issued_on} (${result.sections.length} hazards)`);
  })
  .catch((err) => {
    console.error(`[acmad] refresh failed, last bulletin kept: ${err.message}`);
    process.exitCode = 0;
  });
