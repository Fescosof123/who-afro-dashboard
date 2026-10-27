"use strict";

// Strategic humanitarian KPIs for the WHO AFRO DHM dashboard.
//
// Every figure here comes from a verified publisher that owns the data:
//   - OCHA HDX HAPI (humanitarian needs, appeals funding, IDPs from IOM DTM,
//     refugees from UNHCR, INFORM Risk from EC JRC, IPC phases)
//   - OCHA Financial Tracking Service (health cluster requirements and funding)
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

const HAPI_BASE = "https://hapi.humdata.org/api/v2";
const FTS_BASE = "https://api.hpc.tools/v1/public";
const SSA_BASE = "https://extranet.who.int/ssa/Ref";

const REFRESH_HOURS = Number(process.env.STRATEGIC_REFRESH_HOURS || 12);
const REQUEST_TIMEOUT_MS = Number(process.env.STRATEGIC_REQUEST_TIMEOUT_MS || 20000);
const IDP_MAX_AGE_MONTHS = 24;
const IPC_MAX_AGE_MONTHS = 18;

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
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
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

  const healthPin = row.health_in_need?.value;
  if (healthPin >= 2000000) add("People in need of health assistance >= 2 million", healthPin, 2);
  else if (healthPin >= 500000) add("People in need of health assistance >= 500,000", healthPin, 1);

  const ipcShare = row.ipc && !row.ipc.stale ? row.ipc.fraction : null;
  if (ipcShare != null) {
    if (ipcShare >= 0.2) add("IPC/CH Phase 3+ >= 20% of the analysed population", ipcShare, 2);
    else if (ipcShare >= 0.1) add("IPC/CH Phase 3+ >= 10% of the analysed population", ipcShare, 1);
  }

  const freshIdps = row.idps && !row.idps.stale ? Number(row.idps.value) || 0 : null;
  const refugees = row.refugees ? Number(row.refugees.value) || 0 : null;
  const displaced = freshIdps == null && refugees == null ? null : (freshIdps || 0) + (refugees || 0);
  if (displaced >= 1000000) add("IDPs + refugees hosted >= 1 million", displaced, 2);
  else if (displaced >= 250000) add("IDPs + refugees hosted >= 250,000", displaced, 1);

  const ssa = row.attacks;
  if (ssa && (ssa.ytd.attacks >= 10 || ssa.ytd.deaths > 0)) add("WHO SSA: 10+ attacks on health care this year or any deaths", ssa.ytd.attacks, 1);

  const total = points.reduce((sum, p) => sum + p.score, 0);
  const available = [informClass, healthPin, ipcShare, displaced].filter((v) => v != null).length;
  let level;
  if (available < 3) level = "Insufficient data";
  else if (total >= 6) level = "Major";
  else if (total >= 3) level = "Severe";
  else level = "Moderate";
  return { level, score: total, max_score: 8, indicators_available: available, points };
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

    const minYear = String(now.getFullYear() - 1);
    const hapiHealthCurrent = h.health && String(h.health.year) >= minYear;
    const hapiInterCurrent = h.intersectoral && String(h.intersectoral.year) >= minYear;
    const healthInNeed = h.health?.in_need != null && hapiHealthCurrent
      ? { value: h.health.in_need, year: h.health.year, source: h.health.source }
      : prof?.health_people_in_need != null
        ? { value: prof.health_people_in_need, year: "2026", source: "FCV country profile (DHM, from HNRP)" }
        : null;
    const healthTargeted = h.health?.targeted != null && hapiHealthCurrent
      ? { value: h.health.targeted, year: h.health.year, source: h.health.source }
      : prof?.health_people_targeted != null
        ? { value: prof.health_people_targeted, year: "2026", source: "FCV country profile (DHM, from HNRP)" }
        : null;
    const healthReached = h.health?.reached != null && hapiHealthCurrent
      ? { value: h.health.reached, year: h.health.year, source: h.health.source }
      : prof?.health_people_reached != null
        ? { value: prof.health_people_reached, year: "2026", source: "FCV country profile (DHM, from HNRP)" }
        : null;
    const peopleInNeed = h.intersectoral?.in_need != null && hapiInterCurrent
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
      health_outdated: !hapiHealthCurrent && h.health?.in_need != null && !healthInNeed
        ? { value: h.health.in_need, year: h.health.year, source: h.health.source }
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

async function refreshStrategicCache({ log = console.log } = {}) {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const reference = loadReference();
    const countries = allReferenceCountries(reference);
    const cache = readCache();
    cache.fetched_at = cache.fetched_at || {};
    cache.status = cache.status || {};
    const nowIso = new Date().toISOString();

    // HDX HAPI, one country at a time to respect rate limits.
    let hapiOk = 0;
    for (const c of countries) {
      try {
        const result = await fetchHapiCountry(c.iso3);
        const failedAll = result.errors.length >= 6;
        if (!failedAll) {
          // Keep the last good value for any endpoint that failed this time.
          const previous = cache.hapi[c.iso3] || {};
          const fieldsByEndpoint = {
            needs: ["health", "intersectoral"],
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
        log(`[strategic] HAPI ${c.iso3} failed: ${err.message}`);
      }
    }
    if (hapiOk) cache.fetched_at.hapi = nowIso;
    cache.status.hapi = { ok: hapiOk, total: countries.length, checked_at: nowIso };

    // OCHA FTS health cluster funding.
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
    }

    // WHO SSA, countries that SSA monitors.
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${today.slice(0, 4)}-01-01`;
    let ssaOk = 0;
    for (const c of countries.filter((x) => x.ssa_id)) {
      try {
        cache.ssa[c.iso3] = { ssa_id: c.ssa_id, ...(await fetchSsaCountry(c.ssa_id, yearStart, today)), period: { start: yearStart, end: today } };
        ssaOk += 1;
        await sleep(250);
      } catch (err) {
        log(`[strategic] SSA ${c.iso3} failed: ${err.message}`);
      }
    }
    if (ssaOk) cache.fetched_at.ssa = nowIso;
    cache.status.ssa = { ok: ssaOk, total: countries.filter((x) => x.ssa_id).length, checked_at: nowIso };

    writeCache(cache);
    log(`[strategic] refresh done: HAPI ${hapiOk}/${countries.length}, FTS ${cache.status.fts?.ok ?? 0}, SSA ${ssaOk}`);
    return cache;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
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
      ssa: { name: "WHO Surveillance System for Attacks on Health Care", url: "https://extranet.who.int/ssa/Index.aspx", fetched_at: cache.fetched_at?.ssa || null, status: cache.status?.ssa || null },
      grading: { name: "WHO grading decisions (entered by DHM)", file: "data/who-grading.csv", updated_at: grading.updated_at },
      profile: { name: "FCV country profile workbook (DHM)", loaded_at: profile?.loaded_at || null }
    },
    classification_rules: {
      note: "DHM triage tier: a rule-based classification from verified indicators. It is not a WHO grade and does not replace the WHO grading process.",
      levels: { Major: "6 to 8 points", Severe: "3 to 5 points", Moderate: "0 to 2 points", "Insufficient data": "fewer than 3 of the 4 core indicators are current" },
      criteria: [
        "INFORM Risk class very high = 1 (EC JRC)",
        "People in need of health assistance >= 2 million = 2, >= 500,000 = 1 (OCHA HNRP)",
        "IPC/CH Phase 3+ share of the analysed population, analysis less than 18 months old, >= 20% = 2, >= 10% = 1",
        "IDPs (current figure) + refugees hosted >= 1 million = 2, >= 250,000 = 1 (IOM DTM, UNHCR)",
        "WHO SSA: 10 or more attacks on health care this year, or any deaths = 1 (only where SSA is deployed)"
      ],
      core_indicators: ["INFORM Risk", "Health people in need", "IPC/CH Phase 3+", "Displacement"]
    },
    cache_age_hours: cacheAgeHours(cache)
  };
}

module.exports = {
  REFRESH_HOURS,
  buildStrategicPayload,
  refreshStrategicCache,
  readCache,
  cacheAgeHours,
  classifyCountry,
  loadGrading
};
