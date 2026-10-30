"use strict";

// ACMAD Continental Multi-Hazard & Advisory Bulletin.
//
// ACMAD (African Centre of Meteorological Applications for Development) is the
// WMO Regional Climate Centre for Africa. Its continental bulletin, issued about
// twice a week, gives 5-day vigilance for heavy rainfall, heat waves and
// meningitis (dust and dryness conditions). The bulletin is a PDF; this module
// finds the latest one on acmad.org, extracts its text with pdftotext, and keeps
// only the published highlights with their validity dates.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const LIST_URL = "https://www.acmad.org/products/weather-watch-and-prediction-products/";
const SITE = "https://www.acmad.org";
const CACHE_FILE = path.join(__dirname, "..", "data", "acmad-hazard-cache.json");

// Names as ACMAD writes them, mapped to ISO3. Longer names first so "South Sudan"
// is matched before "Sudan" and "D.R.C." before "Congo".
const COUNTRIES = [
  ["Central African Republic", "CAF"], ["Democratic Republic of the Congo", "COD"], ["Democratic Republic of Congo", "COD"], ["RDC", "COD"], ["D.R.C.", "COD"], ["D.R.C", "COD"], ["DRC", "COD"], ["DR Congo", "COD"],
  ["Republic of the Congo", "COG"], ["Congo-Brazzaville", "COG"], ["South Sudan", "SSD"], ["South Africa", "ZAF"], ["Western Sahara", "ESH"],
  ["Equatorial Guinea", "GNQ"], ["Guinea-Bissau", "GNB"], ["Guinea Bissau", "GNB"], ["Burkina Faso", "BFA"], ["Sierra Leone", "SLE"], ["Cabo Verde", "CPV"], ["Cape Verde", "CPV"],
  ["Côte d'Ivoire", "CIV"], ["Cote d'Ivoire", "CIV"], ["Ivory Coast", "CIV"], ["Sao Tome and Principe", "STP"], ["São Tomé and Príncipe", "STP"],
  ["Algeria", "DZA"], ["Angola", "AGO"], ["Benin", "BEN"], ["Botswana", "BWA"], ["Burundi", "BDI"], ["Cameroon", "CMR"], ["Chad", "TCD"], ["Comoros", "COM"],
  ["Congo", "COG"], ["Djibouti", "DJI"], ["Egypt", "EGY"], ["Eritrea", "ERI"], ["Eswatini", "SWZ"], ["Ethiopia", "ETH"], ["Gabon", "GAB"], ["Gambia", "GMB"],
  ["Ghana", "GHA"], ["Guinea", "GIN"], ["Kenya", "KEN"], ["Lesotho", "LSO"], ["Liberia", "LBR"], ["Libya", "LBY"], ["Madagascar", "MDG"], ["Malawi", "MWI"],
  ["Mali", "MLI"], ["Mauritania", "MRT"], ["Mauritius", "MUS"], ["Morocco", "MAR"], ["Mozambique", "MOZ"], ["Namibia", "NAM"], ["Nigeria", "NGA"], ["Niger", "NER"],
  ["Rwanda", "RWA"], ["Senegal", "SEN"], ["Seychelles", "SYC"], ["Somalia", "SOM"], ["Sudan", "SDN"], ["Tanzania", "TZA"], ["Togo", "TGO"], ["Tunisia", "TUN"],
  ["Uganda", "UGA"], ["Zambia", "ZMB"], ["Zimbabwe", "ZWE"]
];

// Countries in the order the bulletin lists them.
function countriesIn(text) {
  // Straight apostrophes and spaces for hyphens ("South-Sudan"); "Niger Delta" is Nigeria.
  let rest = ` ${String(text || "").replace(/[\u2018\u2019]/g, "'").replace(/(\w)-(\w)/g, "$1 $2").replace(/Niger\s+(Delta|River)/gi, "Nigeria")} `;
  const norm = (name) => name.replace(/-/g, " ");
  const found = [];
  COUNTRIES.forEach(([name, iso]) => {
    const rx = new RegExp(`(^|[^A-Za-z])${norm(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^A-Za-z]|$)`, "g");
    let m;
    while ((m = rx.exec(rest))) {
      found.push({ iso, at: m.index });
    }
    rest = rest.replace(rx, (all, pre) => pre + " ".repeat(all.length - pre.length));
  });
  const ordered = [];
  found.sort((a, b) => a.at - b.at).forEach((x) => { if (!ordered.includes(x.iso)) ordered.push(x.iso); });
  return ordered;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// "October 29th, 2026" or "November 3, 2026" -> "2026-10-29". The year of the
// start date may be implied by the end date ("October 30 to November 3, 2026").
function isoDate(text, fallbackYear) {
  const m = String(text || "").match(/([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  const year = m[3] || fallbackYear;
  if (!year) return null;
  return `${year}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

function hazardKey(title) {
  const t = title.toLowerCase();
  if (/mening/.test(t)) return "meningitis";
  if (/heat/.test(t)) return "heat_wave";
  if (/rain|flood|wind/.test(t)) return "heavy_rain";
  if (/dust/.test(t)) return "dust";
  return "other";
}

// Splits the bulletin text into its vigilance sections and keeps each highlight.
function parseBulletinText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const issuedMatch = String(text).match(/Issued on:?\s*([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4})/);
  const issued = issuedMatch ? isoDate(issuedMatch[1]) : null;
  const sections = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/VIGILANCE MAP AND POLICY BRIEF FOR\s+(.+?)\s*$/i);
    if (!head) continue;
    const title = head[1].replace(/OUBREAK/i, "OUTBREAK").trim();
    let validFrom = null;
    let validTo = null;
    let highlight = "";
    for (let j = i + 1; j < Math.min(lines.length, i + 12); j += 1) {
      const valid = lines[j].match(/Valid From\s+(.+?)\s+to\s+(.+?\d{4})/i);
      if (valid) {
        validTo = isoDate(valid[2]);
        validFrom = isoDate(valid[1], validTo ? validTo.slice(0, 4) : null);
        // "December 30 to January 3, 2027": the start belongs to the previous year.
        if (validFrom && validTo && validFrom > validTo) {
          validFrom = `${Number(validFrom.slice(0, 4)) - 1}${validFrom.slice(4)}`;
        }
      }
      const hl = lines[j].match(/HIGHLIGHT:\s*(.+)$/i);
      if (hl) {
        // A highlight can continue on the next lines until a blank line or a table row.
        const parts = [hl[1].trim()];
        for (let k = j + 1; k < Math.min(lines.length, j + 6); k += 1) {
          const next = lines[k];
          if (!next.trim() || /^\s{20,}/.test(next) || /Phenomen|Hazard\s{2,}/i.test(next)) break;
          parts.push(next.trim());
        }
        highlight = parts.join(" ").replace(/\s+/g, " ").trim();
        break;
      }
    }
    if (!highlight) continue;
    const sentences = highlight.split(/(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean).map((s) => ({
      text: s,
      // "very likely", "epidemic", "severe", "extreme" mark the higher level of vigilance.
      level: /very likely|epidemic|severe|extreme/i.test(s) ? "high" : "watch",
      countries: countriesIn(s)
    }));
    sections.push({
      hazard: hazardKey(title),
      title: title.charAt(0) + title.slice(1).toLowerCase(),
      valid_from: validFrom,
      valid_to: validTo,
      highlight,
      sentences
    });
  }
  return { issued_on: issued, sections };
}

function pdfToText(file) {
  return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
}

// Finds the newest bulletin page, then its PDF. Returns null when nothing changed.
async function refreshAcmad({ get, previous } = {}) {
  const listHtml = String((await get(LIST_URL, { responseType: "text" })).data || "");
  const pages = [...listHtml.matchAll(/href="([^"]*\/weather-watch-and-prediction-products\/continental-multi-hazard-outlook-(\d{4}-\d{2}-\d{2})\/?)"/g)]
    .map((m) => ({ url: new URL(m[1], LIST_URL).href, date: m[2] }))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (!pages.length) throw new Error("No bulletin found on the ACMAD products page");
  const latest = pages[0];
  if (previous && previous.product_url === latest.url && previous.sections?.length) return null;
  const pageHtml = String((await get(latest.url, { responseType: "text" })).data || "");
  // Prefer the bulletin's own PDF over any other PDF linked on the page.
  const pdfLinks = [...pageHtml.matchAll(/href="([^"]+\.pdf)"/gi)].map((m) => m[1]);
  const pdfPath = pdfLinks.find((h) => /continental|hazard/i.test(h)) || pdfLinks.find((h) => h.includes(latest.date.replace(/-/g, ""))) || pdfLinks[0];
  if (!pdfPath) throw new Error("No PDF link on the bulletin page");
  const pdfUrl = new URL(pdfPath, latest.url).href;
  if (!/^https?:/.test(pdfUrl)) throw new Error("Unexpected PDF link");
  const pdf = await get(pdfUrl, { responseType: "arraybuffer", maxContentLength: 20 * 1024 * 1024, maxBodyLength: 20 * 1024 * 1024 });
  const buf = Buffer.from(pdf.data);
  if (buf.slice(0, 4).toString() !== "%PDF") throw new Error("Downloaded file is not a PDF");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acmad-"));
  const tmp = path.join(dir, "bulletin.pdf");
  let parsed;
  try {
    fs.writeFileSync(tmp, buf);
    parsed = parseBulletinText(pdfToText(tmp));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (!parsed.sections.length) throw new Error("Bulletin text had no vigilance highlights");
  return {
    source: "ACMAD Continental Multi-Hazard & Advisory Bulletin (WMO Regional Climate Centre for Africa)",
    product_url: latest.url,
    pdf_url: pdfUrl,
    issued_on: parsed.issued_on || latest.date,
    sections: parsed.sections,
    fetched_at: new Date().toISOString()
  };
}

function readAcmadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch (err) {
    console.error(`[acmad] could not read cache: ${err.message}`);
  }
  return null;
}

module.exports = { parseBulletinText, countriesIn, isoDate, refreshAcmad, readAcmadCache, CACHE_FILE, LIST_URL };
