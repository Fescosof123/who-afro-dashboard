"use strict";

// Strategic humanitarian KPIs for the WHO AFRO DHM dashboard.
//
// Every figure here comes from a verified publisher that owns the data:
//   - OCHA HDX HAPI (humanitarian needs, appeals funding, IDPs from IOM DTM,
//     refugees from UNHCR, INFORM Risk from EC JRC, IPC phases)
//   - OCHA Financial Tracking Service (health cluster requirements and funding)
//   - OCHA Response Monitoring (HPC): health cluster caseloads and people reached
//   - WHO Surveillance System for Attacks on Health Care (SSA)
//   - WHO AFRO grading decisions, entered by DHM in data/who-grading.csv
//   - FCV country profile workbook (DHM, compiled from 2026 HNRPs) as a labelled fallback
//
// Results are cached on disk so the dashboard keeps working when a source is down.
// Each value carries its source and reference date.

const fs = require("fs");
const path = require("path");
const axios = require("axios");

const DATA_DIR = path.join(__dirname, "..", "data");
const CACHE_FILE = path.join(DATA_DIR, "strategic-cache.json");
const GRADING_FILE = path.join(DATA_DIR, "who-grading.csv");
const REFERENCE_FILE = path.join(DATA_DIR, "fcv-reference.json");
const HISTORY_FILE = path.join(DATA_DIR, "strategic-history.json");
// The server writes its own snapshots here (not tracked by git), so a local run
// never changes the committed history file that the GitHub job maintains.
const LOCAL_HISTORY_FILE = path.join(DATA_DIR, "strategic-history.local.json");
// Monthly KPI snapshots are also committed to the repository by the GitHub Action,
// so a fresh Render instance can still compare against last month.
const HISTORY_URL = String(process.env.STRATEGIC_HISTORY_URL
  || "https://raw.githubusercontent.com/Fescosof123/who-afro-dashboard/main/data/strategic-history.json").trim();
const HISTORY_MAX_MONTHS = 36;

const HAPI_BASE = "https://hapi.humdata.org/api/v2";
const FTS_BASE = "https://api.hpc.tools/v1/public";
const HPC_V2_BASE = "https://api.hpc.tools/v2/public";
const SSA_BASE = "https://extranet.who.int/ssa/Ref";

const REFRESH_HOURS = Number(process.env.STRATEGIC_REFRESH_HOURS || 12);
const REQUEST_TIMEOUT_MS = Number(process.env.STRATEGIC_REQUEST_TIMEOUT_MS || 20000);
const IDP_MAX_AGE_MONTHS = 24;
const IPC_MAX_AGE_MONTHS = 18;
// A country with no current humanitarian plan keeps its last plan's health figure
// for the triage tier while that plan ended less than this many months ago.
const LAST_PLAN_MAX_AGE_MONTHS = 24;
// A reach figure counts as a full-year result when its reporting period ends
// within this many days of the plan's end date.
const REACH_YEAR_END_TOLERANCE_DAYS = 45;

// HDX HAPI asks every client to identify itself (base64 of "app-name:contact-email").
// Set HDX_HAPI_APP_IDENTIFIER in the environment to the DHM team's own identifier.
const HAPI_APP_IDENTIFIER = String(
  process.env.HDX_HAPI_APP_IDENTIFIER
    || Buffer.from("who-afro-humanitarian-dashboard:dashboard@example.org").toString("base64")
).trim();

function loadReference() {
  const raw = JSON.parse(fs.readFileSync(REFERENCE_FILE, "utf8"));
  return raw;
}

function allReferenceCountries(reference) {
  const groups = reference.groups || {};
  return Object.entries(groups).flatMap(([group, list]) => list.map((c) => ({ ...c, group })));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, params = {}, attempts = 3) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await axios.get(url, { params, timeout: REQUEST_TIMEOUT_MS, headers: { Accept: "application/json" } });
      if (typeof res.data === "string") {
        return JSON.parse(res.data);
      }
      return res.data;
    } catch (err) {
      lastError = err;
      const status = err?.response?.status;
      if (status && status < 500 && status !== 429) {
        break;
      }
      await sleep(1500 * (i + 1));
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

async function hapi(endpoint, params) {
  const data = await getJson(`${HAPI_BASE}/${endpoint}`, {
    ...params,
    app_identifier: HAPI_APP_IDENTIFIER,
    output_format: "json",
    limit: 10000
  });
  return Array.isArray(data?.data) ? data.data : [];
}

function latestBy(rows, key = "reference_period_start") {
  return rows.reduce((best, row) => (!best || String(row[key]) > String(best[key]) ? row : best), null);
}

function monthsBetween(isoDate, now = new Date()) {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
}

function pickNeeds(rows, sectorCode) {
  const filtered = rows.filter((r) => r.sector_code === sectorCode && !r.category);
  if (!filtered.length) return null;
  const start = filtered.reduce((m, r) => (r.reference_period_start > m ? r.reference_period_start : m), "");
  const out = { year: start.slice(0, 4), source: "OCHA HNRP via HDX HAPI" };
  filtered.filter((r) => r.reference_period_start === start).forEach((r) => {
    const v = Number(r.population);
    if (!Number.isFinite(v)) return;
    if (r.population_status === "INN") out.in_need = v;
    if (r.population_status === "TGT") out.targeted = v;
    if (r.population_status === "REA") out.reached = v;
    if (r.population_status === "AFF") out.affected = v;
  });
  return out;
}

// Health (or intersectoral) needs for every plan year HDX HAPI holds, so the
// dashboard can compare this year's plan with last year's.
function needsHistory(rows, sectorCode) {
  const out = {};
  rows.filter((r) => r.sector_code === sectorCode && !r.category).forEach((r) => {
    const year = String(r.reference_period_start || "").slice(0, 4);
    const v = Number(r.population);
    if (!year || !Number.isFinite(v)) return;
    out[year] = out[year] || { year, period_end: String(r.reference_period_end || "").slice(0, 10) || null };
    if (r.population_status === "INN") out[year].in_need = v;
    if (r.population_status === "TGT") out[year].targeted = v;
    if (r.population_status === "REA") out[year].reached = v;
  });
  return out;
}

async function fetchHapiCountry(iso3) {
  const errors = [];
  const safe = async (label, fn) => {
    try {
      const value = await fn();
      await sleep(250);
      return value;
    } catch (err) {
      errors.push(`${label}: ${err?.response?.status || err.message}`);
      return [];
    }
  };

  const needs = await safe("needs", () => hapi("affected-people/humanitarian-needs", { location_code: iso3, admin_level: 0 }));
  const funding = await safe("funding", () => hapi("coordination-context/funding", { location_code: iso3 }));
  const idps = await safe("idps", () => hapi("affected-people/idps", { location_code: iso3, admin_level: 0 }));
  const refugees = await safe("refugees", () => hapi("affected-people/refugees-persons-of-concern", { asylum_location_code: iso3, gender: "all", age_range: "all" }));
  const risk = await safe("national-risk", () => hapi("coordination-context/national-risk", { location_code: iso3 }));
  const ipc = await safe("food-security", () => hapi("food-security-nutrition-poverty/food-security", { location_code: iso3, admin_level: 0, ipc_phase: "3+" }));

  const minAppealYear = String(new Date().getFullYear() - 1);
  const appealsAll = funding.filter((r) => r.appeal_code && r.appeal_code !== "Not specified"
    && String(r.reference_period_start).slice(0, 4) >= minAppealYear);
  const latestYear = appealsAll.reduce((m, r) => (r.reference_period_start > m ? r.reference_period_start : m), "");
  // IOM DTM runs several operations per country (often by province or crisis).
  // Take each operation's latest round, then add up the operations whose latest
  // round falls within 12 months of the most recent one.
  const latestByOperation = {};
  idps.forEach((r) => {
    const key = r.operation || "unspecified";
    const cur = latestByOperation[key];
    if (!cur || r.reference_period_end > cur.reference_period_end
      || (r.reference_period_end === cur.reference_period_end && Number(r.population) > Number(cur.population))) {
      latestByOperation[key] = r;
    }
  });
  const opRows = Object.values(latestByOperation);
  const idpDate = opRows.reduce((m, r) => (r.reference_period_end > m ? r.reference_period_end : m), "");
  const cutoff = idpDate ? new Date(new Date(idpDate).getTime() - 365 * 864e5).toISOString() : "";
  const windowRows = opRows.filter((r) => r.reference_period_end >= cutoff);
  // A national (countrywide) operation already includes the provincial ones,
  // so use it alone when present to avoid double counting.
  const nationalOps = windowRows
    .filter((r) => /countrywide|country-wide|overview|mobility tracking|national/i.test(r.operation || ""))
    .sort((a, b) => String(b.reference_period_end).localeCompare(String(a.reference_period_end)));
  const idpRows = nationalOps.length ? [nationalOps[0]] : windowRows;
  const idpLatestDate = idpRows.reduce((m, r) => (r.reference_period_end > m ? r.reference_period_end : m), "");
  const refYear = refugees.reduce((m, r) => (r.reference_period_start > m ? r.reference_period_start : m), "");
  const refRows = refugees.filter((r) => r.reference_period_start === refYear && ["REF", "ASY"].includes(r.population_group));
  const ipcCurrent = latestBy(ipc.filter((r) => r.ipc_type === "current"));
  const ipcProjection = latestBy(ipc.filter((r) => r.ipc_type !== "current"));
  const informRisk = latestBy(risk);

  return {
    errors,
    health: pickNeeds(needs, "HEA"),
    health_history: needsHistory(needs, "HEA"),
    intersectoral: pickNeeds(needs, "Intersectoral"),
    appeals: appealsAll
      .filter((r) => r.reference_period_start === latestYear)
      .map((r) => ({
        code: r.appeal_code,
        name: r.appeal_name,
        type: r.appeal_type,
        year: latestYear.slice(0, 4),
        requirements_usd: r.requirements_usd,
        funding_usd: r.funding_usd,
        funding_pct: r.funding_pct
      })),
    idps: idpRows.length
      ? {
          total: idpRows.reduce((s, r) => s + (Number(r.population) || 0), 0),
          date: idpLatestDate.slice(0, 10),
          operation: [...new Set(idpRows.map((r) => r.operation))].join("; "),
          operations: idpRows.map((r) => ({ operation: r.operation, population: r.population, date: String(r.reference_period_end).slice(0, 10) })),
          source: "IOM DTM via HDX HAPI"
        }
      : null,
    refugees: refRows.length
      ? { total: refRows.reduce((s, r) => s + (Number(r.population) || 0), 0), year: refYear.slice(0, 4), source: "UNHCR via HDX HAPI" }
      : null,
    inform_risk: informRisk
      ? {
          overall: Number(informRisk.overall_risk),
          risk_class: Number(informRisk.risk_class),
          global_rank: Number(informRisk.global_rank),
          year: String(informRisk.reference_period_start).slice(0, 4),
          source: "INFORM Risk (EC JRC) via HDX HAPI"
        }
      : null,
    ipc_current: ipcCurrent
      ? {
          population: Number(ipcCurrent.population_in_phase),
          fraction: Number(ipcCurrent.population_fraction_in_phase),
          period_start: String(ipcCurrent.reference_period_start).slice(0, 10),
          period_end: String(ipcCurrent.reference_period_end).slice(0, 10),
          source: "IPC via HDX HAPI"
        }
      : null,
    ipc_projection: ipcProjection
      ? {
          population: Number(ipcProjection.population_in_phase),
          fraction: Number(ipcProjection.population_fraction_in_phase),
          type: ipcProjection.ipc_type,
          period_start: String(ipcProjection.reference_period_start).slice(0, 10),
          period_end: String(ipcProjection.reference_period_end).slice(0, 10),
          source: "IPC via HDX HAPI"
        }
      : null
  };
}

async function fetchFtsHealth(year, isoSet) {
  const plans = (await getJson(`${FTS_BASE}/plan/year/${year}`))?.data || [];
  const selected = plans.filter((p) => (p.locations || []).some((l) => isoSet.has(l.iso3))
    && !/regional refugee|migrant/i.test(p.planVersion?.name || p.name || ""));
  const out = [];
  for (const plan of selected) {
    try {
      const data = (await getJson(`${FTS_BASE}/fts/flow`, { planId: plan.id, groupby: "cluster" }))?.data || {};
      const reqs = data.requirements?.objects || [];
      const funds = data.report3?.fundingTotals?.objects?.[0]?.singleFundingObjects || [];
      const isHealth = (name) => /^(health|sant[ée])$/i.test(String(name || "").trim());
      const healthReq = reqs.find((o) => isHealth(o.name));
      const healthFund = funds.find((o) => isHealth(o.name));
      const unspecified = funds.find((o) => /not specified/i.test(o.name || ""));
      out.push({
        iso3: (plan.locations || []).map((l) => l.iso3).filter((iso) => isoSet.has(iso)).join(","),
        plan_id: plan.id,
        code: plan.planVersion?.code || plan.code || null,
        name: plan.planVersion?.name || plan.name || null,
        health_cluster: healthReq?.name || healthFund?.name || null,
        health_requirements_usd: healthReq?.revisedRequirements ?? null,
        health_funding_usd: healthFund?.totalFunding ?? null,
        plan_requirements_usd: data.requirements?.totalRevisedReqs ?? null,
        plan_funding_usd: data.incoming?.fundingTotal ?? funds.reduce((s, o) => s + (o.totalFunding || 0), 0),
        unspecified_funding_usd: unspecified?.totalFunding ?? null,
        source: "OCHA FTS"
      });
      await sleep(250);
    } catch (err) {
      out.push({ iso3: (plan.locations || []).map((l) => l.iso3).join(","), plan_id: plan.id, error: err.message });
    }
  }
  return out;
}

// ---------- OCHA Response Monitoring (HPC) ----------
// Each humanitarian plan has a Health cluster caseload (people in need, targeted)
// and, once OCHA generates monitoring, people reached. The plan list and the
// monitoring calendar are small; the measurement payload is large, so it is
// only downloaded when monitoring exists and the plan has changed.

const HEALTH_CLUSTER_RE = /^(health|sant[ée]|sa[uú]de)$/i;

function healthCaseloads(planData) {
  const entities = planData?.governingEntities || [];
  const byName = entities.filter((g) => HEALTH_CLUSTER_RE.test(String(g.governingEntityVersion?.name || "").trim()));
  const pool = byName.length ? byName : entities.filter((g) => (g.attachments || [])
    .some((a) => a.type === "caseLoad" && /^CLHEA\b|-HEA$/i.test(String(a.composedReference || a.attachmentVersion?.customReference || ""))));
  return pool.flatMap((g) => (g.attachments || []).filter((a) => a.type === "caseLoad"));
}

function caseloadTotals(values) {
  const out = {};
  (values?.metrics?.values?.totals || []).forEach((t) => {
    const v = Number(t.value);
    if (t.value == null || t.value === "" || !Number.isFinite(v)) return;
    if (t.type === "inNeed") out.in_need = v;
    if (t.type === "target") out.targeted = v;
    if (t.type === "cumulativeReach") out.reached = v;
  });
  return out;
}

// Picks the health caseload with the largest need (a cluster sometimes splits
// its caseload by population group; the largest is the cluster-wide line).
function extractHealthFromPlan(planData) {
  const caseloads = healthCaseloads(planData)
    .map((a) => ({ a, totals: caseloadTotals(a.attachmentVersion?.value) }))
    .filter((x) => x.totals.in_need != null || x.totals.targeted != null)
    .sort((x, y) => (y.totals.in_need || 0) - (x.totals.in_need || 0));
  if (!caseloads.length) return null;
  const { a, totals } = caseloads[0];
  const periods = new Map((planData.monitoringPeriods || []).map((m) => [m.id, m]));
  // Cumulative reach is people reached since the plan started, so the latest
  // period is the figure to use. When two periods end on the same date, the
  // longer one is kept.
  const series = [];
  (a.measurements || []).forEach((m) => {
    const t = caseloadTotals(m.measurementVersion?.value);
    const period = periods.get(m.planReportingPeriodId);
    if (t.reached == null || !period) return;
    series.push({ reached: t.reached, period_start: period.startDate, period_end: period.endDate });
  });
  series.sort((x, y) => String(x.period_end).localeCompare(String(y.period_end))
    || String(y.period_start).localeCompare(String(x.period_start)));
  let reach = null;
  series.forEach((x) => {
    if (!reach || String(x.period_end) > String(reach.period_end)
      || (x.period_end === reach.period_end && String(x.period_start) < String(reach.period_start))) {
      reach = { ...x };
    }
  });
  if (reach) {
    const earlierMax = Math.max(0, ...series.filter((x) => x.period_end < reach.period_end).map((x) => x.reached));
    reach.periods_reported = series.length;
    reach.decreased = earlierMax > reach.reached;
  }
  return { in_need: totals.in_need ?? null, targeted: totals.targeted ?? null, reach };
}

// Plan-wide (all sectors) people in need and targeted.
function extractPlanTotals(planData) {
  const totals = (planData?.attachments || [])
    .filter((a) => a.type === "caseLoad")
    .map((a) => caseloadTotals(a.attachmentVersion?.value))
    .filter((t) => t.in_need != null)
    .sort((x, y) => y.in_need - x.in_need);
  return totals[0] ? { in_need: totals[0].in_need, targeted: totals[0].targeted ?? null } : null;
}

async function fetchHpcHealth(years, isoSet, previous = {}) {
  const plans = {};
  const errors = [];
  for (const year of years) {
    let list = [];
    try {
      list = (await getJson(`${FTS_BASE}/plan/year/${year}`))?.data || [];
    } catch (err) {
      errors.push(`plan list ${year}: ${err.message}`);
      // Keep the plans already held for that year rather than dropping them.
      Object.entries(previous).forEach(([k, p]) => {
        if (p.year === String(year) && isoSet.has(p.iso3) && !plans[k]) plans[k] = p;
      });
      continue;
    }
    const selected = list.filter((p) => {
      const isos = (p.locations || []).map((l) => l.iso3);
      // Country plans only: regional refugee and migrant plans span several countries.
      return isos.some((iso) => isoSet.has(iso)) && isos.filter((iso) => iso).length === 1
        && !/regional|migrant/i.test(p.planVersion?.name || p.name || "");
    });
    for (const p of selected) {
      const key = String(p.id);
      // A plan listed under two years is kept under the most recent one.
      if (plans[key]) continue;
      try {
        // The bare plan record is small and carries updatedAt; the full record
        // (caseloads plus monitoring) is downloaded only when the plan changed
        // or the stored copy is more than three days old (new monitoring figures
        // do not always change the plan's updatedAt).
        const meta = (await getJson(`${HPC_V2_BASE}/plan/${p.id}`))?.data || {};
        const fingerprint = String(meta.updatedAt || "");
        const prev = previous[key];
        const prevAgeDays = prev?.downloaded_at ? (Date.now() - new Date(prev.downloaded_at).getTime()) / 864e5 : Infinity;
        let { health, plan_totals: planTotals, monitoring_generated: generated, downloaded_at: downloadedAt } = prev || {};
        if (!prev || prev.fingerprint !== fingerprint || !(prevAgeDays < 3)) {
          const full = (await getJson(`${HPC_V2_BASE}/plan/${p.id}`, { content: "measurements", version: "current", disaggregation: "false" }))?.data || {};
          health = extractHealthFromPlan(full);
          planTotals = extractPlanTotals(full);
          generated = (full.monitoringPeriods || []).some((m) => m.measurementsGenerated);
          downloadedAt = new Date().toISOString();
          await sleep(250);
        }
        plans[key] = {
          plan_id: p.id,
          iso3: (p.locations || []).map((l) => l.iso3).find((iso) => isoSet.has(iso)),
          code: p.planVersion?.code || p.code || null,
          name: p.planVersion?.name || p.name || null,
          year: String(year),
          start: String(p.planVersion?.startDate || "").slice(0, 10) || null,
          end: String(p.planVersion?.endDate || "").slice(0, 10) || null,
          monitoring_generated: Boolean(generated),
          fingerprint,
          downloaded_at: downloadedAt,
          health: health || null,
          plan_totals: planTotals || null,
          source: "OCHA Response Monitoring (HPC)"
        };
        await sleep(250);
      } catch (err) {
        errors.push(`${p.planVersion?.code || p.id}: ${err.message}`);
        if (previous[key]) plans[key] = previous[key];
      }
    }
  }
  return { plans, errors };
}

async function fetchSsaCountry(ssaId, startDate, endDate) {
  const q = { countryList: ssaId, WhoRegionList: 0, typeList: 0 };
  const counts = await getJson(`${SSA_BASE}/GetDashboardCount`, { ...q, startDate, endDate });
  const annual = await getJson(`${SSA_BASE}/GetAnnualData`, { ...q, start: startDate, end: endDate });
  const monthStart = new Date(new Date(endDate).getTime() - 365 * 864e5).toISOString().slice(0, 10);
  const monthly = await getJson(`${SSA_BASE}/GetAttackDatabyTime`, { ...q, startDate: monthStart, endDate });
  // Same period last year, so "this year so far" is compared like with like.
  const prevStart = `${Number(startDate.slice(0, 4)) - 1}${startDate.slice(4)}`;
  const prevEnd = `${Number(endDate.slice(0, 4)) - 1}${endDate.slice(4)}`;
  const prevCounts = await getJson(`${SSA_BASE}/GetDashboardCount`, { ...q, startDate: prevStart, endDate: prevEnd });
  if (!Array.isArray(counts) || !Array.isArray(prevCounts)) {
    throw new Error("Unexpected SSA response shape");
  }
  const num = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error("Non-numeric SSA value");
    return n;
  };
  const pick = (list, item) => num(list.find((x) => x.ITEM === item)?.TOTALCOUNT ?? 0);
  return {
    ytd: { attacks: pick(counts, "TOTALATTACKS"), deaths: pick(counts, "TOTALDEATH"), injuries: pick(counts, "TOTALINJURED") },
    prev_ytd: { attacks: pick(prevCounts, "TOTALATTACKS"), deaths: pick(prevCounts, "TOTALDEATH"), injuries: pick(prevCounts, "TOTALINJURED"), start: prevStart, end: prevEnd },
    annual: (Array.isArray(annual) ? annual : []).map((a) => ({ year: num(a.ATTACKYEAR), attacks: num(a.TOTALATTACKS), deaths: num(a.TOTALDEATHS), injuries: num(a.TOTALINJURED) })),
    monthly: (Array.isArray(monthly) ? monthly : []).map((m) => ({ year: num(m.ATTACKYEAR), month: String(m.ATTACKMONTH).slice(0, 3), attacks: num(m.TOTALCOUNT) }))
  };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === "\"" && line[i + 1] === "\"") { cur += "\""; i += 1; }
      else if (ch === "\"") quoted = false;
      else cur += ch;
    } else if (ch === "\"") quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function loadGrading() {
  if (!fs.existsSync(GRADING_FILE)) return { rows: [], updated_at: null };
  const lines = fs.readFileSync(GRADING_FILE, "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  if (lines.length < 2) return { rows: [], updated_at: fs.statSync(GRADING_FILE).mtime.toISOString() };
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] || ""]));
  }).filter((r) => r.iso3 && r.grade);
  return { rows, updated_at: fs.statSync(GRADING_FILE).mtime.toISOString() };
}

// Transparent, rule-based humanitarian classification. It is a DHM triage aid,
// not a WHO grade. Every point comes from a named, verified indicator.
function classifyCountry(row) {
  const points = [];
  const add = (criterion, value, score) => { if (score > 0) points.push({ criterion, value, score }); };
  const informClass = row.inform_risk?.risk_class;
  if (informClass >= 5) add("INFORM Risk class very high", row.inform_risk.overall, 1);

  const lastPlan = !row.health_in_need && row.health_outdated?.counts_for_tier ? row.health_outdated : null;
  const healthPin = row.health_in_need?.value ?? lastPlan?.value ?? null;
  const pinNote = lastPlan ? ` (last plan, ${lastPlan.year})` : "";
  if (healthPin >= 2000000) add(`People in need of health assistance 2 million or more${pinNote}`, healthPin, 2);
  else if (healthPin >= 500000) add(`People in need of health assistance 500,000 or more${pinNote}`, healthPin, 1);

  const ipcShare = row.ipc && !row.ipc.stale ? row.ipc.fraction : null;
  if (ipcShare != null) {
    if (ipcShare >= 0.2) add("IPC/CH Phase 3+ 20% or more of the analysed population", ipcShare, 2);
    else if (ipcShare >= 0.1) add("IPC/CH Phase 3+ 10% or more of the analysed population", ipcShare, 1);
  }

  const freshIdps = row.idps && !row.idps.stale ? Number(row.idps.value) || 0 : null;
  const refugees = row.refugees ? Number(row.refugees.value) || 0 : null;
  const displaced = freshIdps == null && refugees == null ? null : (freshIdps || 0) + (refugees || 0);
  if (displaced >= 1000000) add("IDPs + refugees hosted 1 million or more", displaced, 2);
  else if (displaced >= 250000) add("IDPs + refugees hosted 250,000 or more", displaced, 1);

  const ssa = row.attacks;
  if (ssa && (ssa.ytd.attacks >= 10 || ssa.ytd.deaths > 0)) add("WHO SSA: 10+ attacks on health care this year or any deaths", ssa.ytd.attacks, 1);

  const total = points.reduce((sum, p) => sum + p.score, 0);
  const available = [informClass, healthPin, ipcShare, displaced].filter((v) => v != null).length;
  const missing = [];
  if (informClass == null) missing.push("no INFORM Risk score");
  if (healthPin == null) missing.push(row.health_outdated ? `no humanitarian plan since ${row.health_outdated.year}` : "no humanitarian plan");
  if (ipcShare == null) missing.push(row.ipc?.stale ? "IPC/CH analysis older than 18 months" : "no IPC/CH analysis");
  if (displaced == null) missing.push(row.idps?.stale ? "displacement figure outdated" : "no displacement figure");
  let level;
  if (available < 3) level = "Insufficient data";
  else if (total >= 6) level = "Major";
  else if (total >= 3) level = "Severe";
  else level = "Moderate";
  return { level, score: total, max_score: 8, indicators_available: available, points, missing, uses_last_plan: Boolean(lastPlan && healthPin != null) };
}

function profileRowFor(profile, name) {
  if (!profile?.rows) return null;
  const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
  return profile.rows.find((r) => norm(r.country) === norm(name)) || null;
}

function buildCountryRows(cache, reference, profile, grading, now = new Date()) {
  const ftsByIso = {};
  (cache.fts || []).forEach((p) => {
    String(p.iso3 || "").split(",").filter(Boolean).forEach((iso) => {
      if (!ftsByIso[iso] && !p.error) ftsByIso[iso] = p;
    });
  });

  return allReferenceCountries(reference).map((c) => {
    const h = cache.hapi?.[c.iso3] || {};
    const prof = profileRowFor(profile, c.profile_name || c.name);
    const fts = ftsByIso[c.iso3] || null;
    const ssa = cache.ssa?.[c.iso3] || null;
    const grades = grading.rows.filter((g) => g.iso3 === c.iso3);

    const Y = now.getUTCFullYear();
    const minYear = String(Y - 1);
    const hapiInterCurrent = h.intersectoral && String(h.intersectoral.year) >= minYear;
    const HAPI_SRC = "OCHA HNRP via HDX HAPI";
    const PROFILE_SRC = "FCV country profile (DHM, from HNRP)";
    const hapiHist = h.health_history && Object.keys(h.health_history).length
      ? h.health_history
      : h.health ? { [String(h.health.year)]: { ...h.health, year: String(h.health.year) } } : {};
    // Annual response plans (codes starting with H) come first; flash appeals and
    // other time-bound plans (F, O) only count while they are running.
    const isAnnual = (p) => /^H/i.test(String(p.code || ""));
    const hpcPlans = Object.values(cache.hpc?.plans || {})
      .filter((p) => p.iso3 === c.iso3 && p.health)
      .sort((a, b) => String(b.year).localeCompare(String(a.year))
        || Number(isAnnual(b)) - Number(isAnnual(a))
        || String(b.end || "").localeCompare(String(a.end || "")));
    const hpcLabel = (p) => `OCHA Response Monitoring (HPC), ${p.code || p.name}`;
    const planActive = (p) => Boolean(p.end) && new Date(`${p.end}T23:59:59Z`) >= now;
    // A plan of this year counts if it is annual or still running. Last year's annual
    // plan carries over until this year's plan is published (as HDX HAPI's does).
    const hpcCurrent = hpcPlans.find((p) => p.year === String(Y) && p.health.in_need != null && (isAnnual(p) || planActive(p)));
    const hpcLastYear = hpcPlans.find((p) => p.year === minYear && p.health.in_need != null && (isAnnual(p) || planActive(p)));
    const fromHpc = (p) => ({ in_need: p.health.in_need, targeted: p.health.targeted, year: p.year, source: hpcLabel(p), kind: "hpc", plan: p });

    // Current health need, in order of preference. OCHA's planning system (HPC)
    // holds the current, possibly revised, plan; HDX HAPI can lag behind a
    // mid-year revision. Targets and reach come from the same plan as the need.
    const needCandidates = [
      hpcCurrent && fromHpc(hpcCurrent),
      hapiHist[String(Y)]?.in_need != null && { ...hapiHist[String(Y)], year: String(Y), source: HAPI_SRC, kind: "hapi" },
      hpcLastYear && fromHpc(hpcLastYear),
      hapiHist[minYear]?.in_need != null && { ...hapiHist[minYear], year: minYear, source: HAPI_SRC, kind: "hapi" },
      prof?.health_people_in_need != null && { in_need: prof.health_people_in_need, targeted: prof.health_people_targeted, reached: prof.health_people_reached, year: "2026", source: PROFILE_SRC, kind: "profile" }
    ].filter(Boolean);
    const need = needCandidates[0] || null;
    // When HDX HAPI holds a different figure for the same plan year (for example
    // the original version of a plan revised mid-year), keep it for reference.
    const hapiSameYear = need && need.kind === "hpc" ? hapiHist[need.year] : null;
    const altFigure = hapiSameYear?.in_need != null && need.in_need
      && Math.abs(hapiSameYear.in_need - need.in_need) / need.in_need > 0.1
      ? { value: hapiSameYear.in_need, source: HAPI_SRC, note: "HDX HAPI holds a different figure for this plan year, usually the plan before a revision" }
      : null;
    const healthInNeed = need ? { value: need.in_need, year: need.year, source: need.source, plan_code: need.plan?.code || null, alt: altFigure } : null;
    const healthTargeted = need && need.targeted != null
      ? { value: need.targeted, year: need.year, source: need.source }
      : !need && prof?.health_people_targeted != null
        ? { value: prof.health_people_targeted, year: "2026", source: PROFILE_SRC }
        : null;
    const reachOk = (p) => p?.health?.reach?.reached != null
      && (!p.health.targeted || (p.health.reach.reached / p.health.targeted >= 0.01 && p.health.reach.reached / p.health.targeted <= 1.5));
    const healthReached = need && need.reached != null
      ? { value: need.reached, year: need.year, source: need.source }
      : need?.plan && need.year === String(Y) && reachOk(need.plan)
        ? { value: need.plan.health.reach.reached, year: need.year, source: need.source, period_end: need.plan.health.reach.period_end }
        : null;

    // Same-source figure from the previous plan year, for the year-on-year comparison.
    let healthPrevious = null;
    if (need && need.year === String(Y)) {
      const prevHpc = hpcPlans.find((p) => p.year === minYear && p.health.in_need != null && isAnnual(p));
      const prevHapi = hapiHist[minYear]?.in_need != null ? { value: hapiHist[minYear].in_need, year: minYear, source: HAPI_SRC } : null;
      const prevFromHpc = prevHpc ? { value: prevHpc.health.in_need, year: minYear, source: hpcLabel(prevHpc) } : null;
      healthPrevious = need.kind === "hpc" ? (prevFromHpc || prevHapi) : (prevHapi || prevFromHpc);
    }

    // No current plan: keep the last plan's figure for reference. An annual plan's
    // figure counts toward the triage tier for up to LAST_PLAN_MAX_AGE_MONTHS after
    // it ended; a flash appeal's does not count once it has ended. It is never
    // added to regional totals.
    let healthLastPlan = null;
    if (!healthInNeed) {
      const lastCandidates = [
        ...Object.values(hapiHist).filter((x) => x.in_need != null).map((x) => ({
          value: x.in_need, year: String(x.year), source: HAPI_SRC, annual: true,
          plan_end: x.period_end || `${x.year}-12-31`, plan_name: `Humanitarian plan ${x.year}`
        })),
        ...hpcPlans.filter((p) => p.health.in_need != null).map((p) => ({
          value: p.health.in_need, year: p.year, source: hpcLabel(p), annual: isAnnual(p),
          plan_end: p.end || `${p.year}-12-31`, plan_name: p.name
        }))
      ].sort((a, b) => String(b.plan_end).localeCompare(String(a.plan_end))
        || Number(/HPC/.test(b.source)) - Number(/HPC/.test(a.source)));
      if (lastCandidates.length) {
        const last = lastCandidates[0];
        const age = monthsBetween(last.plan_end, now);
        healthLastPlan = {
          ...last,
          months_since_end: age,
          counts_for_tier: last.annual && age != null && age <= LAST_PLAN_MAX_AGE_MONTHS,
          rule: last.annual
            ? `Annual plan figures count toward the triage tier for up to ${LAST_PLAN_MAX_AGE_MONTHS} months after the plan ended`
            : "Flash appeal figures are not used once the appeal has ended"
        };
      }
    }

    // A reported reach below 1% or above 150% of the target is treated as a
    // reporting error and not used.
    const plausibleReach = reachOk;
    const withReach = hpcPlans
      .filter((p) => p.health.reach?.reached != null)
      .sort((a, b) => String(b.health.reach.period_end).localeCompare(String(a.health.reach.period_end)));
    const reachPlan = withReach.find(plausibleReach);
    const reachExcluded = withReach.find((p) => !plausibleReach(p) && (!reachPlan || String(p.health.reach.period_end) > String(reachPlan.health.reach.period_end)));
    const healthReachLatest = reachPlan
      ? {
          year: reachPlan.year,
          reached: reachPlan.health.reach.reached,
          targeted: reachPlan.health.targeted,
          in_need: reachPlan.health.in_need,
          period_start: reachPlan.health.reach.period_start,
          period_end: reachPlan.health.reach.period_end,
          plan_code: reachPlan.code,
          plan_name: reachPlan.name,
          plan_end: reachPlan.end,
          decreased: Boolean(reachPlan.health.reach.decreased),
          full_year: reachPlan.end
            ? (new Date(reachPlan.end) - new Date(reachPlan.health.reach.period_end)) / 864e5 <= REACH_YEAR_END_TOLERANCE_DAYS
            : false,
          source: "OCHA Response Monitoring (HPC)"
        }
      : null;
    // All-sector need from the same plan as the health need. A plan total smaller
    // than the health figure is a data error, so HDX HAPI is used instead.
    const planForTotals = need?.plan || hpcCurrent || null;
    const hpcPlanCurrent = planForTotals?.plan_totals?.in_need != null
      && (!need || planForTotals.plan_totals.in_need >= need.in_need) ? planForTotals : null;
    const peopleInNeed = hpcPlanCurrent
      ? { value: hpcPlanCurrent.plan_totals.in_need, year: hpcPlanCurrent.year, source: hpcLabel(hpcPlanCurrent) }
      : h.intersectoral?.in_need != null && hapiInterCurrent
      ? { value: h.intersectoral.in_need, year: h.intersectoral.year, source: h.intersectoral.source }
      : prof?.people_in_need != null
        ? { value: prof.people_in_need, year: "2026", source: "FCV country profile (DHM, from HNRP)" }
        : null;

    let idps = null;
    const idpAge = h.idps?.date ? monthsBetween(h.idps.date, now) : null;
    const dtmPartial = h.idps && prof?.idps != null && h.idps.total < 0.5 * prof.idps;
    if (h.idps && idpAge != null && idpAge <= IDP_MAX_AGE_MONTHS && !dtmPartial) {
      idps = { value: h.idps.total, date: h.idps.date, source: h.idps.source };
    } else if (dtmPartial && idpAge != null && idpAge <= IDP_MAX_AGE_MONTHS) {
      idps = {
        value: prof.idps,
        date: "2026",
        source: "HNRP 2026 planning figure (DHM profile)",
        note: `IOM DTM via HDX HAPI covers part of the country only (${h.idps.operation}: ${Math.round(h.idps.total).toLocaleString("en-US")})`
      };
    } else if (prof?.idps != null) {
      idps = { value: prof.idps, date: "2026", source: "FCV country profile (DHM, from HNRP)" };
    } else if (h.idps) {
      idps = { value: h.idps.total, date: h.idps.date, source: h.idps.source, stale: true };
    }
    const refugees = h.refugees
      ? { value: h.refugees.total, year: h.refugees.year, source: h.refugees.source }
      : prof?.refugees_asylum_seekers != null
        ? { value: prof.refugees_asylum_seekers, year: "2026", source: "FCV country profile (DHM)" }
        : null;

    const ipcPick = (() => {
      const cur = h.ipc_current;
      const proj = h.ipc_projection;
      const candidates = [cur && { ...cur, kind: "current" }, proj && { ...proj, kind: proj.type }].filter(Boolean);
      if (!candidates.length) return null;
      // Latest analysis period that has already started; otherwise the earliest projection.
      const started = candidates.filter((x) => new Date(x.period_start) <= now);
      const chosen = (started.length ? started : candidates).sort((a, b) => String(b.period_start).localeCompare(String(a.period_start)))[0];
      const age = monthsBetween(chosen.period_end, now);
      return { ...chosen, stale: age != null && age > IPC_MAX_AGE_MONTHS };
    })();

    const row = {
      iso3: c.iso3,
      country: c.name,
      group: c.group,
      track: c.track || null,
      plan: fts
        ? { code: fts.code, name: fts.name, plan_id: fts.plan_id }
        : (h.appeals || []).find((a) => !/regional/i.test(a.type || ""))
          ? (() => { const a = h.appeals.find((x) => !/regional/i.test(x.type || "")); return { code: a.code, name: a.name, year: a.year }; })()
          : prof?.plan_type ? { code: null, name: prof.plan_type } : null,
      people_in_need: peopleInNeed,
      health_in_need: healthInNeed,
      health_targeted: healthTargeted,
      health_reached: healthReached,
      health_in_need_previous: healthPrevious,
      health_outdated: healthLastPlan,
      health_reach_latest: healthReachLatest,
      health_reach_excluded: reachExcluded
        ? { plan_code: reachExcluded.code, plan_name: reachExcluded.name, year: reachExcluded.year, reached: reachExcluded.health.reach.reached, targeted: reachExcluded.health.targeted, reason: "Reported reach is below 1% or above 150% of the target; treated as a reporting error" }
        : null,
      health_funding: fts && fts.health_requirements_usd != null
        ? {
            requirements_usd: fts.health_requirements_usd,
            funding_usd: fts.health_funding_usd || 0,
            pct: fts.health_requirements_usd ? (fts.health_funding_usd || 0) / fts.health_requirements_usd : null,
            gap_usd: Math.max(0, fts.health_requirements_usd - (fts.health_funding_usd || 0)),
            plan_requirements_usd: fts.plan_requirements_usd,
            plan_funding_usd: fts.plan_funding_usd,
            unspecified_funding_usd: fts.unspecified_funding_usd,
            source: "OCHA FTS",
            cluster_name: fts.health_cluster
          }
        : null,
      appeals: h.appeals || [],
      idps,
      refugees,
      ipc: ipcPick,
      inform_risk: h.inform_risk || null,
      attacks: ssa ? { ...ssa, source: "WHO SSA" } : null,
      who_grades: grades,
      source_errors: h.errors || []
    };
    row.classification = classifyCountry(row);
    return row;
  });
}

function sumField(rows, getter) {
  return rows.reduce((s, r) => {
    const v = getter(r);
    return Number.isFinite(v) ? s + v : s;
  }, 0);
}

function buildRegionalKpis(rows) {
  const fcv = rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated");
  const withFunding = fcv.filter((r) => r.health_funding);
  const req = sumField(withFunding, (r) => r.health_funding.requirements_usd);
  const funded = sumField(withFunding, (r) => r.health_funding.funding_usd);
  const reachRows = fcv.filter((r) => r.health_reached?.value != null && r.health_targeted?.value);
  return {
    scope: "13 FCV countries (9 Prioritized + 4 Accelerated)",
    graded_emergencies: sumField(fcv, (r) => r.who_grades.length),
    graded_countries: fcv.filter((r) => r.who_grades.length).length,
    health_in_need: sumField(fcv, (r) => r.health_in_need?.value),
    health_in_need_countries: fcv.filter((r) => r.health_in_need?.value != null).length,
    people_in_need: sumField(fcv, (r) => r.people_in_need?.value),
    health_targeted: sumField(fcv, (r) => r.health_targeted?.value),
    health_reached: reachRows.length ? sumField(reachRows, (r) => r.health_reached.value) : null,
    health_reach_pct: reachRows.length ? sumField(reachRows, (r) => r.health_reached.value) / sumField(reachRows, (r) => r.health_targeted.value) : null,
    health_reach_countries: reachRows.length,
    health_requirements_usd: req,
    health_funding_usd: funded,
    health_funding_pct: req ? funded / req : null,
    health_gap_usd: Math.max(0, req - funded),
    health_funding_countries: withFunding.length,
    idps: sumField(fcv, (r) => (r.idps && !r.idps.stale ? r.idps.value : null)),
    refugees: sumField(fcv, (r) => r.refugees?.value),
    attacks_ytd: sumField(fcv, (r) => r.attacks?.ytd?.attacks),
    attack_deaths_ytd: sumField(fcv, (r) => r.attacks?.ytd?.deaths),
    attack_injuries_ytd: sumField(fcv, (r) => r.attacks?.ytd?.injuries),
    attacks_countries_monitored: fcv.filter((r) => r.attacks).length,
    health_in_need_previous_year: fcv
      .filter((r) => r.health_in_need && r.people_in_need && String(r.health_in_need.year) !== String(r.people_in_need.year))
      .map((r) => ({ country: r.country, year: r.health_in_need.year })),
    major_crises: fcv.filter((r) => r.classification.level === "Major").map((r) => r.country),
    severe_crises: fcv.filter((r) => r.classification.level === "Severe").map((r) => r.country)
  };
}

function readCache() {
  for (const file of [CACHE_FILE, `${CACHE_FILE}.bak`]) {
    try {
      if (fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      }
    } catch (err) {
      console.error(`[strategic] could not read ${path.basename(file)}: ${err.message}`);
    }
  }
  return { hapi: {}, fts: [], ssa: {}, fetched_at: {} };
}

function writeCache(cache) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), "utf8");
  if (fs.existsSync(CACHE_FILE)) {
    fs.copyFileSync(CACHE_FILE, `${CACHE_FILE}.bak`);
  }
  fs.renameSync(tmp, CACHE_FILE);
}

let refreshPromise = null;
// Visible on the Data Health page so a failing source can be diagnosed without server logs.
const refreshState = { running: false, started_at: null, finished_at: null, step: null, errors: [] };
function noteError(source, message) {
  refreshState.errors.push({ source, message: String(message).slice(0, 200), at: new Date().toISOString() });
  if (refreshState.errors.length > 30) refreshState.errors.shift();
}

async function refreshStrategicCache({ log = console.log } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshState.running = true;
  refreshState.started_at = new Date().toISOString();
  refreshState.errors = [];
  refreshPromise = (async () => {
    const reference = loadReference();
    const countries = allReferenceCountries(reference);
    const cache = readCache();
    cache.fetched_at = cache.fetched_at || {};
    cache.status = cache.status || {};
    const nowIso = new Date().toISOString();
    cache.last_attempt_at = nowIso;

    // HDX HAPI, one country at a time to respect rate limits.
    let hapiOk = 0;
    refreshState.step = "hapi";
    let hapiConsecutiveFailures = 0;
    for (const c of countries) {
      if (hapiConsecutiveFailures >= 3) {
        noteError("hapi", "Stopped after 3 countries failed in a row; last good values kept.");
        break;
      }
      try {
        const result = await fetchHapiCountry(c.iso3);
        const failedAll = result.errors.length >= 6;
        if (failedAll) {
          hapiConsecutiveFailures += 1;
          noteError("hapi", `${c.iso3}: ${result.errors[0]}`);
        } else {
          hapiConsecutiveFailures = 0;
        }
        if (!failedAll) {
          // Keep the last good value for any endpoint that failed this time.
          const previous = cache.hapi[c.iso3] || {};
          const fieldsByEndpoint = {
            needs: ["health", "health_history", "intersectoral"],
            funding: ["appeals"],
            idps: ["idps"],
            refugees: ["refugees"],
            "national-risk": ["inform_risk"],
            "food-security": ["ipc_current", "ipc_projection"]
          };
          result.errors.forEach((e) => {
            const endpoint = String(e).split(":")[0];
            (fieldsByEndpoint[endpoint] || []).forEach((field) => {
              if (previous[field] !== undefined) result[field] = previous[field];
            });
          });
          cache.hapi[c.iso3] = result;
          hapiOk += 1;
        }
      } catch (err) {
        hapiConsecutiveFailures += 1;
        noteError("hapi", `${c.iso3}: ${err.message}`);
        log(`[strategic] HAPI ${c.iso3} failed: ${err.message}`);
      }
    }
    if (hapiOk) cache.fetched_at.hapi = nowIso;
    cache.status.hapi = { ok: hapiOk, total: countries.length, checked_at: nowIso };

    // OCHA FTS health cluster funding.
    refreshState.step = "fts";
    try {
      const year = new Date().getFullYear();
      const fts = await fetchFtsHealth(year, new Set(countries.map((c) => c.iso3)));
      const usable = fts.filter((p) => !p.error && p.health_requirements_usd != null);
      // Switch to a new plan year only once its health requirements are published;
      // within a year, keep the last good entry for any plan that failed this time.
      if (usable.length && (cache.fts_year !== year || !cache.fts?.length)) {
        cache.fts = usable;
        cache.fts_year = year;
        cache.fetched_at.fts = nowIso;
      } else if (usable.length) {
        const byPlan = new Map((cache.fts || []).map((p) => [p.plan_id, p]));
        usable.forEach((p) => byPlan.set(p.plan_id, p));
        cache.fts = Array.from(byPlan.values());
        cache.fetched_at.fts = nowIso;
      }
      cache.status.fts = { ok: fts.filter((p) => !p.error).length, total: fts.length, checked_at: nowIso };
    } catch (err) {
      cache.status.fts = { ok: 0, error: err.message, checked_at: nowIso };
      noteError("fts", err.message);
    }

    // OCHA Response Monitoring: health caseloads and reach for this year's and
    // last year's country plans; two years back only where no recent plan exists.
    refreshState.step = "hpc";
    try {
      const year = new Date().getFullYear();
      const isoSet = new Set(countries.map((c) => c.iso3));
      const previousPlans = cache.hpc?.plans || {};
      const recent = await fetchHpcHealth([year, year - 1], isoSet, previousPlans);
      const covered = new Set(Object.values(recent.plans).map((p) => p.iso3));
      const missing = new Set([...isoSet].filter((iso) => !covered.has(iso)));
      const older = missing.size ? await fetchHpcHealth([year - 2], missing, previousPlans) : { plans: {}, errors: [] };
      const plans = { ...older.plans, ...recent.plans };
      const errors = [...recent.errors, ...older.errors];
      errors.slice(0, 5).forEach((e) => noteError("hpc", e));
      if (Object.keys(plans).length) {
        cache.hpc = { plans, years: [year, year - 1, year - 2] };
        cache.fetched_at.hpc = nowIso;
      }
      cache.status.hpc = { ok: Object.keys(plans).length, errors: errors.length, checked_at: nowIso };
    } catch (err) {
      cache.status.hpc = { ok: 0, error: err.message, checked_at: nowIso };
      noteError("hpc", err.message);
    }

    // WHO SSA, countries that SSA monitors.
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    let ssaOk = 0;
    refreshState.step = "ssa";
    let ssaFailures = 0;
    for (const c of countries.filter((x) => x.ssa_id)) {
      if (ssaFailures >= 2 && ssaOk === 0) {
        noteError("ssa", "Stopped after 2 countries failed; last good values kept.");
        break;
      }
      try {
        cache.ssa[c.iso3] = { ssa_id: c.ssa_id, ...(await fetchSsaCountry(c.ssa_id, yearStart, today)), period: { start: yearStart, end: today } };
        ssaOk += 1;
        await sleep(250);
      } catch (err) {
        ssaFailures += 1;
        noteError("ssa", `${c.iso3}: ${err.message}`);
        log(`[strategic] SSA ${c.iso3} failed: ${err.message}`);
      }
    }
    if (ssaOk) cache.fetched_at.ssa = nowIso;
    cache.status.ssa = { ok: ssaOk, total: countries.filter((x) => x.ssa_id).length, checked_at: nowIso };

    writeCache(cache);
    log(`[strategic] refresh done: HAPI ${hapiOk}/${countries.length}, FTS ${cache.status.fts?.ok ?? 0}, SSA ${ssaOk}`);
    return cache;
  })().catch((err) => {
    noteError("refresh", err.message);
    throw err;
  }).finally(() => {
    refreshPromise = null;
    refreshState.running = false;
    refreshState.step = null;
    refreshState.finished_at = new Date().toISOString();
  });
  return refreshPromise;
}

// ---------- Monthly KPI snapshots ----------
// One snapshot per calendar month (the latest taken in that month wins), so the
// dashboard can show change since the end of last month.

function monthKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 7);
}

// ISO week key, e.g. 2026-W44 (weeks start on Monday, UTC).
function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(new Date(date).getUTCFullYear(), new Date(date).getUTCMonth(), new Date(date).getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
const HISTORY_MAX_WEEKS = 16;

function snapshotFromRows(rows, takenAt = new Date()) {
  const countries = {};
  rows.forEach((r) => {
    countries[r.iso3] = {
      level: r.classification?.level || null,
      score: r.classification?.score ?? null,
      health_in_need: r.health_in_need?.value ?? null,
      health_in_need_year: r.health_in_need?.year ?? null,
      health_in_need_source: r.health_in_need ? (r.health_in_need.plan_code || r.health_in_need.source) : null,
      health_in_need_publisher: r.health_in_need?.source || null,
      idps_date: r.idps && !r.idps.stale ? r.idps.date || null : null,
      ipc_period_end: r.ipc && !r.ipc.stale ? r.ipc.period_end || null : null,
      attacks_year: r.attacks?.period?.start ? String(r.attacks.period.start).slice(0, 4) : null,
      people_in_need: r.people_in_need?.value ?? null,
      health_requirements_usd: r.health_funding?.requirements_usd ?? null,
      health_funding_usd: r.health_funding?.funding_usd ?? null,
      idps: r.idps && !r.idps.stale ? r.idps.value : null,
      refugees: r.refugees?.value ?? null,
      displaced: ((r.idps && !r.idps.stale ? Number(r.idps.value) || 0 : 0) + (Number(r.refugees?.value) || 0)) || null,
      ipc_fraction: r.ipc && !r.ipc.stale ? r.ipc.fraction : null,
      attacks_ytd: r.attacks?.ytd?.attacks ?? null,
      attack_deaths_ytd: r.attacks?.ytd?.deaths ?? null,
      attacks_period_end: r.attacks?.period?.end ?? null
    };
  });
  const iso = new Date(takenAt).toISOString();
  return { month: monthKey(takenAt), week: weekKey(takenAt), taken_at: iso, countries };
}

function latestPer(list, key) {
  const by = new Map();
  list.forEach((snap) => {
    if (!snap?.[key] || !snap.countries) return;
    const cur = by.get(snap[key]);
    if (!cur || String(snap.taken_at) > String(cur.taken_at)) by.set(snap[key], snap);
  });
  return Array.from(by.values()).sort((a, b) => a[key].localeCompare(b[key]));
}

// Monthly snapshots (latest in each month) for the month-on-month arrows, and
// weekly snapshots (latest in each ISO week) for the bulletin's "since last week".
function mergeHistory(...histories) {
  const all = histories.filter(Boolean);
  const snapshots = latestPer(all.flatMap((h) => h.snapshots || []), "month").slice(-HISTORY_MAX_MONTHS);
  const weekly = latestPer(all.flatMap((h) => [...(h.weekly || []), ...(h.snapshots || [])]).filter((x) => x.week), "week").slice(-HISTORY_MAX_WEEKS);
  return { version: 2, note: "Snapshots of the strategic KPIs: one per month and one per ISO week (the latest taken in each). Written by the dashboard server and the GitHub refresh job.", snapshots, weekly };
}

function readHistoryFile(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`[strategic] could not read ${path.basename(file)}: ${err.message}`);
  }
  return null;
}

function readHistory() {
  return mergeHistory(readHistoryFile(HISTORY_FILE), readHistoryFile(LOCAL_HISTORY_FILE));
}

function writeHistory(history, file = LOCAL_HISTORY_FILE) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(history, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// Records this month's snapshot from the rows the dashboard currently shows.
// At most one write every SNAPSHOT_MIN_HOURS, so the repository is not
// committed to every hour for an unchanged snapshot.
const SNAPSHOT_MIN_HOURS = 20;
// target "repo" writes the committed file (GitHub job only); the server uses "local".
function recordSnapshot(profile, now = new Date(), { target = "local" } = {}) {
  const file = target === "repo" ? HISTORY_FILE : LOCAL_HISTORY_FILE;
  const existing = target === "repo" ? mergeHistory(readHistoryFile(HISTORY_FILE)) : readHistory();
  const current = existing.snapshots.find((x) => x.month === monthKey(now));
  if (current && (now.getTime() - new Date(current.taken_at).getTime()) / 36e5 < SNAPSHOT_MIN_HOURS) {
    return existing;
  }
  const rows = buildCountryRows(readCache(), loadReference(), profile, loadGrading(), now);
  const snap = snapshotFromRows(rows, now);
  const history = mergeHistory(existing, { snapshots: [snap], weekly: [snap] });
  writeHistory(history, file);
  return history;
}

// Pulls snapshots committed to the repository (by the GitHub job) so a new
// server instance does not lose earlier months.
async function syncRemoteHistory() {
  if (!HISTORY_URL || /^off$/i.test(HISTORY_URL)) return readHistory();
  try {
    const remote = await getJson(HISTORY_URL, {}, 1);
    if (!remote || !Array.isArray(remote.snapshots)) throw new Error("Unexpected history shape");
    const merged = mergeHistory(readHistoryFile(LOCAL_HISTORY_FILE), remote);
    writeHistory(merged, LOCAL_HISTORY_FILE);
    return readHistory();
  } catch (err) {
    noteError("history", `remote snapshots: ${err.message}`);
    return readHistory();
  }
}

// The comparison base is the latest snapshot from an earlier month.
function historyForPayload(history, now = new Date()) {
  const current = monthKey(now);
  const earlier = (history.snapshots || []).filter((s) => s.month < current);
  const thisWeek = weekKey(now);
  const earlierWeeks = (history.weekly || []).filter((s) => s.week < thisWeek);
  return {
    week_base: earlierWeeks.length ? earlierWeeks[earlierWeeks.length - 1] : null,
    current_week: thisWeek,
    months: (history.snapshots || []).map((s) => s.month),
    first_month: history.snapshots?.[0]?.month || null,
    latest_taken_at: history.snapshots?.length ? history.snapshots[history.snapshots.length - 1].taken_at : null,
    base: earlier.length ? earlier[earlier.length - 1] : null
  };
}

// Hours since the last refresh attempt, successful or not, so a source that keeps
// failing does not trigger a full refresh on every run.
function hoursSinceAttempt(cache) {
  const t = new Date(cache.last_attempt_at || 0).getTime();
  const fallback = cacheAgeHours(cache);
  return Number.isFinite(t) && t > 0 ? Math.min((Date.now() - t) / 36e5, fallback) : fallback;
}

function cacheAgeHours(cache) {
  const stamps = Object.values(cache.fetched_at || {}).map((s) => new Date(s).getTime()).filter(Number.isFinite);
  if (!stamps.length) return Infinity;
  return (Date.now() - Math.min(...stamps)) / 36e5;
}

function buildStrategicPayload(profile) {
  const reference = loadReference();
  const cache = readCache();
  const grading = loadGrading();
  const rows = buildCountryRows(cache, reference, profile, grading);
  return {
    generated_at: new Date().toISOString(),
    reference: { tracks: reference.tracks, notes: reference.notes, source: reference.source },
    kpis: buildRegionalKpis(rows),
    countries: rows,
    grading: { rows: grading.rows, updated_at: grading.updated_at, file: "data/who-grading.csv" },
    sources: {
      hapi: { name: "OCHA HDX HAPI", url: "https://hapi.humdata.org", fetched_at: cache.fetched_at?.hapi || null, status: cache.status?.hapi || null },
      fts: { name: "OCHA Financial Tracking Service", url: "https://fts.unocha.org", fetched_at: cache.fetched_at?.fts || null, year: cache.fts_year || null, status: cache.status?.fts || null },
      hpc: { name: "OCHA Response Monitoring (HPC)", url: "https://humanitarianaction.info", fetched_at: cache.fetched_at?.hpc || null, status: cache.status?.hpc || null },
      ssa: { name: "WHO Surveillance System for Attacks on Health Care", url: "https://extranet.who.int/ssa/Index.aspx", fetched_at: cache.fetched_at?.ssa || null, status: cache.status?.ssa || null },
      grading: { name: "WHO grading decisions (entered by DHM)", file: "data/who-grading.csv", updated_at: grading.updated_at },
      profile: { name: "FCV country profile workbook (DHM)", loaded_at: profile?.loaded_at || null },
      refresh: { ...refreshState, errors: refreshState.errors.slice(-10) }
    },
    classification_rules: {
      note: "DHM triage tier: a rule-based classification from verified indicators. It is not a WHO grade and does not replace the WHO grading process.",
      levels: { Major: "6 to 8 points", Severe: "3 to 5 points", Moderate: "0 to 2 points", "Insufficient data": "fewer than 3 of the 4 core indicators are current" },
      criteria: [
        "INFORM Risk class very high = 1 (EC JRC)",
        "People in need of health assistance: 2 million or more = 2, 500,000 or more = 1 (OCHA HNRP). Where a country has no current plan, the last annual plan's figure counts if that plan ended 24 months ago or less (a flash appeal's figure stops counting when the appeal ends); the tier is then marked provisional and the figure is never added to regional totals",
        "IPC/CH Phase 3+ share of the analysed population, analysis less than 18 months old: 20% or more = 2, 10% or more = 1",
        "IDPs (current figure) + refugees hosted: 1 million or more = 2, 250,000 or more = 1 (IOM DTM, UNHCR)",
        "WHO SSA: 10 or more attacks on health care this year, or any deaths = 1 (only where SSA is deployed)"
      ],
      core_indicators: ["INFORM Risk", "Health people in need", "IPC/CH Phase 3+", "Displacement"]
    },
    history: historyForPayload(readHistory()),
    cache_age_hours: cacheAgeHours(cache)
  };
}

module.exports = {
  REFRESH_HOURS,
  buildCountryRows,
  extractHealthFromPlan,
  snapshotFromRows,
  mergeHistory,
  historyForPayload,
  recordSnapshot,
  syncRemoteHistory,
  readHistory,
  hoursSinceAttempt,
  weekKey,
  buildStrategicPayload,
  refreshStrategicCache,
  readCache,
  cacheAgeHours,
  classifyCountry,
  loadGrading
};
