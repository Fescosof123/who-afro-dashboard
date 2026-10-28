/* Strategic humanitarian view for WHO AFRO DHM.
 *
 * Renders the Overview, Crisis Classification and Data Health pages, and adds
 * verified-source panels to Country Profiles, Conflict & Displacement and
 * Attacks on Health Care. Data comes from /api/strategic (OCHA HDX HAPI and FTS,
 * IOM DTM, UNHCR, IPC, INFORM, WHO SSA, WHO grading register) plus the FCV
 * service database already loaded by app.js.
 */
(function () {
  "use strict";

  const state = {
    payload: null,
    dash: null,
    scope: "fcv13",
    mapLayer: "classification",
    loading: null
  };

  const SCOPE_GROUPS = {
    fcv13: ["fcv_prioritized", "fcv_accelerated"],
    fcvall: ["fcv_prioritized", "fcv_accelerated", "fcv_other"],
    withcontext: ["fcv_prioritized", "fcv_accelerated", "fcv_other", "context"]
  };

  const GROUP_LABEL = {
    fcv_prioritized: "Prioritized",
    fcv_accelerated: "Accelerated",
    fcv_other: "Other FCV",
    context: "Context"
  };

  const LEVEL_ORDER = { Major: 3, Severe: 2, Moderate: 1, "Insufficient data": 0 };
  const LEVEL_COLOR = {
    Major: "#8e1b3a",
    Severe: "#d9662b",
    Moderate: "#e9b949",
    "Insufficient data": "#b9c4cf"
  };

  const PLOT_CONFIG = { displayModeBar: false, responsive: true };

  // Plotly draws into a node that may hold an earlier "no data" message.
  function plot(node, traces, layout) {
    if (node.dataset.empty === "1") {
      node.innerHTML = "";
      delete node.dataset.empty;
    }
    Plotly.react(node, traces, layout, PLOT_CONFIG);
  }
  function emptyNote(node, text) {
    if (node.data && typeof Plotly !== "undefined") {
      Plotly.purge(node);
    }
    node.dataset.empty = "1";
    node.innerHTML = `<p class="muted">${text}</p>`;
  }
  const FONT = { family: "Barlow, sans-serif", color: "#0d1f33", size: 13 };

  // ---------- formatting ----------
  function isNum(v) {
    return v != null && Number.isFinite(Number(v));
  }
  function fmtCompact(v) {
    if (!isNum(v)) return "n/a";
    const n = Number(v);
    const abs = Math.abs(n);
    if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 1 : 2)}M`;
    if (abs >= 1e4) return `${Math.round(n / 1e3)}K`;
    return Math.round(n).toLocaleString("en-US");
  }
  function fmtFull(v) {
    return isNum(v) ? Math.round(Number(v)).toLocaleString("en-US") : "n/a";
  }
  function fmtUsd(v) {
    return isNum(v) ? `US$${fmtCompact(v)}` : "n/a";
  }
  function fmtPct(v, digits = 0) {
    return isNum(v) ? `${(Number(v) * 100).toFixed(digits)}%` : "n/a";
  }
  function fmtDate(iso) {
    if (!iso) return "n/a";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  function fmtMonth(iso) {
    if (!iso) return "n/a";
    if (/^\d{4}$/.test(String(iso))) return `${iso} plan`;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
  }
  function esc(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function shortName(name) {
    const map = {
      "Democratic Republic of the Congo": "DR Congo",
      "Central African Republic": "CAR",
      "Republic of the Congo": "Congo",
      "Sao Tome and Principe": "Sao Tome & Principe"
    };
    return map[name] || name;
  }
  function el(id) {
    return document.getElementById(id);
  }
  function levelTag(level, provisional = false) {
    const color = LEVEL_COLOR[level] || "#b9c4cf";
    const ink = level === "Moderate" || level === "Insufficient data" ? "#0d1f33" : "#fff";
    const title = provisional ? ' title="Provisional: uses the last humanitarian plan\'s figure because the country has no current plan"' : "";
    return `<span class="strat-level${provisional ? " strat-level-provisional" : ""}" style="background:${color};color:${ink}"${title}>${esc(level)}${provisional ? " (provisional)" : ""}</span>`;
  }
  function rowTag(r) {
    return levelTag(r.classification.level, Boolean(r.classification.uses_last_plan));
  }
  // Plain-language name for a source string.
  function plainSource(src) {
    if (!src) return "";
    if (/HPC/.test(src)) return "OCHA Humanitarian Action";
    if (/HAPI/.test(src)) return "OCHA via HDX";
    if (/profile/i.test(src)) return "FCV country profile (DHM)";
    return src;
  }
  function sourceLine(text) {
    return `<div class="strat-source">${text}</div>`;
  }

  // ---------- data ----------
  function rowsInScope(scope = state.scope) {
    const groups = SCOPE_GROUPS[scope] || SCOPE_GROUPS.fcv13;
    return (state.payload?.countries || []).filter((r) => groups.includes(r.group));
  }
  function sum(rows, getter) {
    return rows.reduce((s, r) => {
      const v = getter(r);
      return isNum(v) ? s + Number(v) : s;
    }, 0);
  }
  function count(rows, getter) {
    return rows.filter((r) => isNum(getter(r))).length;
  }

  function latestServiceQuarter() {
    const rows = state.dash?.service_delivery_quarterly_rows || [];
    const byIso = {};
    rows.forEach((r) => {
      if (!byIso[r.iso3] || Number(r.quarter_sort) > Number(byIso[r.iso3].quarter_sort)) {
        byIso[r.iso3] = r;
      }
    });
    return byIso;
  }

  function median(values) {
    const v = values.filter(isNum).map(Number).sort((a, b) => a - b);
    if (!v.length) return null;
    const mid = Math.floor(v.length / 2);
    return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
  }

  // ---------- Trends ----------
  // The comparison base is the last monthly snapshot from an earlier month
  // (served by /api/strategic as history.base).
  function baseSnapshot() {
    return state.payload?.history?.base || null;
  }
  function monthLabel(key) {
    if (!key) return "";
    const [y, m] = String(key).split("-").map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  function nextMonthLabel(key) {
    if (!key) return "";
    const [y, m] = String(key).split("-").map(Number);
    return monthLabel(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`);
  }
  // kind: "pct" (relative change), "pp" (percentage points), "count" (absolute).
  function trendHtml({ cur, prev, kind = "pct", worseWhen = "up", label, unit, prefix }) {
    if (!isNum(cur) || !isNum(prev)) return "";
    let delta;
    let text;
    if (kind === "pp") {
      delta = (cur - prev) * 100;
      text = `${Math.abs(delta).toFixed(1)} points`;
    } else if (kind === "count") {
      delta = cur - prev;
      text = fmtFull(Math.abs(delta));
    } else {
      if (!prev) return "";
      delta = ((cur - prev) / prev) * 100;
      text = `${Math.abs(delta).toFixed(Math.abs(delta) < 10 ? 1 : 0)}%`;
    }
    const flat = kind === "count" ? delta === 0 : Math.abs(delta) < 0.5;
    if (flat) return `<span class="strat-trend strat-trend-flat">&#9632; ${esc(prefix || "")}${prefix ? " " : ""}no change ${esc(label)}</span>`;
    const up = delta > 0;
    const bad = worseWhen === "none" ? null : (up === (worseWhen === "up"));
    const cls = bad == null ? "strat-trend-flat" : bad ? "strat-trend-bad" : "strat-trend-good";
    const body = kind === "count" && unit
      ? `${text} ${up ? "more" : "fewer"} ${Math.abs(delta) === 1 ? unit[0] : unit[1]}`
      : `${esc(prefix || "")}${prefix ? " " : ""}${up ? "up" : "down"} ${text}`;
    return `<span class="strat-trend ${cls}">${up ? "&#9650;" : "&#9660;"} ${body} ${esc(label)}</span>`;
  }
  // Current and previous totals over the same countries only (those with a value
  // in both months), so a country entering or leaving the data does not move the arrow.
  function pairedSums(rows, field, currentGetter, sameSource = false) {
    const base = baseSnapshot();
    if (!base) return null;
    let cur = 0;
    let prev = 0;
    let n = 0;
    rows.forEach((r) => {
      const b = base.countries?.[r.iso3];
      const c = currentGetter(r);
      if (!b || !isNum(b[field]) || !isNum(c)) return;
      if (sameSource && b.health_in_need_source && b.health_in_need_source !== (r.health_in_need?.plan_code || r.health_in_need?.source)) return;
      cur += Number(c);
      prev += Number(b[field]);
      n += 1;
    });
    return n ? { cur, prev, n } : null;
  }
  function baseSameYear() {
    const base = baseSnapshot();
    return Boolean(base) && String(base.month).slice(0, 4) === String(new Date().getFullYear());
  }
  function sinceLabel() {
    const base = baseSnapshot();
    return base ? `since ${monthLabel(base.month)}` : "";
  }

  // Latest published Health Cluster reach (OCHA Response Monitoring), grouped
  // by plan year. Past years count only when reporting reached the end of the plan.
  function latestReach(rows) {
    const thisYear = String(new Date().getFullYear());
    const usable = rows.filter((r) => r.health_reach_latest && isNum(r.health_reach_latest.reached)
      && (r.health_reach_latest.full_year || r.health_reach_latest.year === thisYear));
    const partial = rows.filter((r) => r.health_reach_latest && !usable.includes(r));
    const years = [...new Set(usable.map((r) => r.health_reach_latest.year))].sort().reverse();
    if (!years.length) return { year: null, rows: [], partial };
    const year = years[0];
    const inYear = usable.filter((r) => r.health_reach_latest.year === year && isNum(r.health_reach_latest.targeted) && r.health_reach_latest.targeted > 0);
    return {
      year,
      rows: inYear,
      partial,
      reached: sum(inYear, (r) => r.health_reach_latest.reached),
      targeted: sum(inYear, (r) => r.health_reach_latest.targeted),
      lastPeriod: inYear.map((r) => r.health_reach_latest.period_end).sort().pop()
    };
  }

  function computeKpis(rows) {
    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.requirements_usd));
    const req = sum(funded, (r) => r.health_funding.requirements_usd);
    const got = sum(funded, (r) => r.health_funding.funding_usd);
    const svc = latestServiceQuarter();
    const svcRows = rows.map((r) => svc[r.iso3]).filter((q) => q && isNum(q.people_reached));
    const reachRows = rows.filter((r) => isNum(r.health_reached?.value) && isNum(r.health_targeted?.value) && r.health_targeted.value > 0);
    const mhpss = rows
      .map((r) => ({ r, q: svc[r.iso3] }))
      .filter((x) => x.q && isNum(x.q.mental_health_beneficiaries) && isNum(x.r.health_in_need?.value) && x.r.health_in_need.value > 0)
      .map((x) => ({ ...x, rate: (x.q.mental_health_beneficiaries / x.r.health_in_need.value) * 10000 }));
    const core = rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated");
    return {
      major: rows.filter((r) => r.classification.level === "Major"),
      severe: rows.filter((r) => r.classification.level === "Severe"),
      insufficient: rows.filter((r) => r.classification.level === "Insufficient data"),
      graded: rows.reduce((total, r) => total + (r.who_grades || []).length, 0),
      healthPin: sum(rows, (r) => r.health_in_need?.value),
      healthPinCountries: count(rows, (r) => r.health_in_need?.value),
      healthPinPrevYear: rows.filter((r) => r.health_in_need && String(r.health_in_need.year) !== String(new Date().getFullYear())),
      noHealthPlan: rows.filter((r) => !r.health_in_need),
      lastPlanInTier: rows.filter((r) => r.classification?.uses_last_plan),
      yoyRows: rows.filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_in_need_previous?.value)),
      reachLatest: latestReach(rows),
      pin: sum(rows, (r) => r.people_in_need?.value),
      healthTargeted: sum(rows, (r) => r.health_targeted?.value),
      healthReached: sum(reachRows, (r) => r.health_reached.value),
      healthReachTargeted: sum(reachRows, (r) => r.health_targeted.value),
      healthReachedCountries: reachRows.length,
      svcReached: sum(svcRows, (q) => q.people_reached),
      svcCountries: svcRows.length,
      svcQuarter: svcRows.map((q) => q.quarter_label).sort().pop() || null,
      req,
      got,
      pct: req ? got / req : null,
      medianPct: median(funded.map((r) => r.health_funding.pct)),
      gap: Math.max(0, req - got),
      fundedPlans: funded.length,
      idps: sum(rows, (r) => (r.idps && !r.idps.stale ? r.idps.value : null)),
      idpsFromPlan: rows.filter((r) => r.idps && !r.idps.stale && /HNRP|profile/i.test(r.idps.source || "")).length,
      refugees: sum(rows, (r) => r.refugees?.value),
      attacks: sum(rows, (r) => r.attacks?.ytd?.attacks),
      deaths: sum(rows, (r) => r.attacks?.ytd?.deaths),
      injuries: sum(rows, (r) => r.attacks?.ytd?.injuries),
      ssaCountries: rows.filter((r) => r.attacks).length,
      notInSsa: rows.filter((r) => !r.attacks),
      mhpss,
      mhpssMedian: median(mhpss.map((x) => x.rate)),
      coverage: {
        total: core.length || rows.length,
        plan: rows.filter((r) => r.health_funding).length,
        ipc: rows.filter((r) => r.ipc && !r.ipc.stale).length,
        displacement: rows.filter((r) => r.idps && !r.idps.stale).length,
        ssa: rows.filter((r) => r.attacks).length,
        n: rows.length
      }
    };
  }

  // ---------- Overview ----------
  function kpiCard({ id, title, value, sub, source, target, tone, trend }) {
    const trends = (Array.isArray(trend) ? trend : [trend]).filter(Boolean);
    return `
      <button type="button" class="strat-kpi ${tone ? `strat-kpi-${tone}` : ""}" data-strat-target="${esc(target || "")}" id="${id}">
        <span class="strat-kpi-title">${title}</span>
        <span class="strat-kpi-value">${value}</span>
        ${trends.length ? `<span class="strat-kpi-trends">${trends.join("")}</span>` : ""}
        <span class="strat-kpi-sub">${sub}</span>
        ${sourceLine(source)}
      </button>`;
  }

  function renderKpis() {
    const grid = el("stratKpiGrid");
    if (!grid) return;
    const rows = rowsInScope();
    const k = computeKpis(rows);
    const src = state.payload.sources;
    const ftsDate = fmtDate(src.fts.fetched_at);
    const hapiDate = fmtDate(src.hapi.fetched_at);
    const ssaDate = fmtDate(src.ssa.fetched_at);
    const hpcDate = src.hpc?.fetched_at ? fmtDate(src.hpc.fetched_at) : null;

    const thisYear = String(new Date().getFullYear());
    const rl = k.reachLatest;
    const plansWithTarget = rows.filter((r) => isNum(r.health_targeted?.value)).length;
    let reachValue;
    let reachSub;
    let reachSource;
    let reachTone = "warn";
    if (k.healthReachedCountries) {
      reachValue = fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted));
      reachSub = `${fmtCompact(k.healthReached)} reached of ${fmtCompact(k.healthReachTargeted)} targeted in ${k.healthReachedCountries} countries so far in ${thisYear}.`;
      reachSource = `OCHA Humanitarian Action (response monitoring), ${hpcDate || "n/a"}`;
      reachTone = "";
    } else if (rl.year) {
      const rates = rl.rows.map((r) => ({ r, v: r.health_reach_latest.reached / r.health_reach_latest.targeted })).sort((x, y) => x.v - y.v);
      const range = rates.length > 1
        ? ` Range ${fmtPct(rates[0].v)} (${esc(shortName(rates[0].r.country))}) to ${fmtPct(rates[rates.length - 1].v)} (${esc(shortName(rates[rates.length - 1].r.country))}).`
        : "";
      reachValue = `${fmtPct(rl.reached / Math.max(1, rl.targeted))}<small> in ${esc(rl.year)}, ${rl.rows.length} countries</small>`;
      reachSub = `No ${thisYear} figures published yet. Final ${esc(rl.year)} results exist for ${rl.rows.length} of ${plansWithTarget} countries with a plan: ${fmtCompact(rl.reached)} reached of ${fmtCompact(rl.targeted)} targeted.${range}${rl.partial.length ? ` No year-end figure published for ${rl.partial.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}`;
      reachSource = `OCHA Humanitarian Action (response monitoring), ${hpcDate || "n/a"}`;
    } else {
      reachValue = "Awaiting data";
      reachSub = `Plans target ${fmtCompact(k.healthTargeted)} people (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} of need). Country office reports in the FCV service database: ${fmtCompact(k.svcReached)} service contacts in ${k.svcCountries} countries.`;
      reachSource = "No Health Cluster reach published yet by OCHA";
    }

    // Trends: month on month from the stored snapshots, and year on year where the source carries it.
    const since = sinceLabel();
    const base = baseSnapshot();
    // Compare only countries with a tier in both months: a move to or from
    // "Insufficient data" is a data change, not a change on the ground.
    const tiered = (lvl) => lvl && lvl !== "Insufficient data";
    const bothTiered = base ? rows.filter((r) => tiered(base.countries?.[r.iso3]?.level) && tiered(r.classification.level)) : [];
    const crisesNowPaired = bothTiered.filter((r) => ["Major", "Severe"].includes(r.classification.level)).length;
    const crisesPrev = base ? bothTiered.filter((r) => ["Major", "Severe"].includes(base.countries[r.iso3].level)).length : null;
    const tierMoves = base ? rows.filter((r) => base.countries?.[r.iso3]?.level && base.countries[r.iso3].level !== r.classification.level) : [];
    const moveNote = tierMoves.length
      ? `<br>Changed tier ${esc(since)}: ${tierMoves.map((r) => `${esc(shortName(r.country))} (${esc(base.countries[r.iso3].level)} to ${esc(r.classification.level)})`).join(", ")}.`
      : "";
    const yoyCur = sum(k.yoyRows, (r) => r.health_in_need.value);
    const yoyPrev = sum(k.yoyRows, (r) => r.health_in_need_previous.value);
    const yoyTrend = k.yoyRows.length
      ? trendHtml({ cur: yoyCur, prev: yoyPrev, worseWhen: "none", label: `vs ${Number(thisYear) - 1} plans (same ${k.yoyRows.length} countries)` })
      : "";
    // Funding and need are compared month on month only within the same plan year.
    const fundReq = baseSameYear() ? pairedSums(rows, "health_requirements_usd", (r) => r.health_funding?.requirements_usd) : null;
    const fundGot = baseSameYear() ? pairedSums(rows, "health_funding_usd", (r) => (r.health_funding ? r.health_funding.funding_usd : null)) : null;
    const fundTrend = fundReq && fundGot && fundReq.prev > 0 && fundReq.cur > 0
      ? trendHtml({ cur: fundGot.cur / fundReq.cur, prev: fundGot.prev / fundReq.prev, kind: "pp", worseWhen: "down", prefix: "funding", label: since })
      : "";
    const pinPair = baseSameYear() ? pairedSums(rows, "health_in_need", (r) => r.health_in_need?.value, true) : null;
    const dispPair = pairedSums(rows, "displaced", (r) => ((r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0)) || null);
    const attacksBaseSameYear = base && String(base.month).slice(0, 4) === thisYear;
    const ssaRows = rows.filter((r) => r.attacks?.prev_ytd);
    const attacksYoy = ssaRows.length
      ? trendHtml({ cur: sum(ssaRows, (r) => r.attacks.ytd.attacks), prev: sum(ssaRows, (r) => r.attacks.prev_ytd.attacks), label: "vs same period last year" })
      : "";
    const attPair = attacksBaseSameYear ? pairedSums(rows, "attacks_ytd", (r) => r.attacks?.ytd?.attacks) : null;
    const attacksSince = attPair
      ? `<span class="strat-trend strat-trend-flat">${attPair.cur > attPair.prev ? `${fmtFull(attPair.cur - attPair.prev)} new attacks recorded` : "no new attacks recorded"} ${esc(since)}</span>`
      : "";

    const prevYearNote = k.healthPinPrevYear.length
      ? ` Uses the ${Number(thisYear) - 1} plan figure for ${k.healthPinPrevYear.map((r) => esc(shortName(r.country))).join(", ")}.`
      : "";
    const noPlan = k.noHealthPlan.map((r) => `${esc(shortName(r.country))}${r.health_outdated ? ` (last plan ${esc(r.health_outdated.year)})` : ""}`);
    const noPlanNote = noPlan.length ? ` No current plan: ${noPlan.join(", ")}; not in the total.` : "";
    const revised = rows.filter((r) => r.health_in_need?.alt);
    const revisedNote = revised.length ? ` Revised plan figures used for ${revised.map((r) => `${esc(shortName(r.country))} (${fmtCompact(r.health_in_need.value)}; earlier version ${fmtCompact(r.health_in_need.alt.value)})`).join(", ")}.` : "";
    const pinSources = [...new Set(rows.map((r) => r.health_in_need?.source).filter(Boolean)
      .map(plainSource))];

    grid.innerHTML = [
      kpiCard({
        id: "kpiCrises",
        title: "Countries in major or severe crisis",
        value: `${k.major.length + k.severe.length}<small> of ${rows.length}</small>`,
        sub: `Major: ${k.major.map((r) => esc(shortName(r.country))).join(", ") || "none"}. Severe: ${k.severe.length}. Insufficient data: ${k.insufficient.map((r) => esc(shortName(r.country))).join(", ") || "none"}.${k.lastPlanInTier.length ? ` Tier uses the last plan figure for ${k.lastPlanInTier.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}${moveNote}<br>WHO grades: ${k.graded ? `${k.graded} recorded` : "none recorded yet"}.`,
        source: "DHM triage tier from verified indicators; not a WHO grade",
        target: "gradingPage",
        tone: k.major.length ? "bad" : "",
        trend: base ? trendHtml({ cur: crisesNowPaired, prev: crisesPrev, kind: "count", unit: ["country", "countries"], label: since }) : ""
      }),
      kpiCard({
        id: "kpiHealthPin",
        title: "People in need of health assistance",
        value: fmtCompact(k.healthPin),
        sub: `${k.healthPinCountries} countries. All sectors: ${fmtCompact(k.pin)} people in need.${revisedNote}${prevYearNote}${noPlanNote}`,
        source: `Humanitarian plans: ${pinSources.join(", ") || "OCHA via HDX"}, ${hpcDate || hapiDate}`,
        target: "overviewPage#stratTable",
        trend: [pinPair ? trendHtml({ cur: pinPair.cur, prev: pinPair.prev, label: since }) : "", yoyTrend]
      }),
      kpiCard({
        id: "kpiReach",
        title: "Health reach against target",
        value: reachValue,
        sub: reachSub,
        source: reachSource,
        target: "overviewPage#stratCoverageChart",
        tone: reachTone
      }),
      kpiCard({
        id: "kpiFunding",
        title: "Health funding gap (2026 plans)",
        value: fmtUsd(k.gap),
        sub: `${fmtPct(k.pct)} of ${fmtUsd(k.req)} received across ${k.fundedPlans} plans; median country ${fmtPct(k.medianPct)}. Excludes refugee response plans and funding not assigned to a cluster.`,
        source: `OCHA FTS, health cluster requirements and reported funding, ${ftsDate}`,
        target: "overviewPage#stratFundingChart",
        tone: k.medianPct != null && k.medianPct < 0.5 ? "bad" : "warn",
        trend: fundTrend
      }),
      kpiCard({
        id: "kpiDisplaced",
        title: "Displaced people",
        value: fmtCompact(k.idps + k.refugees),
        sub: `${fmtCompact(k.idps)} internally displaced and ${fmtCompact(k.refugees)} refugees and asylum seekers hosted.${k.idpsFromPlan ? ` ${k.idpsFromPlan} countries use the 2026 plan figure where IOM DTM is outdated or partial.` : ""}`,
        source: `IOM DTM and UNHCR via HDX HAPI, ${hapiDate}`,
        target: "conflictsDisplacementPage",
        trend: dispPair ? trendHtml({ cur: dispPair.cur, prev: dispPair.prev, label: since }) : ""
      }),
      kpiCard({
        id: "kpiAttacks",
        title: "Attacks on health care this year",
        value: fmtFull(k.attacks),
        sub: `${fmtFull(k.deaths)} health workers and patients killed, ${fmtFull(k.injuries)} injured, in ${k.ssaCountries} countries with WHO surveillance.${k.notInSsa.length ? ` Not covered: ${k.notInSsa.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}`,
        source: `WHO Surveillance System for Attacks on Health Care (SSA), ${ssaDate}`,
        target: "attacksHealthPage",
        tone: k.deaths > 0 ? "bad" : "",
        trend: [attacksYoy, attacksSince]
      }),
      kpiCard({
        id: "kpiMhpss",
        title: "Mental health and psychosocial support",
        value: k.mhpssMedian != null ? `${k.mhpssMedian.toFixed(0)}<small> per 10,000</small>` : "n/a",
        sub: k.mhpss.length
          ? `Median people reached with MHPSS in the latest quarter per 10,000 people in need of health assistance (${k.mhpss.length} countries). No regional MHPSS target is published, so the gap cannot yet be sized.`
          : "No MHPSS figures reported for this scope.",
        source: "FCV service database (WHO country offices); OCHA plans for the denominator",
        target: "overviewPage#stratMhpssChart",
        tone: "warn"
      }),
      kpiCard({
        id: "kpiCoverage",
        title: "Data coverage",
        value: `${k.coverage.plan}<small> of ${k.coverage.n} with funded plan data</small>`,
        sub: `Current IPC/CH analysis: ${k.coverage.ipc}. Current displacement figure: ${k.coverage.displacement}. WHO attack surveillance: ${k.coverage.ssa}.`,
        source: "Shows how complete the figures above are",
        target: "dataHealthPage#dataHealthSources"
      })
    ].join("");

    let note = el("stratTrendNote");
    if (!note) {
      note = document.createElement("p");
      note.id = "stratTrendNote";
      note.className = "strat-trend-note muted";
      grid.insertAdjacentElement("afterend", note);
    }
    const hist = state.payload.history || {};
    note.innerHTML = base
      ? `Arrows compare with the last snapshot of ${esc(monthLabel(base.month))} (taken ${esc(fmtDate(base.taken_at))}), using only countries with figures in both months. Year-on-year arrows compare with the previous plan or the same period last year. Red means worse, green better, grey shows the change without judging it (plan methods change between years).`
      : `Month-on-month arrows start in ${esc(nextMonthLabel(hist.first_month || new Date().toISOString().slice(0, 7)))}, once a full month of snapshots exists. Year-on-year arrows already compare with the previous plan or the same period last year. Red means worse, green better, grey shows the change without judging it (plan methods change between years).`;
  }

  function renderMessages() {
    const list = el("stratMessages");
    if (!list) return;
    list.innerHTML = buildMessages(rowsInScope()).map((m) => `<li>${m}</li>`).join("");
  }

  function buildMessages(rows) {
    const k = computeKpis(rows);
    const messages = [];

    const byPin = rows.filter((r) => isNum(r.health_in_need?.value)).sort((a, b) => b.health_in_need.value - a.health_in_need.value);
    const top3 = byPin.slice(0, 3);
    if (top3.length) {
      const share = sum(top3, (r) => r.health_in_need.value) / Math.max(1, k.healthPin);
      const ipcTop = rows
        .filter((r) => r.ipc && !r.ipc.stale && isNum(r.ipc.fraction))
        .sort((a, b) => b.ipc.fraction - a.ipc.fraction)[0];
      messages.push(
        `<strong>Where the burden sits.</strong> ${top3.map((r) => `${esc(shortName(r.country))} (${fmtCompact(r.health_in_need.value)})`).join(", ")} account for ${fmtPct(share)} of people in need of health assistance in this scope.`
        + (ipcTop ? ` The highest share in crisis-level food insecurity or worse (IPC/CH Phase 3+) is in ${esc(shortName(ipcTop.country))}: ${fmtPct(ipcTop.ipc.fraction)} of the population analysed, ${ipcTop.ipc.kind === "current" ? "current analysis" : "projection"} for ${fmtMonth(ipcTop.ipc.period_start)} to ${fmtMonth(ipcTop.ipc.period_end)}.` : "")
      );
    }

    const rising = rows
      .filter((r) => r.attacks?.prev_ytd)
      .map((r) => ({ r, cur: r.attacks.ytd.attacks, prev: r.attacks.prev_ytd.attacks, deaths: r.attacks.ytd.deaths }))
      .filter((x) => x.cur >= 10 && x.cur > x.prev * 1.25)
      .sort((a, b) => b.cur - a.cur);
    const majors = k.major.map((r) => esc(shortName(r.country)));
    const thisYear = new Date().getFullYear();
    messages.push(
      `<strong>What is getting worse.</strong> ${majors.length ? `${majors.join(", ")} ${majors.length === 1 ? "is" : "are"} in the major tier of the DHM triage classification (a status, not a trend). ` : ""}`
      + (rising.length
        ? `Attacks on health care are up on the same period of ${thisYear - 1} in ${rising.map((x) => `${esc(shortName(x.r.country))} (${x.cur} against ${x.prev}${x.deaths ? `, ${x.deaths} people killed` : ""})`).join("; ")}.`
        : `No WHO-monitored country shows a clear rise in attacks on health care (10 or more and at least 25% above the same period of ${thisYear - 1}).`)
    );

    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct)).sort((a, b) => a.health_funding.pct - b.health_funding.pct);
    if (funded.length) {
      const low = funded.slice(0, 3);
      const biggestGap = funded.slice().sort((a, b) => b.health_funding.gap_usd - a.health_funding.gap_usd)[0];
      messages.push(
        `<strong>Funding point for management.</strong> Health funding coverage is lowest in ${low.map((r) => `${esc(shortName(r.country))} (${fmtPct(r.health_funding.pct)})`).join(", ")}; the median per country is ${fmtPct(k.medianPct)}. The largest unfunded health requirement is ${esc(shortName(biggestGap.country))} (${fmtUsd(biggestGap.health_funding.gap_usd)}). Possible action: raise these in donor briefings and pooled-fund discussions.`
      );
    }
    return messages;
  }

  function mapValue(r, layer) {
    switch (layer) {
      case "classification": return LEVEL_ORDER[r.classification.level] ?? null;
      case "health_pin": return r.health_in_need?.value ?? null;
      case "funding_pct": return r.health_funding && isNum(r.health_funding.pct) ? r.health_funding.pct * 100 : null;
      case "displaced": {
        const v = (r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0);
        return v || null;
      }
      case "ipc": return r.ipc && !r.ipc.stale && isNum(r.ipc.fraction) ? r.ipc.fraction * 100 : null;
      case "attacks": return r.attacks ? r.attacks.ytd.attacks : null;
      default: return null;
    }
  }

  function mapHover(r) {
    const parts = [
      `<b>${r.country}</b>`,
      `DHM tier: ${r.classification.level} (${r.classification.score}/${r.classification.max_score})`,
      `Health PiN: ${fmtCompact(r.health_in_need?.value)}`,
      `Health funded: ${r.health_funding ? fmtPct(r.health_funding.pct) : "no plan data"}`,
      `IDPs: ${fmtCompact(r.idps?.value)} | Refugees: ${fmtCompact(r.refugees?.value)}`,
      `IPC 3+: ${r.ipc && !r.ipc.stale ? fmtPct(r.ipc.fraction) : "no current analysis"}`,
      `Attacks this year: ${r.attacks ? r.attacks.ytd.attacks : "not monitored by SSA"}`
    ];
    return parts.join("<br>");
  }

  function renderMap() {
    const node = el("stratMap");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope();
    const layer = state.mapLayer;
    const withVal = rows.map((r) => ({ r, v: mapValue(r, layer) }));
    const present = withVal.filter((x) => x.v != null);
    const missing = withVal.filter((x) => x.v == null);

    let trace;
    if (layer === "classification") {
      trace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: present.map((x) => x.r.iso3),
        z: present.map((x) => x.v),
        zmin: 0,
        zmax: 3,
        colorscale: [
          [0, LEVEL_COLOR["Insufficient data"]], [0.25, LEVEL_COLOR["Insufficient data"]],
          [0.25, LEVEL_COLOR.Moderate], [0.5, LEVEL_COLOR.Moderate],
          [0.5, LEVEL_COLOR.Severe], [0.75, LEVEL_COLOR.Severe],
          [0.75, LEVEL_COLOR.Major], [1, LEVEL_COLOR.Major]
        ],
        colorbar: { tickvals: [0.4, 1.1, 1.9, 2.6], ticktext: ["No data", "Moderate", "Severe", "Major"], thickness: 12, len: 0.6 },
        text: present.map((x) => mapHover(x.r)),
        hoverinfo: "text",
        marker: { line: { color: "#ffffff", width: 0.8 } }
      };
    } else {
      const reversed = layer === "funding_pct";
      trace = {
        type: "choropleth",
        locationmode: "ISO-3",
        locations: present.map((x) => x.r.iso3),
        z: present.map((x) => x.v),
        colorscale: reversed
          ? [[0, "#8e1b3a"], [0.5, "#f0b45b"], [1, "#2e8b6e"]]
          : [[0, "#fde6c8"], [0.5, "#e8743b"], [1, "#7a1f3d"]],
        zmin: reversed ? 0 : undefined,
        zmax: reversed ? 100 : undefined,
        colorbar: { thickness: 12, len: 0.6, ticksuffix: layer === "funding_pct" || layer === "ipc" ? "%" : "" },
        text: present.map((x) => mapHover(x.r)),
        hoverinfo: "text",
        marker: { line: { color: "#ffffff", width: 0.8 } }
      };
    }
    const grey = {
      type: "choropleth",
      locationmode: "ISO-3",
      locations: missing.map((x) => x.r.iso3),
      z: missing.map(() => 1),
      colorscale: [[0, "#dfe6ee"], [1, "#dfe6ee"]],
      showscale: false,
      text: missing.map((x) => `${mapHover(x.r)}<br><i>No value for this layer</i>`),
      hoverinfo: "text",
      marker: { line: { color: "#ffffff", width: 0.8 } }
    };
    const layout = {
      geo: {
        scope: "africa",
        projection: { type: "mercator" },
        showland: true,
        landcolor: "#f1f5f9",
        showcountries: true,
        countrycolor: "#ffffff",
        showframe: false,
        bgcolor: "rgba(0,0,0,0)",
        lataxis: { range: [-36, 24] },
        lonaxis: { range: [-20, 52] }
      },
      margin: { l: 0, r: 0, t: 0, b: 0 },
      paper_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      height: 430
    };
    plot(node, [grey, trace, labelTrace(rows, layer)], layout);
    renderMapNote();
  }

  function renderFundingChart() {
    const node = el("stratFundingChart");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope().filter((r) => r.health_funding).sort((a, b) => a.health_funding.gap_usd - b.health_funding.gap_usd);
    if (!rows.length) {
      emptyNote(node, "No health cluster funding data for the selected scope.");
      return;
    }
    const names = rows.map((r) => shortName(r.country));
    const fundedTrace = {
      type: "bar",
      orientation: "h",
      name: "Funded",
      y: names,
      x: rows.map((r) => r.health_funding.funding_usd / 1e6),
      marker: { color: "#2e8b6e" },
      hovertemplate: "%{y}<br>Funded: US$%{x:.1f}M<extra></extra>"
    };
    const gapTrace = {
      type: "bar",
      orientation: "h",
      name: "Unfunded",
      y: names,
      x: rows.map((r) => r.health_funding.gap_usd / 1e6),
      marker: { color: "#e8a33b" },
      text: rows.map((r) => `${fmtPct(r.health_funding.pct)} funded`),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{y}<br>Unfunded: US$%{x:.1f}M<extra></extra>"
    };
    const layout = {
      barmode: "stack",
      margin: { l: 110, r: 80, t: 10, b: 40 },
      height: Math.max(300, 34 * rows.length + 80),
      xaxis: { title: { text: "Health requirement, US$ million" }, gridcolor: "#e6edf5", zeroline: false },
      yaxis: { automargin: true },
      legend: { orientation: "h", y: -0.18 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT
    };
    plot(node, [fundedTrace, gapTrace], layout);
  }

  function cellStale(text, stale, title) {
    return stale ? `<span class="strat-stale" title="${esc(title || "Outside the freshness rule; excluded from totals")}">${text}</span>` : text;
  }

  function renderTable() {
    const table = el("stratTable");
    if (!table) return;
    const rows = rowsInScope().slice().sort((a, b) =>
      (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level])
      || (b.classification.score - a.classification.score)
      || ((b.health_in_need?.value || 0) - (a.health_in_need?.value || 0)));
    const anyGrades = rows.some((r) => (r.who_grades || []).length);
    const head = `
      <thead><tr>
        <th>Country</th><th>Group</th><th title="DHM triage tier, not a WHO grade">DHM tier</th>${anyGrades ? "<th>WHO grade</th>" : ""}
        <th title="People in need of health assistance (OCHA plans)">Health PiN</th><th title="Health cluster funding received (OCHA FTS)">Funded</th><th title="Unfunded health requirement">Gap (US$)</th>
        <th title="Internally displaced people">IDPs</th><th title="Refugees and asylum seekers hosted (UNHCR)">Refugees</th><th title="IPC/CH Phase 3+, share of the population analysed">IPC/CH 3+</th><th title="Attacks on health care this year (WHO SSA)">Attacks</th><th title="INFORM Risk index (EC JRC), 0 to 10">INFORM</th>
      </tr></thead>`;
    const body = rows.map((r) => {
      const grade = (r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)}`).join("<br>") || '<span class="muted">none</span>';
      const hp = r.health_in_need
        ? `<span title="${esc(`${r.health_in_need.source}, ${r.health_in_need.year}${r.health_in_need.alt ? `. Revised plan; HDX HAPI holds ${fmtCompact(r.health_in_need.alt.value)} (earlier version)` : ""}`)}">${fmtCompact(r.health_in_need.value)}</span>${String(r.health_in_need.year) !== String(new Date().getFullYear()) ? ` <small>${esc(r.health_in_need.year)}</small>` : ""}`
        : r.health_outdated
          ? cellStale(`${fmtCompact(r.health_outdated.value)} <small>(${esc(r.health_outdated.year)})</small>`, true,
            `No current humanitarian plan. Last plan: ${r.health_outdated.plan_name || r.health_outdated.year}, ended ${fmtMonth(r.health_outdated.plan_end)}. ${r.health_outdated.counts_for_tier ? "Counts toward the triage tier, which is shown as provisional; not added to totals." : `Not used: ${r.health_outdated.rule || "too old"}.`}`)
          : '<span class="muted">no plan</span>';
      const fund = r.health_funding ? `${fmtPct(r.health_funding.pct)}` : '<span class="muted">no plan</span>';
      const gap = r.health_funding ? fmtUsd(r.health_funding.gap_usd).replace("US$", "") : "";
      const idp = r.idps ? `<span title="${esc(`${r.idps.source}, ${fmtMonth(r.idps.date)}${r.idps.note ? `. ${r.idps.note}` : ""}`)}">${cellStale(fmtCompact(r.idps.value), r.idps.stale)}</span>` : '<span class="muted">n/a</span>';
      const ref = r.refugees ? `<span title="${esc(`${r.refugees.source}, end ${r.refugees.year}`)}">${fmtCompact(r.refugees.value)}</span>` : '<span class="muted">n/a</span>';
      const ipc = r.ipc
        ? `<span title="${esc(`${r.ipc.kind === "current" ? "Current analysis" : "Projection"}, ${fmtMonth(r.ipc.period_start)} to ${fmtMonth(r.ipc.period_end)}${r.ipc.stale ? ". Older than 18 months; not used" : ""}`)}">${cellStale(fmtPct(r.ipc.fraction), r.ipc.stale)}${r.ipc.kind === "current" ? "" : " <small>proj.</small>"}</span>`
        : '<span class="muted">no analysis</span>';
      const att = r.attacks
        ? `${fmtFull(r.attacks.ytd.attacks)}${r.attacks.ytd.deaths ? ` <small>(${fmtFull(r.attacks.ytd.deaths)} killed)</small>` : ""}`
        : '<span class="muted">not in SSA</span>';
      const inform = r.inform_risk ? `${esc(r.inform_risk.overall)}` : "n/a";
      return `<tr>
        <td><button type="button" class="strat-link" data-strat-country="${r.iso3}">${esc(r.country)}</button></td>
        <td>${esc(GROUP_LABEL[r.group] || r.group)}</td>
        <td>${rowTag(r)} <small>${r.classification.score}/${r.classification.max_score}</small></td>
        ${anyGrades ? `<td>${grade}</td>` : ""}
        <td class="num">${hp}</td>
        <td class="num">${fund}</td>
        <td class="num">${gap}</td>
        <td class="num">${idp}</td>
        <td class="num">${ref}</td>
        <td class="num">${ipc}</td>
        <td class="num">${att}</td>
        <td class="num">${inform}</td>
      </tr>`;
    }).join("");
    table.innerHTML = `${head}<tbody>${body}</tbody>`;
  }

  function renderCoverageChart() {
    const node = el("stratCoverageChart");
    if (!node || typeof Plotly === "undefined") return;
    const rows = rowsInScope().filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value))
      .map((r) => ({ r, share: r.health_targeted.value / r.health_in_need.value }))
      .sort((a, b) => a.share - b.share);
    if (!rows.length) {
      emptyNote(node, "No plan targets for the selected scope.");
      return;
    }
    plot(node, [{
      type: "bar",
      orientation: "h",
      y: rows.map((x) => shortName(x.r.country)),
      x: rows.map((x) => x.share * 100),
      marker: { color: rows.map((x) => (x.share < 0.4 ? "#c44242" : x.share < 0.6 ? "#e8a33b" : "#2e8b6e")) },
      text: rows.map((x) => `${fmtPct(x.share)} (${fmtCompact(x.r.health_targeted.value)} of ${fmtCompact(x.r.health_in_need.value)})`),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{y}: %{x:.0f}% of health need targeted<extra></extra>"
    }], {
      margin: { l: 110, r: 150, t: 10, b: 40 },
      height: Math.max(280, 32 * rows.length + 70),
      xaxis: { range: [0, 100], ticksuffix: "%", gridcolor: "#e6edf5", title: { text: "Targeted as % of people in need of health assistance" } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      showlegend: false
    });
  }

  function renderMhpssChart() {
    const node = el("stratMhpssChart");
    if (!node || typeof Plotly === "undefined") return;
    const svc = latestServiceQuarter();
    const rows = rowsInScope()
      .map((r) => ({ r, q: svc[r.iso3] }))
      .filter((x) => x.q && isNum(x.q.mental_health_beneficiaries) && isNum(x.r.health_in_need?.value))
      .map((x) => ({ ...x, rate: (x.q.mental_health_beneficiaries / x.r.health_in_need.value) * 10000 }))
      .sort((a, b) => a.rate - b.rate);
    if (!rows.length) {
      emptyNote(node, "No MHPSS figures reported in the FCV service database for the selected scope.");
      return;
    }
    plot(node, [{
      type: "bar",
      orientation: "h",
      y: rows.map((x) => shortName(x.r.country)),
      x: rows.map((x) => x.rate),
      marker: { color: "#4a6fa5" },
      text: rows.map((x) => `${x.rate.toFixed(0)} per 10,000 (${fmtFull(x.q.mental_health_beneficiaries)} people, ${x.q.quarter_label})`),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "%{y}: %{x:.1f} per 10,000 in need<extra></extra>"
    }], {
      margin: { l: 110, r: 230, t: 10, b: 40 },
      height: Math.max(280, 32 * rows.length + 70),
      xaxis: { gridcolor: "#e6edf5", title: { text: "People reached with MHPSS per 10,000 in need of health assistance" } },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT,
      showlegend: false
    });
  }

  function renderSources() {
    const node = el("stratSources");
    if (!node) return;
    const s = state.payload.sources;
    const links = [
      ["OCHA HDX HAPI (needs, IDPs, refugees, IPC, INFORM Risk)", s.hapi.url, s.hapi.fetched_at],
      ["OCHA Financial Tracking Service (health cluster funding)", "https://fts.unocha.org", s.fts.fetched_at],
      ["OCHA Humanitarian Action: plans and response monitoring (health caseloads and reach)", "https://humanitarianaction.info", s.hpc?.fetched_at],
      ["WHO Surveillance System for Attacks on Health Care", s.ssa.url, s.ssa.fetched_at],
      ["IOM Displacement Tracking Matrix", "https://dtm.iom.int", null],
      ["IPC Integrated Food Security Phase Classification", "https://www.ipcinfo.org", null],
      ["INFORM Risk and Severity (EC JRC)", "https://drmkc.jrc.ec.europa.eu/inform-index", null],
      ["HeRAMS (health facility functionality)", "https://www.who.int/initiatives/herams", null],
      ["OCHA humanitarian response (plans, coordination)", "https://www.unocha.org/africa", null],
      ["UNDP crisis and disaster response", "https://www.undp.org/crisis", null]
    ];
    node.innerHTML = `<ul class="strat-link-list">${links.map(([name, url, at]) => `<li><a href="${url}" target="_blank" rel="noopener">${esc(name)}</a>${at ? ` <span class="muted">updated ${fmtDate(at)}</span>` : ""}</li>`).join("")}</ul>
      <p class="muted">Purpose: this dashboard is informative and strategic. Reactive alerts and incident detail go through the weekly operational update.</p>`;
  }

  // ---------- Crisis classification page ----------
  function renderGradingPage() {
    const rows = rowsInScope("withcontext");
    const fcv = rowsInScope("fcv13");
    const summary = el("gradingSummary");
    if (summary) {
      const counts = (list, level) => list.filter((r) => r.classification.level === level).length;
      const gradeCount = (state.payload.grading.rows || []).length;
      summary.innerHTML = [
        ["Major", counts(fcv, "Major"), "of 13 FCV countries"],
        ["Severe", counts(fcv, "Severe"), "of 13 FCV countries"],
        ["Moderate", counts(fcv, "Moderate"), "of 13 FCV countries"],
        ["Insufficient data", counts(fcv, "Insufficient data"), `fewer than 3 of 4 core indicators current${counts(fcv, "Insufficient data") ? `: ${fcv.filter((r) => r.classification.level === "Insufficient data").map((r) => esc(shortName(r.country))).join(", ")}` : ""}`],
        ["WHO-graded events", gradeCount, gradeCount ? `register updated ${fmtDate(state.payload.grading.updated_at)}` : "register not yet filled by DHM"]
      ].map(([title, value, sub]) => `
        <div class="strat-kpi strat-kpi-static">
          <span class="strat-kpi-title">${title}</span>
          <span class="strat-kpi-value">${value}</span>
          <span class="strat-kpi-sub">${sub}</span>
        </div>`).join("");
    }

    const table = el("gradingTable");
    if (table) {
      const base = baseSnapshot();
      const anyGrades = rows.some((r) => (r.who_grades || []).length);
      const order = (a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score);
      const core = rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated").sort(order);
      const others = rows.filter((r) => !core.includes(r)).sort(order);
      const cols = 6 + (base ? 1 : 0) + (anyGrades ? 1 : 0);
      // Short chip labels; the full rule is in the tooltip.
      const chipLabel = (p) => {
        const c = p.criterion;
        if (/INFORM/.test(c)) return "INFORM very high";
        if (/health assistance/.test(c)) return `Health need ${fmtCompact(p.value)}${/last plan/.test(c) ? " (last plan)" : ""}`;
        if (/IPC/.test(c)) return `IPC 3+ ${fmtPct(p.value)}`;
        if (/IDPs/.test(c)) return `Displaced ${fmtCompact(p.value)}`;
        if (/SSA/.test(c)) return "Attacks on health care";
        return c;
      };
      const changeCell = (r) => {
        const prev = base?.countries?.[r.iso3];
        if (!prev?.level) return '<span class="muted">n/a</span>';
        if (prev.level === r.classification.level) return '<span class="muted">no change</span>';
        if (prev.level === "Insufficient data" || r.classification.level === "Insufficient data") {
          return `<span class="strat-trend strat-trend-flat">&#9632; was ${esc(prev.level)}</span>`;
        }
        const worse = (LEVEL_ORDER[r.classification.level] || 0) > (LEVEL_ORDER[prev.level] || 0);
        return `<span class="strat-trend ${worse ? "strat-trend-bad" : "strat-trend-good"}">${worse ? "&#9650;" : "&#9660;"} was ${esc(prev.level)}</span>`;
      };
      const rowHtml = (r) => `
          <tr>
            <td><button type="button" class="strat-link" data-strat-country="${r.iso3}">${esc(r.country)}</button><br><small class="muted">${esc(GROUP_LABEL[r.group] || r.group)}</small></td>
            <td>${rowTag(r)}</td>
            ${base ? `<td>${changeCell(r)}</td>` : ""}
            <td class="num">${r.classification.score}/${r.classification.max_score}</td>
            <td>${r.classification.points.length
              ? `<div class="strat-chips">${r.classification.points.map((p) => `<span class="strat-chip" title="${esc(p.criterion)}">${esc(chipLabel(p))} <b>+${p.score}</b></span>`).join("")}</div>`
              : '<span class="muted">none</span>'}</td>
            <td class="num">${r.classification.indicators_available ?? "n/a"}/4</td>
            <td>${(r.classification.missing || []).length ? `<small class="muted">${esc(r.classification.missing.join("; "))}</small>` : '<small class="muted">all current</small>'}</td>
            ${anyGrades ? `<td>${(r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)} <small>(${esc(g.date_graded)})</small>`).join("<br>") || '<span class="muted">none</span>'}</td>` : ""}
          </tr>`;
      table.classList.add("strat-grading-table");
      table.innerHTML = `
        <thead><tr><th>Country</th><th>DHM triage tier</th>${base ? `<th>Tier in ${esc(monthLabel(base.month))}</th>` : ""}<th>Points</th><th>Criteria met (points)</th><th title="Core indicators with a current figure: INFORM Risk, health people in need, IPC/CH, displacement">Data</th><th>Missing or outdated</th>${anyGrades ? "<th>WHO grade</th>" : ""}</tr></thead>
        <tbody>${core.map(rowHtml).join("")}
          ${others.length ? `<tr class="strat-group-row"><td colspan="${cols}">Other FCV-classified and cross-border context countries (not counted in the 13-country totals)</td></tr>${others.map(rowHtml).join("")}` : ""}
        </tbody>`;
    }

    const reg = el("gradingRegister");
    if (reg) {
      const g = state.payload.grading.rows || [];
      reg.innerHTML = g.length
        ? `<div class="table-wrap"><table class="strat-table"><thead><tr><th>Country</th><th>Event</th><th>Grade</th><th>Graded</th><th>Last review</th></tr></thead><tbody>${g.map((x) => `<tr><td>${esc(x.country || x.iso3)}</td><td>${esc(x.event)}</td><td>${esc(x.grade)}</td><td>${esc(x.date_graded)}</td><td>${esc(x.last_reviewed)}</td></tr>`).join("")}</tbody></table></div>`
        : `<p>No WHO grades have been entered yet. DHM adds one row per graded event (Grade 1 to 3 or Protracted 1 to 3) to <code>data/who-grading.csv</code> in the GitHub repository; the dashboard picks it up on the next deploy.</p>`;
    }

    const rules = el("gradingRules");
    if (rules) {
      const cr = state.payload.classification_rules;
      rules.innerHTML = `<p>${esc(cr.note)}</p>
        <ul>${cr.criteria.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
        <p><strong>Levels:</strong> ${Object.entries(cr.levels).map(([k, v]) => `${levelTag(k)} ${esc(v)}`).join(" &nbsp; ")}</p>`;
    }
  }

  // ---------- Country profile card ----------
  function renderCountryCard() {
    const node = el("stratCountryCard");
    if (!node) return;
    const select = el("countrySelect");
    const iso3 = select ? select.value : null;
    const r = (state.payload?.countries || []).find((c) => c.iso3 === iso3);
    if (!r) {
      node.innerHTML = `<div class="panel-header"><h2>Strategic Country Card</h2><p>The selected country is outside the FCV reference list. Strategic indicators are compiled for the 13 FCV countries, other FCV-classified countries, Sudan and Somalia.</p></div>`;
      return;
    }
    const f = r.health_funding;
    const items = [
      ["DHM triage tier", `${rowTag(r)} ${r.classification.score}/${r.classification.max_score}`, r.classification.uses_last_plan ? "Rule-based, not a WHO grade. Provisional: uses the last plan's figure" : r.classification.level === "Insufficient data" ? `Rule-based, not a WHO grade. Missing: ${esc((r.classification.missing || []).join("; "))}` : "Rule-based, not a WHO grade"],
      ["WHO grade", (r.who_grades || []).map((g) => esc(g.grade)).join(", ") || "none recorded", "WHO grading register"],
      ["Humanitarian plan", r.plan && !r.health_outdated && !/^non[ -]?plan$/i.test(r.plan.name || "") ? esc(r.plan.name || r.plan.code) : "no current plan",
        f ? "OCHA FTS" : r.health_outdated ? `Last plan: ${esc(r.health_outdated.plan_name || r.health_outdated.year)}` : r.plan ? "FCV country profile (DHM)" : "HDX HAPI"],
      ["People in need (all sectors)", fmtCompact(r.people_in_need?.value), r.people_in_need ? `${esc(r.people_in_need.source)}, ${esc(r.people_in_need.year)}` : ""],
      ["People in need of health assistance", r.health_in_need
        ? `${fmtCompact(r.health_in_need.value)}${r.health_in_need_previous ? ` <small>(${esc(r.health_in_need_previous.year)}: ${fmtCompact(r.health_in_need_previous.value)})</small>` : ""}`
        : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (last plan, ${esc(r.health_outdated.year)})` : "n/a",
        r.health_in_need ? `${esc(plainSource(r.health_in_need.source))}, ${esc(r.health_in_need.plan_code || r.health_in_need.year)}${r.health_in_need.alt ? `. Revised plan; earlier version on HDX: ${fmtCompact(r.health_in_need.alt.value)}` : ""}`
          : r.health_outdated ? `${esc(r.health_outdated.plan_name || r.health_outdated.source)}, ended ${esc(fmtMonth(r.health_outdated.plan_end))}. ${r.health_outdated.counts_for_tier ? "Used for the triage tier only, which is shown as provisional" : `Not used: ${esc((r.health_outdated.rule || "too old").toLowerCase())}`}` : "No humanitarian plan"],
      ["Health targeted", fmtCompact(r.health_targeted?.value), r.health_targeted ? `${esc(r.health_targeted.source)}, ${esc(r.health_targeted.year)}` : ""],
      ["Health Cluster reach", r.health_reached
        ? `${fmtCompact(r.health_reached.value)} reached${isNum(r.health_targeted?.value) ? ` of ${fmtCompact(r.health_targeted.value)} targeted` : ""}`
        : r.health_reach_latest
          ? `${fmtCompact(r.health_reach_latest.reached)} of ${fmtCompact(r.health_reach_latest.targeted)} targeted (${fmtPct(r.health_reach_latest.reached / Math.max(1, r.health_reach_latest.targeted))}) in ${esc(r.health_reach_latest.year)}${r.health_reach_latest.full_year || r.health_reach_latest.year === String(new Date().getFullYear()) ? "" : `, reported to ${esc(fmtMonth(r.health_reach_latest.period_end))} only`}`
          : r.health_reach_excluded
            ? `not usable: ${fmtFull(r.health_reach_excluded.reached)} reported against ${fmtCompact(r.health_reach_excluded.targeted)} targeted in the ${esc(r.health_reach_excluded.plan_name || r.health_reach_excluded.year)}, likely a reporting error`
            : r.health_in_need ? "not yet published" : "no humanitarian plan",
        r.health_reached ? esc(r.health_reached.source)
          : r.health_reach_latest ? `OCHA Humanitarian Action, ${esc(r.health_reach_latest.plan_name || r.health_reach_latest.plan_code || "")}, to ${esc(fmtMonth(r.health_reach_latest.period_end))}` : "OCHA Humanitarian Action (response monitoring)"],
      ["Change since last month", (() => {
        const prev = baseSnapshot()?.countries?.[r.iso3];
        if (!prev) return baseSnapshot() ? "n/a" : `from ${esc(nextMonthLabel(state.payload.history?.first_month || new Date().toISOString().slice(0, 7)))}`;
        const bits = [];
        if (prev.level && prev.level !== r.classification.level) bits.push(`tier ${esc(prev.level)} to ${esc(r.classification.level)}`);
        if (baseSameYear() && isNum(prev.health_requirements_usd) && prev.health_requirements_usd > 0 && f && Math.abs(prev.health_funding_usd / prev.health_requirements_usd - f.pct) >= 0.005) bits.push(`funded ${fmtPct(prev.health_funding_usd / prev.health_requirements_usd)} to ${fmtPct(f.pct)}`);
        if (isNum(prev.idps) && r.idps && !r.idps.stale && prev.idps !== r.idps.value) bits.push(`IDPs ${fmtCompact(prev.idps)} to ${fmtCompact(r.idps.value)}`);
        if (isNum(prev.attacks_ytd) && r.attacks && baseSameYear() && r.attacks.ytd.attacks > prev.attacks_ytd) bits.push(`${fmtFull(r.attacks.ytd.attacks - prev.attacks_ytd)} new attacks recorded`);
        return bits.length ? bits.join("; ") : "no change";
      })(), baseSnapshot() ? `Compared with the ${esc(monthLabel(baseSnapshot().month))} snapshot` : "Monthly snapshots"],
      ["Health funding", f ? `${fmtUsd(f.funding_usd)} of ${fmtUsd(f.requirements_usd)} (${fmtPct(f.pct)})` : "n/a", f ? "OCHA FTS" : ""],
      ["IDPs", r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? " (outdated)" : ""}` : "n/a", r.idps ? `${esc(r.idps.source)}, ${esc(fmtMonth(r.idps.date))}` : ""],
      ["Refugees and asylum seekers hosted", fmtCompact(r.refugees?.value), r.refugees ? `${esc(r.refugees.source)}, ${esc(r.refugees.year)}` : ""],
      ["IPC/CH Phase 3+ (share of the population analysed)", r.ipc ? `${fmtPct(r.ipc.fraction)} (${fmtCompact(r.ipc.population)} people)${r.ipc.stale ? ", outdated" : ""}` : "no analysis", r.ipc ? `IPC, ${fmtMonth(r.ipc.period_start)} to ${fmtMonth(r.ipc.period_end)} (${esc(r.ipc.kind)})` : ""],
      ["Attacks on health care this year", r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} attacks, ${fmtFull(r.attacks.ytd.deaths)} killed, ${fmtFull(r.attacks.ytd.injuries)} injured` : "not monitored by SSA", r.attacks ? "WHO SSA" : ""],
      ["INFORM Risk (0 to 10)", r.inform_risk ? `${esc(r.inform_risk.overall)} (global rank ${esc(r.inform_risk.global_rank)})` : "n/a", r.inform_risk ? `EC JRC, ${esc(r.inform_risk.year)}` : ""]
    ];
    node.innerHTML = `
      <div class="panel-header"><h2>Strategic Country Card: ${esc(r.country)}</h2><p>${esc(GROUP_LABEL[r.group] || "")} country. Verified sources only; each line shows its source and date.</p></div>
      <div class="strat-card-grid">${items.map(([k, v, s]) => `<div class="strat-card-item"><span class="strat-card-label">${k}</span><span class="strat-card-value">${v}</span>${s ? `<span class="strat-source">${s}</span>` : ""}</div>`).join("")}</div>
      ${sourcesBar(["hpc", "hapi", "fts", "dtm", "unhcr", "ipc", "ssa", "inform", "grading"])}`;
  }

  // ---------- Conflict & displacement panel ----------
  function renderDisplacementPanel() {
    const node = el("stratDisplacementPanel");
    if (!node) return;
    const rows = rowsInScope("withcontext").filter((r) => r.idps || r.refugees)
      .sort((a, b) => ((b.idps?.value || 0) + (b.refugees?.value || 0)) - ((a.idps?.value || 0) + (a.refugees?.value || 0)));
    const fcv = rowsInScope("fcv13");
    node.innerHTML = `
      <div class="panel-header"><h2>Verified Displacement Figures</h2>
      <p>IOM DTM internal displacement and UNHCR refugee figures through OCHA HDX HAPI. 13 FCV countries: <strong>${fmtCompact(sum(fcv, (r) => (r.idps && !r.idps.stale ? r.idps.value : null)))}</strong> IDPs and <strong>${fmtCompact(sum(fcv, (r) => r.refugees?.value))}</strong> refugees and asylum seekers hosted. DTM figures older than 24 months are replaced by the 2026 plan figure where one exists.</p></div>
      <div class="table-wrap"><table class="strat-table">
        <thead><tr><th>Country</th><th>Group</th><th>IDPs</th><th>As of</th><th>IDP source</th><th>Refugees hosted</th><th>Year</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.country)}</td><td>${esc(GROUP_LABEL[r.group] || r.group)}</td>
          <td class="num">${r.idps ? cellStale(fmtFull(r.idps.value), r.idps.stale) : "n/a"}</td>
          <td>${r.idps ? esc(/^\d{4}$/.test(String(r.idps.date)) ? `${r.idps.date} plan` : r.idps.date) : ""}</td>
          <td><small>${r.idps ? esc(r.idps.source) : ""}</small></td>
          <td class="num">${r.refugees ? fmtFull(r.refugees.value) : "n/a"}</td>
          <td>${r.refugees ? esc(r.refugees.year) : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">The source-signal analysis below counts news and report items. Use it to see where displacement is being reported, not to measure it.</p>`;
  }

  // ---------- Attacks on health care panel ----------
  function renderSsaPanel() {
    const node = el("stratSsaPanel");
    if (!node) return;
    const rows = rowsInScope("withcontext").filter((r) => r.attacks)
      .sort((a, b) => b.attacks.ytd.attacks - a.attacks.ytd.attacks || b.attacks.ytd.deaths - a.attacks.ytd.deaths);
    const fcv = rowsInScope("fcv13").filter((r) => r.attacks);
    const year = new Date().getFullYear();
    const annualCell = (r, y) => {
      const a = (r.attacks.annual || []).find((x) => x.year === y);
      return a ? `${fmtFull(a.attacks)} <small>(${fmtFull(a.deaths)} killed)</small>` : '<span class="muted">none recorded</span>';
    };
    const notMonitored = rowsInScope("fcv13").filter((r) => !r.attacks).map((r) => shortName(r.country));
    node.innerHTML = `
      <div class="panel-header"><h2>Verified Attacks on Health Care (WHO SSA)</h2>
      <p>Confirmed and probable attacks recorded in the WHO Surveillance System for Attacks on Health Care, ${year} to date. Updated ${fmtDate(state.payload.sources.ssa.fetched_at)}.</p></div>
      <div class="two-col strat-ssa-grid">
        <div class="table-wrap"><table class="strat-table">
          <thead><tr><th>Country</th><th>${year} attacks</th><th>Killed</th><th>Injured</th><th>Same period ${year - 1}</th><th>Full year ${year - 1}</th><th>Full year ${year - 2}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.country)}${r.group === "context" ? ' <small class="muted">(context)</small>' : ""}</td>
            <td class="num"><strong>${fmtFull(r.attacks.ytd.attacks)}</strong></td><td class="num">${fmtFull(r.attacks.ytd.deaths)}</td><td class="num">${fmtFull(r.attacks.ytd.injuries)}</td>
            <td class="num">${r.attacks.prev_ytd ? fmtFull(r.attacks.prev_ytd.attacks) : "n/a"}</td><td class="num">${annualCell(r, year - 1)}</td><td class="num">${annualCell(r, year - 2)}</td></tr>`).join("")}</tbody></table></div>
        <div id="stratSsaChart" class="chart strat-chart"></div>
      </div>
      <p class="muted">Regional totals on the Overview count the 13 FCV countries only; Sudan and Somalia are listed here for context and are not in those totals.</p>
      <p class="muted">Not covered by the WHO attacks surveillance system: ${esc(notMonitored.join(", ") || "none")}. For these countries use Health Cluster and Insecurity Insight reporting. <a href="https://extranet.who.int/ssa/Index.aspx" target="_blank" rel="noopener">Open the SSA portal</a>.</p>
      <p class="muted">The news items further down this page are keyword matches from public reporting. They are context only and are not verified incidents.</p>`;
    renderSsaChart(rows);
  }

  function renderSsaChart(rows) {
    const node = el("stratSsaChart");
    if (!node || typeof Plotly === "undefined") return;
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: monthNames[d.getMonth()], label: `${monthNames[d.getMonth()]} ${String(d.getFullYear()).slice(2)}` });
    }
    const palette = ["#0b4ea2", "#d9662b", "#2e8b6e", "#8e1b3a", "#e9b949", "#4a6fa5", "#7f5a9e", "#1fb7c6", "#9c6b30", "#5b6770"];
    const traces = rows.filter((r) => (r.attacks.monthly || []).length).map((r, i) => ({
      type: "bar",
      name: shortName(r.country),
      x: months.map((mo) => mo.label),
      y: months.map((mo) => (r.attacks.monthly.find((x) => x.year === mo.y && x.month === mo.m) || {}).attacks || 0),
      marker: { color: palette[i % palette.length] },
      hovertemplate: `${shortName(r.country)}: %{y} attacks in %{x}<extra></extra>`
    }));
    if (!traces.length) {
      emptyNote(node, "No attacks recorded in the last 12 months.");
      return;
    }
    plot(node, traces, {
      barmode: "stack",
      margin: { l: 40, r: 10, t: 10, b: 60 },
      height: 320,
      yaxis: { title: { text: "Attacks per month" }, gridcolor: "#e6edf5" },
      legend: { orientation: "h", y: -0.25 },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      font: FONT
    });
  }

  // ---------- Data health ----------
  function renderDataHealth() {
    const node = el("dataHealthSources");
    if (node && state.payload) {
      const s = state.payload.sources;
      const line = (name, src, extra = "") => {
        const st = src.status || {};
        const ok = st.ok != null && st.total != null ? `${st.ok}/${st.total} loaded` : "";
        return `<tr><td>${esc(name)}</td><td>${fmtDate(src.fetched_at || src.updated_at || src.loaded_at)}</td><td>${esc(ok)}</td><td>${extra}</td></tr>`;
      };
      node.innerHTML = `<div class="table-wrap"><table class="strat-table">
        <thead><tr><th>Source</th><th>Last successful update</th><th>Coverage</th><th>Notes</th></tr></thead>
        <tbody>
          ${line(s.hapi.name, s.hapi, "Refreshes every 12 hours; country rows fall back to the last good value.")}
          ${line(s.fts.name, s.fts, `Plan year ${esc(s.fts.year || "n/a")}.`)}
          ${s.hpc ? line(s.hpc.name, s.hpc, "Health Cluster people in need, targeted and reached, per plan. Reach appears once OCHA generates the plan's monitoring.") : ""}
          ${line("Monthly KPI snapshots", { updated_at: state.payload.history?.latest_taken_at || null }, `${(state.payload.history?.months || []).length} ${(state.payload.history?.months || []).length === 1 ? "month" : "months"} held (${esc((state.payload.history?.months || []).map(monthLabel).join(", ") || "none yet")}). Used for the "since last month" arrows.`)}
          ${line(s.ssa.name, s.ssa, "Countries with an SSA deployment only.")}
          ${line(s.grading.name, { updated_at: s.grading.updated_at }, `Grading register maintained by DHM (<code>${esc(s.grading.file)}</code> in GitHub).`)}
          ${line(s.profile.name, { loaded_at: s.profile.loaded_at }, "Fallback for plan figures not yet in HDX HAPI.")}
        </tbody></table></div>
        <p class="muted">Oldest source in cache: ${isNum(state.payload.cache_age_hours) && Number.isFinite(state.payload.cache_age_hours) ? `${Math.max(0, state.payload.cache_age_hours).toFixed(1)} hours` : "n/a"}.</p>
        ${(() => {
          const rf = s.refresh || {};
          const status = rf.running ? `Refresh running (step: ${esc(rf.step || "starting")}, started ${fmtDate(rf.started_at)})` : rf.finished_at ? `Last refresh attempt finished ${new Date(rf.finished_at).toLocaleString("en-GB")}` : "No refresh attempted since the server started";
          const errs = (rf.errors || []).map((e) => `<li><strong>${esc(e.source)}</strong>: ${esc(e.message)}</li>`).join("");
          return `<p><strong>Automatic refresh:</strong> ${status}.</p>${errs ? `<p>Problems in the last attempt (the last good values are kept):</p><ul class="bulletin-list">${errs}</ul>` : ""}`;
        })()}`;
    }
    const vnode = el("dataHealthValidation");
    if (vnode) {
      const v = state.dash?.service_delivery_status?.validation?.fields || null;
      if (!v || !Object.keys(v).length) {
        emptyNote(vnode, "No values were excluded in the latest load.");
      } else {
        const label = {
          opd_consultations_per_person_per_month: "OPD consultations per person per month",
          anc_visits_mean: "Mean ANC visits",
          deliveries_in_health_institution_pct: "Institutional deliveries (%)",
          measles_vaccination_coverage_pct: "Measles coverage (%)",
          penta_vaccination_coverage_pct: "PENTA coverage (%)",
          sam_complications_pct: "SAM with complications (%)",
          sam_complications_managed_pct: "SAM complications managed (%)",
          facility_disruption_pct: "Facilities with disruption (%)",
          h3_package_pct: "Facilities with H3 package (%)"
        };
        vnode.innerHTML = `<div class="table-wrap"><table class="strat-table">
          <thead><tr><th>Indicator</th><th>Rule</th><th>Rows excluded</th><th>By country</th></tr></thead>
          <tbody>${Object.entries(v).sort((a, b) => b[1].excluded_rows - a[1].excluded_rows).map(([k, x]) => `<tr>
            <td>${esc(label[k] || k)}</td><td>${esc(x.rule)}</td><td class="num">${fmtFull(x.excluded_rows)}</td>
            <td><small>${Object.entries(x.by_country).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${esc(c)} ${n}`).join(", ")}</small></td></tr>`).join("")}</tbody></table></div>
          <p class="muted">Source file: FCV-Services-Deliveries-Database.csv in the GitHub repository, maintained by the FCV data focal point.</p>`;
      }
    }
  }

  // ---------- Key-figure cards on every page ----------
  const LINKS = {
    hapi: ["OCHA HDX HAPI", "https://hapi.humdata.org"],
    hpc: ["OCHA Humanitarian Action (plans and response monitoring)", "https://humanitarianaction.info"],
    fts: ["OCHA Financial Tracking Service", "https://fts.unocha.org"],
    dtm: ["IOM Displacement Tracking Matrix", "https://dtm.iom.int"],
    unhcr: ["UNHCR Refugee Data Finder", "https://www.unhcr.org/refugee-statistics"],
    acled: ["ACLED Conflict Index", "https://acleddata.com/conflict-index/"],
    ssa: ["WHO Surveillance System for Attacks on Health Care", "https://extranet.who.int/ssa/Index.aspx"],
    ipc: ["Integrated Food Security Phase Classification (IPC)", "https://www.ipcinfo.org"],
    fews: ["FEWS NET", "https://fews.net"],
    gdacs: ["GDACS (UN and European Commission)", "https://www.gdacs.org"],
    glofas: ["Copernicus GloFAS flood forecasts", "https://global-flood.emergency.copernicus.eu"],
    emdat: ["EM-DAT disaster database", "https://www.emdat.be"],
    reliefweb: ["ReliefWeb", "https://reliefweb.int"],
    meteo: ["Météo-France La Réunion (RSMC cyclones)", "https://www.meteofrance.re/fr/cyclone"],
    wmo: ["WMO Severe Weather Information Centre", "https://severeweather.wmo.int"],
    cpc: ["NOAA CPC ENSO advisory", "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"],
    icpac: ["ICPAC climate forecasts", "https://www.icpac.net"],
    grading: ["WHO emergency grading", "https://www.who.int/emergencies/grading"],
    inform: ["INFORM Risk and Severity (EC JRC)", "https://drmkc.jrc.ec.europa.eu/inform-index"],
    herams: ["HeRAMS health facility monitoring", "https://www.who.int/initiatives/herams"],
    fcvdb: ["FCV service database (GitHub)", "https://github.com/Fescosof123/who-afro-dashboard/blob/main/FCV-Services-Deliveries-Database.csv"]
  };

  function sourcesBar(keys) {
    return `<p class="strat-sources-bar"><span>Sources:</span> ${keys.filter((k) => LINKS[k]).map((k) => `<a href="${LINKS[k][1]}" target="_blank" rel="noopener">${esc(LINKS[k][0])}</a>`).join(" &middot; ")}</p>`;
  }

  function ensureStrip(pageId) {
    const page = el(pageId);
    if (!page) return null;
    let strip = el(`strip-${pageId}`);
    if (!strip) {
      strip = document.createElement("section");
      strip.id = `strip-${pageId}`;
      strip.className = "panel strat-page-strip";
      page.insertBefore(strip, page.firstChild);
    }
    return strip;
  }

  function renderStrip(pageId, title, note, cards, sourceKeys) {
    const strip = ensureStrip(pageId);
    if (!strip) return;
    strip.innerHTML = `
      <div class="panel-header"><h2>${title}</h2>${note ? `<p>${note}</p>` : ""}</div>
      <div class="strat-kpi-grid strat-strip-grid">${cards.map(kpiCard).join("")}</div>
      ${sourcesBar(sourceKeys)}`;
  }

  function fcvRows() {
    return rowsInScope("fcv13");
  }

  function names(list, max = 4) {
    const shown = list.slice(0, max).map((r) => esc(shortName(r.country || r)));
    return shown.join(", ") + (list.length > max ? ` and ${list.length - max} more` : "");
  }

  function latestFcvQuarter() {
    const rows = state.dash?.service_delivery_quarterly_rows || [];
    if (!rows.length) return null;
    const maxSort = Math.max(...rows.map((r) => Number(r.quarter_sort) || 0));
    const inQ = rows.filter((r) => Number(r.quarter_sort) === maxSort);
    return { label: inQ[0]?.quarter_label || null, rows: inQ };
  }

  function renderDisplacementStrip() {
    const rows = fcvRows();
    const disp = rows.map((r) => ({ r, v: (r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0) }));
    const over1m = disp.filter((x) => x.v >= 1e6).sort((a, b) => b.v - a.v);
    const top = rows.filter((r) => r.refugees).sort((a, b) => b.refugees.value - a.refugees.value)[0];
    const acled = (state.dash?.countries || []).filter((c) => (c.fcv_track || "").startsWith("FCV") && /extreme|high/i.test(c.acled_index?.index_level || ""));
    renderStrip("conflictsDisplacementPage", "Conflict and Displacement: Key Figures", "13 FCV countries. Click a card to go to the detail.", [
      { id: "cdIdps", title: "Internally displaced people", value: fmtCompact(sum(rows, (r) => (r.idps && !r.idps.stale ? r.idps.value : null))), sub: "Current IOM DTM figures, or the 2026 plan figure where DTM is outdated or covers only part of the country. Outdated figures are left out.", source: "IOM DTM via HDX HAPI", target: "conflictsDisplacementPage#stratDisplacementPanel" },
      { id: "cdRef", title: "Refugees and asylum seekers hosted", value: fmtCompact(sum(rows, (r) => r.refugees?.value)), sub: `Largest host: ${top ? esc(shortName(top.country)) : "n/a"}.`, source: "UNHCR via HDX HAPI", target: "conflictsDisplacementPage#stratDisplacementPanel" },
      { id: "cdOver1m", title: "Countries with 1 million or more displaced or hosted", value: String(over1m.length), sub: names(over1m.map((x) => x.r)) || "None", source: "IOM DTM and UNHCR", target: "conflictsDisplacementPage#stratDisplacementPanel", tone: over1m.length ? "warn" : "" },
      { id: "cdAcled", title: "Countries at high or extreme conflict level", value: String(acled.length), sub: acled.length ? names(acled) : "No FCV country in the high or extreme band.", source: "ACLED Conflict Index", target: "conflictsDisplacementPage#conflictsDisplacementTable", tone: acled.length ? "bad" : "" }
    ], ["dtm", "unhcr", "acled", "hapi"]);
  }

  function renderAttacksStrip() {
    const rows = fcvRows().filter((r) => r.attacks);
    const year = new Date().getFullYear();
    const rising = rows.filter((r) => r.attacks.prev_ytd && r.attacks.ytd && r.attacks.ytd.attacks >= 10 && r.attacks.ytd.attacks > r.attacks.prev_ytd.attacks * 1.25);
    const notCovered = fcvRows().filter((r) => !r.attacks);
    renderStrip("attacksHealthPage", "Attacks on Health Care: Key Figures", `WHO SSA, 13 FCV countries, ${year} to date. Updated ${fmtDate(state.payload.sources.ssa.fetched_at)}.`, [
      { id: "ahAttacks", title: "Attacks this year", value: fmtFull(sum(rows, (r) => r.attacks.ytd?.attacks)), sub: `Same period ${year - 1}: ${fmtFull(sum(rows, (r) => r.attacks.prev_ytd?.attacks))}.`, source: "WHO SSA", target: "attacksHealthPage#stratSsaPanel" },
      { id: "ahKilled", title: "People killed", value: fmtFull(sum(rows, (r) => r.attacks.ytd?.deaths)), sub: `${fmtFull(sum(rows, (r) => r.attacks.ytd?.injuries))} injured.`, source: "WHO SSA", target: "attacksHealthPage#stratSsaPanel", tone: "bad" },
      { id: "ahRising", title: "Countries with a clear rise in attacks", value: String(rising.length), sub: rising.length ? names(rising) : "None", source: "WHO SSA: 10 or more and 25% above the same period last year", target: "attacksHealthPage#stratSsaPanel", tone: rising.length ? "warn" : "" },
      { id: "ahGap", title: "Not covered by WHO surveillance", value: String(notCovered.length), sub: notCovered.length ? `${names(notCovered, 5)}. Use Health Cluster reporting for these.` : "All covered", source: "WHO SSA country coverage", target: "attacksHealthPage#stratSsaPanel" }
    ], ["ssa", "reliefweb"]);
  }

  function renderFoodStrip() {
    const rows = fcvRows();
    const cur = rows.filter((r) => r.ipc && !r.ipc.stale && isNum(r.ipc.fraction));
    const over20 = cur.filter((r) => r.ipc.fraction >= 0.2).sort((a, b) => b.ipc.fraction - a.ipc.fraction);
    const top = cur.slice().sort((a, b) => b.ipc.fraction - a.ipc.fraction)[0];
    const none = rows.filter((r) => !r.ipc || r.ipc.stale);
    renderStrip("foodSecurityPage", "Food Security: Key Figures", "IPC and Cadre Harmonisé analyses less than 18 months old, 13 FCV countries. Shares refer to the population analysed.", [
      { id: "fsPeople", title: "People in IPC/CH Phase 3 or above", value: fmtCompact(sum(cur, (r) => r.ipc.population)), sub: `${cur.length} countries with a current analysis or projection.`, source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable" },
      { id: "fsOver20", title: "Countries with 20% or more in Phase 3+", value: String(over20.length), sub: names(over20) || "None", source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable", tone: over20.length ? "bad" : "" },
      { id: "fsTop", title: "Highest share in Phase 3+", value: top ? fmtPct(top.ipc.fraction) : "n/a", sub: top ? `${esc(shortName(top.country))}, ${top.ipc.kind === "current" ? "current" : "projection"} ${fmtMonth(top.ipc.period_start)} to ${fmtMonth(top.ipc.period_end)}.` : "", source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable" },
      { id: "fsNone", title: "No current analysis", value: String(none.length), sub: none.length ? `${names(none, 5)}. Analyses older than 18 months are not used.` : "All countries covered", source: "IPC via HDX HAPI", target: "foodSecurityPage#foodSecurityTable", tone: none.length ? "warn" : "" }
    ], ["ipc", "fews", "hapi"]);
  }

  function renderNutritionStrip() {
    const q = latestServiceQuarter();
    const rows = fcvRows().map((r) => q[r.iso3]).filter(Boolean);
    const screened = rows.filter((x) => isNum(x.children_screened_malnutrition));
    const samRows = fcvRows().map((r) => ({ r, q: q[r.iso3] })).filter((x) => x.q && isNum(x.q.sam_complications_managed_pct))
      .sort((a, b) => a.q.sam_complications_managed_pct - b.q.sam_complications_managed_pct);
    const quarters = [...new Set(rows.map((x) => x.quarter_label).filter(Boolean))].sort();
    const qLabel = quarters.length > 1 ? `${quarters[0]} to ${quarters[quarters.length - 1]}` : quarters[0] || "latest quarter";
    renderStrip("nutritionPage", "Nutrition: Key Figures", "Latest reported quarter per country from the FCV service database. Survey-based acute malnutrition (GAM, SAM) should come from SMART surveys or IPC Acute Malnutrition analyses.", [
      { id: "nuScreened", title: "Children screened for malnutrition (latest quarter)", value: fmtCompact(sum(screened, (x) => x.children_screened_malnutrition)), sub: `${screened.length} countries, each country's latest reported quarter (${esc(qLabel)}). The FCV Response page also shows the total across all quarters.`, source: "FCV service database", target: "fcvDataPage" },
      { id: "nuSam", title: "Complicated SAM cases managed: lowest country", value: samRows.length ? fmtPct(samRows[0].q.sam_complications_managed_pct / 100) : "n/a", sub: samRows.length ? `${esc(shortName(samRows[0].r.country))} (${esc(samRows[0].q.quarter_label || "")}). Range across ${samRows.length} countries: ${fmtPct(samRows[0].q.sam_complications_managed_pct / 100)} to ${fmtPct(samRows[samRows.length - 1].q.sam_complications_managed_pct / 100)}.` : "No country reported this indicator.", source: "FCV service database", target: "fcvDataPage" },
      { id: "nuAmn", title: "Acute malnutrition analyses", value: "Open maps", sub: "Open the IPC Acute Malnutrition maps for the latest survey-based figures by country.", source: "IPC", target: "https://www.ipcinfo.org/ipc-country-analysis/en/" }
    ], ["fcvdb", "ipc"]);
  }

  function renderHazardStrip() {
    const hz = (state.dash?.hazards || []).filter((h) => (h.countries || []).length);
    const level = (h) => {
      const raw = String(h.alert_level || h.alertlevel || h.title || "").toLowerCase();
      return /^red|\bred\b/.test(raw) ? "red" : /^orange|\borange\b/.test(raw) ? "orange" : "green";
    };
    const hazardFeedEmpty = !(state.dash?.hazards || []).length;
    const redOrange = hz.filter((h) => level(h) !== "green");
    const countries = [...new Set(hz.flatMap((h) => h.countries))];
    const floods = state.dash?.regional_flood_signals || [];
    const enso = state.dash?.enso_advisory;
    renderStrip("hazardPage", "Hazards and Floods: Key Figures", "Natural hazard alerts linked to African countries in the current refresh.", [
      { id: "hzAlerts", title: "GDACS alerts (all levels)", value: hazardFeedEmpty ? "No data" : String(hz.length), sub: `${redOrange.length} orange or red; the rest are green (low expected impact).`, source: "GDACS", target: "hazardPage#gdacsSummary", tone: redOrange.length ? "warn" : "" },
      { id: "hzCountries", title: "Countries with an active alert", value: String(countries.length), sub: countries.slice(0, 6).map((iso) => esc(shortName((state.dash?.countries || []).find((c) => c.iso3 === iso)?.country || iso))).join(", ") + (countries.length > 6 ? ` and ${countries.length - 6} more` : "") || "None", source: "GDACS", target: "hazardPage#hazardFeed" },
      { id: "hzFloods", title: "Flood updates", value: floods.length ? String(floods.length) : "None in feed", sub: "Flood advisories and situation reports in the current window.", source: "ReliefWeb, GloFAS", target: "hazardPage#floodWatchSummary" },
      { id: "hzEnso", title: "ENSO status", value: enso?.alert_status ? esc(enso.alert_status) : "n/a", sub: enso?.issued_on ? `Issued ${esc(enso.issued_on)}; next update ${esc(enso.next_update || "n/a")}.` : "", source: "NOAA CPC", target: "forecastPage" }
    ], ["gdacs", "glofas", "reliefweb", "emdat"]);
  }

  function renderCycloneStrip() {
    const c = state.dash?.cyclone_intelligence || {};
    renderStrip("cyclonePage", "Cyclone Watch: Key Figures", "The South-West Indian Ocean cyclone season runs from November to April.", [
      { id: "cyActive", title: "Named cyclones, last 21 days", value: fmtFull(c.active_cyclone_count || 0), sub: `Last ${c.active_window_days || 21} days.`, source: "Météo-France La Réunion, WMO", target: "cyclonePage#activeCyclonesList", tone: c.active_cyclone_count ? "bad" : "" },
      { id: "cyProj", title: "Forecast tracks and advisories", value: fmtFull(c.projection_signal_count || 0), sub: "Forecast tracks and advisories in the current refresh.", source: "Météo-France, WMO", target: "cyclonePage#cycloneProjectionFeed" },
      { id: "cyCountries", title: "Countries with a cyclone signal", value: fmtFull(c.countries_with_cyclone_signal || 0), sub: "Mapped from advisories to country names.", source: "Météo-France, GDACS", target: "cyclonePage#cycloneCountryTable" }
    ], ["meteo", "wmo", "gdacs"]);
  }

  function renderForecastStrip() {
    const enso = state.dash?.enso_advisory;
    const fc = state.dash?.forecasts || [];
    const elevated = fc.filter((f) => f.risk_level && !/watch|low|normal/i.test(f.risk_level));
    renderStrip("forecastPage", "Climate Forecasts: Key Figures", "Seasonal climate outlooks that can change health risk (floods, drought, disease).", [
      { id: "fcEnso", title: "ENSO status", value: enso?.alert_status ? esc(enso.alert_status) : "n/a", sub: enso?.synopsis ? esc(enso.synopsis) : "", source: `NOAA CPC${enso?.issued_on ? `, ${esc(enso.issued_on)}` : ""}`, target: enso?.url || LINKS.cpc[1], tone: /el ni|la ni/i.test(enso?.alert_status || "") ? "warn" : "" },
      { id: "fcIcpac", title: "ICPAC forecast bulletins", value: String(fc.length), sub: "Weekly, monthly and seasonal products for the Greater Horn of Africa.", source: "ICPAC", target: "forecastPage#icpacFeed" },
      { id: "fcElevated", title: "Bulletins above watch level", value: String(elevated.length), sub: elevated.length ? elevated.slice(0, 2).map((f) => esc(f.title)).join("; ") : "None above watch level.", source: "ICPAC", target: "forecastPage#forecastTable" }
    ], ["cpc", "icpac", "fews"]);
  }

  function renderFcvStrip() {
    const q = latestFcvQuarter();
    const fcvIso = new Set(fcvRows().map((r) => r.iso3));
    const rows = (q?.rows || []).filter((r) => fcvIso.has(r.iso3));
    const v = state.dash?.service_delivery_status?.validation?.fields || {};
    const excluded = Object.values(v).reduce((s2, x) => s2 + (x.excluded_rows || 0), 0);
    renderStrip("fcvDataPage", "FCV Response: Key Figures", `Most recent quarter in the FCV service database: ${esc(q?.label || "n/a")}.`, [
      { id: "fvReporting", title: "Countries reporting", value: `${rows.length}<small> of 13</small>`, sub: `In ${esc(q?.label || "the latest quarter")}. Reports for the most recent quarter may still be arriving.`, source: "FCV service database", target: "fcvDataPage#fcvRegReportingHeatmap", tone: rows.length < 9 ? "warn" : "" },
      { id: "fvReached", title: "Service contacts reported", value: fmtCompact(sum(rows, (r) => r.people_reached)), sub: "Sum of monthly \"people reached\" reports in the quarter; the same person may be counted more than once.", source: "FCV service database", target: "fcvDataPage#fcvRegVolumeKpiGrid" },
      { id: "fvMhpss", title: "People reached with MHPSS", value: fmtCompact(sum(rows, (r) => r.mental_health_beneficiaries)), sub: `GBV cases managed: ${fmtFull(sum(rows, (r) => r.gbv_cases_managed))}.`, source: "FCV service database", target: "overviewPage#stratMhpssChart" },
      { id: "fvExcluded", title: "Values held back for correction", value: fmtFull(excluded), sub: "Rates and percentages outside plausible limits.", source: "Ingest validation", target: "dataHealthPage#dataHealthValidation", tone: excluded ? "warn" : "" }
    ], ["fcvdb", "herams"]);
  }

  function renderGradingStripLinks() {
    const node = el("gradingSummary");
    if (!node) return;
    node.querySelectorAll(".strat-kpi").forEach((card, i) => {
      card.classList.remove("strat-kpi-static");
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.dataset.stratTarget = i === 4 ? "gradingPage#gradingRegister" : "gradingPage#gradingTable";
    });
    let bar = el("gradingSources");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "gradingSources";
      node.insertAdjacentElement("afterend", bar);
    }
    bar.innerHTML = sourcesBar(["grading", "inform", "hapi", "ipc", "dtm", "ssa"]);
  }

  function renderDataHealthStrip() {
    const s = state.payload.sources;
    const okSources = ["hapi", "fts", "ssa"].filter((k) => s[k]?.status && s[k].status.ok > 0).length;
    const rows = fcvRows();
    const v = state.dash?.service_delivery_status?.validation?.fields || {};
    const excluded = Object.values(v).reduce((s2, x) => s2 + (x.excluded_rows || 0), 0);
    renderStrip("dataHealthPage", "Data Health: Key Figures", "", [
      { id: "dhSources", title: "Core online sources loaded", value: `${okSources}<small> of 3</small>`, sub: `Oldest refresh ${fmtDate([s.hapi.fetched_at, s.fts.fetched_at, s.ssa.fetched_at].filter(Boolean).sort()[0])}.`, source: "HDX HAPI, OCHA FTS, WHO SSA", target: "dataHealthPage#dataHealthSources", tone: okSources < 3 ? "bad" : "" },
      { id: "dhExcluded", title: "Service values held back", value: fmtFull(excluded), sub: "Listed by indicator and country below.", source: "FCV service database", target: "dataHealthPage#dataHealthValidation", tone: excluded ? "warn" : "" },
      { id: "dhStale", title: "Outdated country figures", value: String(rows.filter((r) => (r.idps && r.idps.stale) || (r.ipc && r.ipc.stale) || r.health_outdated).length), sub: "Countries with displacement, IPC or plan figures older than their update deadline.", source: "Freshness rules", target: "overviewPage#stratTable" }
    ], ["hapi", "fts", "ssa", "fcvdb"]);
  }

  function renderPageStrips() {
    if (!state.payload) return;
    renderDisplacementStrip();
    renderAttacksStrip();
    renderFoodStrip();
    renderGradingStripLinks();
    renderDataHealthStrip();
    if (state.dash) {
      renderNutritionStrip();
      renderHazardStrip();
      renderCycloneStrip();
      renderForecastStrip();
      renderFcvStrip();
    }
  }

  // ---------- Weekly operational update (top of the Operational Bulletin) ----------
  function isoWeekKey(d = new Date()) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function noteBox(key, label, placeholder) {
    const storeKey = `who_afro_bulletin_${isoWeekKey()}_${key}`;
    let saved = "";
    try { saved = localStorage.getItem(storeKey) || ""; } catch (e) { saved = ""; }
    return `<div class="bulletin-note">
      <h4>${label}</h4>
      <div class="bulletin-note-box" contenteditable="true" data-note-key="${storeKey}" data-placeholder="${esc(placeholder)}">${esc(saved)}</div>
    </div>`;
  }

  const TABLE_ATTR = 'border="1" cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:10pt;"';
  const TH = 'style="background:#0b4ea2;color:#ffffff;text-align:left;padding:5px 7px;"';

  // The bulletin cover leads with the same messages as the Overview, so the cover
  // and Part A never disagree.
  function renderCoverMessages() {
    const list = document.querySelector("#operationalBulletinCover .bulletin-cover-messages");
    if (!list || !state.payload) return;
    const msgs = buildMessages(rowsInScope("fcv13"));
    if (msgs.length) list.innerHTML = msgs.map((m) => `<li>${m}</li>`).join("");
  }

  function renderBulletinWeekly() {
    setTimeout(renderCoverMessages, 0);
    const node = el("bulletinWeekly");
    if (!node || !state.payload) return;
    const rows = rowsInScope("fcv13");
    const k = computeKpis(rows);
    const src = state.payload.sources;
    const week = isoWeekKey();
    const priority = rows
      .filter((r) => r.classification.level === "Major" || r.classification.level === "Severe")
      .sort((a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score));
    const latestByCountry = latestServiceQuarter();
    const qRows = rows.map((r) => latestByCountry[r.iso3]).filter(Boolean);
    const qLabels = [...new Set(qRows.map((r) => r.quarter_label))].sort();
    const hz = (state.dash?.hazards || []).filter((h) => (h.countries || []).some((iso) => rows.some((r) => r.iso3 === iso)));
    const hzRedOrange = hz.filter((h) => /^(red|orange)/i.test(h.title || ""));
    const aliases = { COD: ["democratic republic of the congo", "dr congo", "drc"], CAF: ["central african republic"] };
    const patterns = rows.flatMap((r) => (aliases[r.iso3] || [r.country.toLowerCase()]).map((n) => new RegExp(`(^|[^a-z])${n}([^a-z]|$)`, "i")));
    const outbreaks = (state.dash?.who_don_reports || []).filter((o) => patterns.some((re) => re.test(String(o.title || "")))).slice(0, 5);
    const cyc = state.dash?.cyclone_intelligence || {};
    const floods = state.dash?.regional_flood_signals || [];
    const enso = state.dash?.enso_advisory;
    const lowFunded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct)).sort((a, b) => a.health_funding.pct - b.health_funding.pct).slice(0, 3);
    const messages = buildMessages(rows).map((m) => `<li>${m}</li>`).join("");

    const kpiRows = [
      ["Countries in major or severe crisis (DHM triage tier)", `${k.major.length + k.severe.length} of ${rows.length} (major: ${names(k.major, 5) || "none"})`, "DHM internal triage from the indicators below"],
      ["WHO-graded emergencies", k.graded ? String(k.graded) : "None recorded in the DHM grading register", "WHO grading register (DHM)"],
      ["People in need of health assistance", fmtCompact(k.healthPin), `Humanitarian plans (OCHA Humanitarian Action; OCHA via HDX where needed), refreshed ${fmtDate(src.hpc?.fetched_at || src.hapi.fetched_at)}`],
      ["Health funding: share received and gap (2026 plans)", `${fmtPct(k.pct)} received; gap ${fmtUsd(k.gap)}`, `OCHA FTS, refreshed ${fmtDate(src.fts.fetched_at)}`],
      ["Internally displaced; refugees and asylum seekers hosted", `${fmtCompact(k.idps)}; ${fmtCompact(k.refugees)}`, `IOM DTM (latest round per country) and UNHCR (end of ${esc(rows.find((r) => r.refugees)?.refugees.year || "n/a")}) via HDX HAPI`],
      ["Attacks on health care this year", `${fmtFull(k.attacks)} attacks, ${fmtFull(k.deaths)} people killed, ${fmtFull(k.injuries)} injured`, `WHO SSA, refreshed ${fmtDate(src.ssa.fetched_at)}`],
      ["People in IPC/CH Phase 3 or above (analyses under 18 months old)", fmtCompact(sum(rows.filter((r) => r.ipc && !r.ipc.stale), (r) => r.ipc.population)), "IPC via HDX HAPI, latest analysis per country"]
    ];

    node.innerHTML = `
      <div class="panel-header">
        <h2>Part A: Strategic and Operational Update, week ${esc(week.slice(-2))} of ${esc(week.slice(0, 4))}</h2>
        <p>Information for management and operations on the 13 FCV countries: the strategic picture, the operational situation, the response and the gaps. Figures come from the sources listed, each with its date, and refresh automatically; the crisis tier is DHM's own rule-based triage. The optional note boxes let the duty officer add context before printing or exporting; empty boxes are left out. Notes are saved only in this browser.</p>
      </div>

      <h3 class="bulletin-h3">1. Strategic picture</h3>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Indicator</th><th ${TH}>Value</th><th ${TH}>Source</th></tr></thead>
        <tbody>${kpiRows.map(([a, b, c]) => `<tr><td>${a}</td><td><strong>${b}</strong></td><td>${c}</td></tr>`).join("")}</tbody></table>
      ${messages ? `<ol class="bulletin-messages">${messages}</ol>` : ""}

      <h3 class="bulletin-h3">2. Operational situation</h3>
      <ul class="bulletin-list">
        <li>Natural hazards: ${(state.dash?.hazards || []).length ? `${fmtFull(hz.length)} GDACS alerts in FCV countries (${fmtFull(hzRedOrange.length)} orange or red)` : "GDACS feed returned no data in this refresh"}; ${floods.length ? `${fmtFull(floods.length)} flood updates in the region` : "no flood updates in the feed"}; ${fmtFull(cyc.active_cyclone_count || 0)} named cyclones in the last ${cyc.active_window_days || 21} days.</li>
        <li>Climate outlook: ${enso?.alert_status ? `${esc(enso.alert_status)} (NOAA CPC${enso.issued_on ? `, ${esc(enso.issued_on)}` : ""})` : "ENSO status not available in this refresh"}.</li>
        <li>Outbreaks: ${outbreaks.length ? `WHO Disease Outbreak News, last 30 days: ${outbreaks.map((o) => esc(o.title || o.summary || "")).filter(Boolean).slice(0, 3).join("; ")}` : "no WHO Disease Outbreak News items for these countries in the last 30 days"}. Graded outbreaks appear in the WHO grading register once DHM enters them; the WHO AFRO weekly bulletin on outbreaks has the full list.</li>
      </ul>
      ${noteBox("risk", "Optional note: major health risk this week", "Main health threat this week and where (outbreak, displacement wave, flood).")}
      <h4 class="bulletin-h4">Priority countries (major and severe tiers)</h4>
      <table ${TABLE_ATTR}><thead><tr><th ${TH}>Country</th><th ${TH}>DHM tier</th><th ${TH}>Health PiN</th><th ${TH}>Health funded</th><th ${TH}>IDPs</th><th ${TH}>IPC/CH 3+</th><th ${TH}>Attacks this year</th></tr></thead>
        <tbody>${priority.map((r) => `<tr>
          <td><strong>${esc(r.country)}</strong></td><td>${esc(r.classification.level)}</td>
          <td>${r.health_in_need ? fmtCompact(r.health_in_need.value) : "no plan"}</td>
          <td>${r.health_funding ? fmtPct(r.health_funding.pct) : "no plan"}</td>
          <td>${r.idps && !r.idps.stale ? fmtCompact(r.idps.value) : "outdated"}</td>
          <td>${r.ipc && !r.ipc.stale ? fmtPct(r.ipc.fraction) : "no current analysis"}</td>
          <td>${r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} (${fmtFull(r.attacks.ytd.deaths)} killed)` : "not in SSA"}</td></tr>`).join("")}</tbody></table>
      ${noteBox("countries", "Optional note: country updates", "One or two lines per priority country: what changed and what WHO is doing.")}

      <h3 class="bulletin-h3">3. Response</h3>
      <ul class="bulletin-list">
        <li>Health Cluster funding received in 2026 plans: <strong>${fmtUsd(k.got)}</strong> of ${fmtUsd(k.req)} (${fmtPct(k.pct)}; median per country ${fmtPct(k.medianPct)}).</li>
        <li>FCV service delivery, latest reported quarter per country (${qRows.length} of 13 countries; ${esc(qLabels[0] || "n/a")} to ${esc(qLabels[qLabels.length - 1] || "n/a")}): ${fmtCompact(sum(qRows, (r) => r.people_reached))} service contacts reported (monthly reports summed, so people may be counted more than once), ${fmtFull(sum(qRows, (r) => r.mental_health_beneficiaries))} MHPSS contacts, ${fmtFull(sum(qRows, (r) => r.gbv_cases_managed))} GBV cases managed, ${fmtFull(sum(qRows, (r) => r.children_screened_malnutrition))} children screened for malnutrition.</li>
      </ul>
      ${noteBox("response", "Optional note: WHO response highlights", "Deployments, supplies, campaigns, coordination decisions this week.")}

      <h3 class="bulletin-h3">4. Gaps</h3>
      <ul class="bulletin-list">
        <li>Health funding gap: <strong>${fmtUsd(k.gap)}</strong>; lowest coverage in ${lowFunded.map((r) => `${esc(shortName(r.country))} (${fmtPct(r.health_funding.pct)})`).join(", ") || "n/a"}.</li>
        <li>Health reach: ${k.healthReachedCountries
          ? `${fmtCompact(k.healthReached)} reached of ${fmtCompact(k.healthReachTargeted)} targeted (${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))}) in ${k.healthReachedCountries} countries so far this year`
          : k.reachLatest.year
            ? `OCHA has not yet published ${new Date().getFullYear()} figures; the latest full-year result (${esc(k.reachLatest.year)}) is ${fmtCompact(k.reachLatest.reached)} reached of ${fmtCompact(k.reachLatest.targeted)} targeted (${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))}) in ${k.reachLatest.rows.length} countries`
            : "not yet published by OCHA"}. Plans target ${fmtCompact(k.healthTargeted)} of ${fmtCompact(k.healthPin)} people in need (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))}).</li>
        <li>MHPSS: median ${k.mhpssMedian != null ? k.mhpssMedian.toFixed(0) : "n/a"} people reached per 10,000 in need; no regional MHPSS target is published.</li>
        <li>Surveillance and data gaps: WHO attack surveillance does not cover ${names(k.notInSsa, 6) || "none"}; no current humanitarian plan for ${names(k.noHealthPlan, 6) || "none"}.</li>
      </ul>
      ${noteBox("gaps", "Optional note: decisions needed from management", "Gaps that need a decision: funding, staff, supplies, access.")}
      ${sourcesBar(["hpc", "hapi", "fts", "dtm", "unhcr", "ipc", "ssa", "fcvdb"])}`;

    node.querySelectorAll("[data-note-key]").forEach((box) => {
      box.addEventListener("input", () => {
        try { localStorage.setItem(box.dataset.noteKey, box.innerText); } catch (e) { /* per-browser convenience only */ }
      });
    });
  }

  // ---------- Destination labels for clickable cards ----------
  const PAGE_LABEL = {
    overviewPage: "Overview", gradingPage: "Crisis Classification", fcvDataPage: "FCV Response", countryPage: "Country Profiles",
    conflictsDisplacementPage: "Conflict & Displacement", attacksHealthPage: "Attacks on Health Care", foodSecurityPage: "Food Security",
    nutritionPage: "Nutrition", hazardPage: "Hazards & Floods", cyclonePage: "Cyclone Watch", forecastPage: "Climate Forecasts",
    operationalReportPage: "Operational Bulletin", signalsPage: "Event Signals", dataHealthPage: "Data Health"
  };
  function destinationLabel(target) {
    if (!target) return "";
    if (/^https?:/.test(target)) return "Opens the source website";
    const [page, anchor] = String(target).split("#");
    const node = anchor ? el(anchor) : null;
    const panelTitle = node ? (node.closest(".panel")?.querySelector("h2")?.textContent || "").trim() : "";
    const pageName = PAGE_LABEL[page] || page;
    return panelTitle && !panelTitle.startsWith(pageName) ? `${pageName}: ${panelTitle}` : pageName;
  }
  function decorateCardDestinations() {
    document.querySelectorAll(".strat-kpi[data-strat-target], .metric-card[data-strat-target]").forEach((card) => {
      const target = card.dataset.stratTarget;
      if (!target) return;
      let more = card.querySelector(".strat-kpi-more");
      if (!more) {
        more = document.createElement("span");
        more.className = "strat-kpi-more";
        card.appendChild(more);
      }
      more.textContent = `More detail: ${destinationLabel(target)} ›`;
      card.title = /^https?:/.test(target) ? "Open the source website" : `Open ${destinationLabel(target)}`;
    });
  }

  // ---------- Strategic KPI status (Overview) ----------
  const STATUS_STYLE = {
    "Act now": ["#8e1b3a", "#fff"],
    Attention: ["#e8a33b", "#0d1f33"],
    "On track": ["#2e8b6e", "#fff"],
    "No data": ["#b9c4cf", "#0d1f33"]
  };
  function statusTag(status) {
    const [bg, fg] = STATUS_STYLE[status] || STATUS_STYLE["No data"];
    return `<span class="strat-level" style="background:${bg};color:${fg}">${esc(status)}</span>`;
  }

  function renderStatusTable() {
    const table = el("stratStatusTable");
    if (!table || !state.payload) return;
    const rows = rowsInScope();
    const k = computeKpis(rows);
    const ipcHigh = rows.filter((r) => r.ipc && !r.ipc.stale && r.ipc.fraction >= 0.2);
    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct));
    const lowFunded = funded.filter((r) => r.health_funding.pct < 0.2 || (k.pct != null && r.health_funding.pct < k.pct / 2));
    const lowCoverage = rows.filter((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value) && r.health_targeted.value / r.health_in_need.value < 0.4);
    const rising = rows.filter((r) => r.attacks?.prev_ytd && r.attacks.ytd && r.attacks.ytd.attacks >= 10 && r.attacks.ytd.attacks > r.attacks.prev_ytd.attacks * 1.25);
    const deaths = rows.filter((r) => r.attacks?.ytd?.deaths > 0);
    const lowMhpss = k.mhpss.filter((x) => x.rate < 10).map((x) => x.r);
    const bigDisp = rows.filter((r) => ((r.idps && !r.idps.stale ? r.idps.value : 0) + (r.refugees?.value || 0)) >= 1e6);
    const svc = latestServiceQuarter();
    const quarters = (state.dash?.service_delivery_quarterly_rows || []).map((r) => Number(r.quarter_sort) || 0);
    const maxQ = quarters.length ? Math.max(...quarters) : null;
    const notReporting = maxQ == null ? [] : rows.filter((r) => r.group === "fcv_prioritized" || r.group === "fcv_accelerated").filter((r) => !svc[r.iso3] || Number(svc[r.iso3].quarter_sort) < maxQ - 1);
    const hasCoverageData = rows.some((r) => isNum(r.health_in_need?.value) && isNum(r.health_targeted?.value));
    const outdated = rows.filter((r) => (r.idps && r.idps.stale) || (r.ipc && r.ipc.stale) || r.health_outdated || !r.health_in_need);

    const items = [
      { q: "Where is the health burden concentrated?", kpi: `${k.major.length} countries in the major tier; ${fmtCompact(k.healthPin)} people in need of health assistance`, trigger: "Country in the major tier of the DHM triage", flagged: k.major, status: k.major.length ? "Act now" : "On track", decision: "Prioritise staff surge and regional support", link: "gradingPage#gradingTable" },
      { q: "How deep is the food crisis?", kpi: `${ipcHigh.length} countries with 20% or more of the analysed population in IPC/CH Phase 3+`, trigger: "Phase 3+ share of 20% or more (analysis under 18 months old)", flagged: ipcHigh, status: ipcHigh.length ? "Act now" : "On track", decision: "Integrate nutrition and disease surveillance in food-insecure areas", link: "foodSecurityPage#foodSecurityTable" },
      { q: "Is the health response funded?", kpi: `${fmtPct(k.pct)} received across plans; median per country ${fmtPct(k.medianPct)}`, trigger: "Under 20% funded, or under half the FCV average", flagged: lowFunded, status: lowFunded.length ? "Act now" : funded.length ? "On track" : "No data", decision: "Donor briefing; pooled-fund and CERF discussions", link: "overviewPage#stratFundingChart" },
      { q: "Are plans covering health needs?", kpi: `Plans target ${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} of people in need; ${k.healthReachedCountries ? `${fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))} of target reached so far` : k.reachLatest.year ? `${new Date().getFullYear()} reach not yet published (${esc(k.reachLatest.year)}: ${fmtPct(k.reachLatest.reached / Math.max(1, k.reachLatest.targeted))} of target reached in the ${k.reachLatest.rows.length} countries with final figures)` : "reach is not yet published"}`, trigger: "Plan targets under 40% of health need. Once reach is reported: under 50% reached by mid-year", flagged: lowCoverage, status: lowCoverage.length ? "Attention" : hasCoverageData ? "On track" : "No data", decision: "Review prioritisation, partners and access", link: "overviewPage#stratCoverageChart" },
      { q: "Is health care under attack?", kpi: `${fmtFull(k.attacks)} attacks and ${fmtFull(k.deaths)} people killed this year`, trigger: "10 or more attacks and 25% above the same period last year; or any deaths", flagged: [...new Map([...rising, ...deaths].map((r) => [r.iso3, r])).values()], status: rising.length ? "Act now" : deaths.length ? "Attention" : "On track", decision: "Protection advocacy; continuity and security review", link: "attacksHealthPage#stratSsaPanel" },
      { q: "Are psychosocial needs being met?", kpi: k.mhpssMedian != null ? `Median ${k.mhpssMedian.toFixed(0)} people reached with MHPSS per 10,000 in need` : "No MHPSS data", trigger: "Fewer than 10 per 10,000 in need (provisional until a target is set)", flagged: lowMhpss, status: !k.mhpss.length ? "No data" : lowMhpss.length ? "Attention" : "On track", decision: "Fund MHPSS partners; integrate MHPSS into primary care", link: "overviewPage#stratMhpssChart" },
      { q: "How large is displacement?", kpi: `${fmtCompact(k.idps)} internally displaced; ${fmtCompact(k.refugees)} refugees hosted`, trigger: "1 million or more displaced or hosted", flagged: bigDisp, status: bigDisp.length ? "Attention" : "On track", decision: "Plan services in camps and host areas; review surge", link: "conflictsDisplacementPage#stratDisplacementPanel" },
      { q: "Can we trust the numbers?", kpi: `${notReporting.length} FCV countries not reporting service data in the last two quarters; ${outdated.length} with outdated or missing plan, displacement or IPC figures`, trigger: "No service report for two quarters, or a figure older than its update deadline", flagged: [...new Map([...notReporting, ...outdated].map((r) => [r.iso3, r])).values()], status: maxQ == null && !outdated.length ? "No data" : notReporting.length || outdated.length ? "Attention" : "On track", decision: "Follow up with country offices before the figures are used", link: "dataHealthPage#dataHealthValidation" }
    ];
    table.innerHTML = `<thead><tr><th>Management question</th><th>Where we are</th><th>Trigger</th><th>Status</th><th>Countries meeting the trigger</th><th>Decision it informs</th><th></th></tr></thead>
      <tbody>${items.map((it) => `<tr>
        <td><strong>${esc(it.q)}</strong></td>
        <td>${it.kpi}</td>
        <td><small>${esc(it.trigger)}</small></td>
        <td>${statusTag(it.status)}</td>
        <td>${it.flagged.length ? names(it.flagged, 6) : '<span class="muted">none</span>'}</td>
        <td><small>${esc(it.decision)}</small></td>
        <td><button type="button" class="strat-link" data-strat-target="${esc(it.link)}">Detail ›</button></td>
      </tr>`).join("")}</tbody>`;
  }

  // ---------- Map labels and explanations ----------
  function centroidFor(iso3) {
    try {
      // COUNTRY_CENTROIDS and COUNTRY_SHORT_LABELS are defined in app.js.
      // eslint-disable-next-line no-undef
      return typeof COUNTRY_CENTROIDS !== "undefined" ? COUNTRY_CENTROIDS[iso3] : null;
    } catch (e) {
      return null;
    }
  }
  function shortCode(iso3) {
    try {
      // eslint-disable-next-line no-undef
      return (typeof COUNTRY_SHORT_LABELS !== "undefined" && COUNTRY_SHORT_LABELS[iso3]) || iso3;
    } catch (e) {
      return iso3;
    }
  }
  function mapValueLabel(r, layer) {
    const v = mapValue(r, layer);
    if (v == null) return "";
    switch (layer) {
      case "classification": return r.classification.level;
      case "funding_pct":
      case "ipc": return `${Math.round(v)}%`;
      case "attacks": return String(v);
      default: return fmtCompact(v);
    }
  }
  const LAYER_NOTE = {
    classification: "Colour shows the DHM triage tier: a rule-based score (0 to 8) from INFORM Risk, people in need of health assistance, IPC/CH Phase 3+ share, displacement and attacks on health care. Major is 6 to 8 points, Severe 3 to 5, Moderate 0 to 2; countries with fewer than 3 current core indicators show as Insufficient data. It is not a WHO grade.",
    health_pin: "People in need of health assistance in the latest humanitarian plan (OCHA, through HDX HAPI).",
    funding_pct: "Share of the Health Cluster requirement received in 2026 plans (OCHA FTS). Red marks the least-funded countries.",
    displaced: "Internally displaced people (IOM DTM, current figures only) plus refugees and asylum seekers hosted (UNHCR).",
    ipc: "Share of the analysed population in IPC/CH Phase 3 or above, from the latest analysis under 18 months old.",
    attacks: "Attacks on health care recorded by WHO SSA this year. Countries without SSA deployment show no value."
  };
  function renderMapNote() {
    const node = el("stratMapNote");
    if (!node || !state.payload) return;
    const layer = state.mapLayer;
    const ranked = rowsInScope()
      .map((r) => ({ r, v: mapValue(r, layer) }))
      .filter((x) => x.v != null)
      .sort((a, b) => (layer === "funding_pct" ? a.v - b.v : b.v - a.v))
      .slice(0, 3);
    node.innerHTML = `<p><strong>How to read this map.</strong> ${esc(LAYER_NOTE[layer] || "")} ${layer === "classification" ? '<button type="button" class="strat-link" data-strat-target="gradingPage#gradingTable">See the points per country ›</button>' : ""}</p>
      ${ranked.length ? `<p><strong>${layer === "funding_pct" ? "Least funded" : "Highest"}:</strong> ${ranked.map((x) => `<button type="button" class="strat-link" data-strat-country="${x.r.iso3}">${esc(shortName(x.r.country))}</button> (${esc(mapValueLabel(x.r, layer))})`).join(", ")}.</p>` : ""}`;
  }

  function labelTrace(rows, layer) {
    const pts = rows.map((r) => ({ r, c: centroidFor(r.iso3), label: mapValueLabel(r, layer), v: mapValue(r, layer) })).filter((x) => x.c && x.label);
    const vals = pts.map((x) => x.v).filter(isNum);
    const lo = vals.length ? Math.min(...vals) : 0;
    const hi = vals.length ? Math.max(...vals) : 1;
    // White text on the dark end of the colour scale, dark text elsewhere.
    const onDark = (x) => {
      if (layer === "classification") return x.r.classification.level === "Major" || x.r.classification.level === "Severe";
      if (layer === "funding_pct") return x.v <= 35;
      const frac = hi > lo ? (x.v - lo) / (hi - lo) : 0;
      return frac > 0.55;
    };
    return {
      type: "scattergeo",
      mode: "text",
      lat: pts.map((x) => x.c[0]),
      lon: pts.map((x) => x.c[1]),
      text: pts.map((x) => `<b>${shortCode(x.r.iso3)}</b><br>${x.label}`),
      textfont: { size: 10, color: pts.map((x) => (onDark(x) ? "#ffffff" : "#0d1f33")), family: "Barlow, sans-serif" },
      hoverinfo: "skip",
      showlegend: false
    };
  }

  // ---------- Event Signals map explanation ----------
  function renderSignalsExplain() {
    const node = el("signalsMapExplain");
    if (!node || !state.dash) return;
    const countries = (state.dash.countries || []).slice().sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0));
    const top = countries.slice(0, 5);
    const driver = (c) => {
      const parts = [];
      const ipcPct = c.ipc?.phase3plus_pct;
      if (isNum(ipcPct)) parts.push(`IPC/CH Phase 3+ ${fmtPct(ipcPct)}`);
      else if (c.fews_ipc?.ml1_phase || c.fews_ipc?.cs_phase) parts.push(`FEWS NET phase ${c.fews_ipc.ml1_phase || c.fews_ipc.cs_phase}`);
      const cd = (c.conflict_signal_count || 0) + (c.displacement_signal_count || 0);
      const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
      if (cd) parts.push(plural(cd, "conflict or displacement report", "conflict or displacement reports"));
      if (c.hazard_count) parts.push(plural(c.hazard_count, "hazard alert", "hazard alerts"));
      if (c.flood_count) parts.push(plural(c.flood_count, "flood signal", "flood signals"));
      if (c.report_count_30d) parts.push(plural(c.report_count_30d, "report in 30 days", "reports in 30 days"));
      return parts.join(", ") || "few signals";
    };
    node.innerHTML = `
      <p><strong>How the score is built.</strong> Each country gets a signal score from public sources in the current refresh. Where IPC data exist: IPC/CH Phase 3+ share (32 points), FEWS NET phase (13) and child wasting from the latest available survey (5). Where IPC is missing: FEWS NET phase (32) and wasting (23). Then conflict and displacement reports (22), flood (8), hazard (6), drought (4) and cyclone (4) signals, report volume in the last 30 days (10) and ICPAC forecast bulletins (5; the same regional count for every IGAD country). Each part is scaled between the lowest and highest country in this refresh, so totals can slightly exceed 100.</p>
      <p><strong>What it means.</strong> The score ranks countries against each other this week. It is not a severity measure, and it can move when other countries change.</p>
      <p><strong>Bands:</strong> 1 Low (0 to 20), 2 Guarded (21 to 40), 3 Elevated (41 to 60), 4 High (61 to 80), 5 Critical (81 and above). The "IPC Phase 3+" button switches the map to the IPC/CH Phase 3+ share alone.</p>
      <p><strong>Countries with the strongest signals now:</strong></p>
      <ol class="strat-signal-list">${top.map((c) => `<li><button type="button" class="strat-link" data-strat-country="${esc(c.iso3)}">${esc(c.country)}</button>: score ${esc(c.risk_score)} (${esc(bandForRiskLabel(c.risk_score))}); ${esc(driver(c))}.</li>`).join("")}</ol>
      <p class="muted">For the strategic ranking of crises, use the <button type="button" class="strat-link" data-strat-target="gradingPage#gradingTable">Crisis Classification</button> page.</p>`;
  }
  function bandForRiskLabel(score) {
    const v = Number(score || 0);
    return v >= 81 ? "Band 5 Critical" : v >= 61 ? "Band 4 High" : v >= 41 ? "Band 3 Elevated" : v >= 21 ? "Band 2 Guarded" : "Band 1 Low";
  }

  // ---------- Climate forecast explanation and summary ----------
  function renderForecastBriefing() {
    const page = el("forecastPage");
    if (!page || !state.dash) return;
    let node = el("forecastBriefing");
    if (!node) {
      node = document.createElement("section");
      node.id = "forecastBriefing";
      node.className = "panel";
      const strip = el("strip-forecastPage");
      if (strip && strip.nextSibling) page.insertBefore(node, strip.nextSibling);
      else page.appendChild(node);
    }
    const enso = state.dash.enso_advisory || null;
    const fc = state.dash.forecasts || [];
    const byHorizon = (h) => fc.filter((f) => String(f.horizon).toLowerCase() === h);
    const levelTagF = (lvl) => {
      const map = { high: ["#8e1b3a", "#fff", "High"], watch: ["#e8a33b", "#0d1f33", "Watch"], info: ["#b9c4cf", "#0d1f33", "Info"] };
      const [bg, fg, label] = map[String(lvl || "info").toLowerCase()] || map.info;
      return `<span class="strat-level" style="background:${bg};color:${fg}">${label}</span>`;
    };
    const list = (items) => items.length
      ? `<ul class="strat-forecast-list">${items.map((f) => `<li>${levelTagF(f.risk_level)} <a href="${esc(/^https?:\/\//i.test(String(f.url || "")) ? f.url : LINKS.icpac[1])}" target="_blank" rel="noopener">${esc(String(f.title || "").replace(/\s+-\s+IGAD Region$/i, ""))}</a></li>`).join("")}</ul>`
      : '<p class="muted">None in this refresh.</p>';
    const high = byHorizon("weekly").filter((f) => String(f.risk_level).toLowerCase() === "high");
    const isElNino = /el ni/i.test(enso?.alert_status || "");
    const isLaNina = /la ni/i.test(enso?.alert_status || "");
    node.innerHTML = `
      <div class="panel-header"><h2>Forecast Summary and How to Read It</h2><p>What the current outlooks say, and how the levels on this page are assigned.</p></div>
      <div class="two-col strat-forecast-grid">
        <div>
          <h3 class="bulletin-h3">Summary</h3>
          <ul class="bulletin-list">
            <li><strong>ENSO:</strong> ${enso?.alert_status ? `${esc(enso.alert_status)}. ${esc(enso.synopsis || "")} <span class="muted">(NOAA CPC${enso.issued_on ? `, issued ${esc(enso.issued_on)}` : ""}${enso.next_update ? `; next update ${esc(enso.next_update)}` : ""})</span>` : "Not available in this refresh."}</li>
            <li><strong>Greater Horn of Africa, next 7 days (ICPAC):</strong> ${byHorizon("weekly").length} products${high.length ? `, including ${high.map((f) => esc(String(f.title || "").split(" - ")[0].toLowerCase())).filter((v, i, a) => a.indexOf(v) === i).join(", ")} outlooks` : ""}. Open each product for the affected areas.</li>
            <li><strong>Season ahead (ICPAC):</strong> ${byHorizon("seasonal").length} seasonal products${byHorizon("seasonal")[0]?.date_label ? ` to ${esc(byHorizon("seasonal")[0].date_label)}` : ""}${byHorizon("monthly").length ? `; ${byHorizon("monthly").length} monthly products` : ""}.</li>
            ${isElNino ? `<li><strong>Typical El Niño effects (past events, not a forecast):</strong> wetter than usual short rains in parts of East Africa, with higher flood, cholera, malaria and Rift Valley fever risk, and drier conditions over much of southern Africa during its rainy season, with drought and food-insecurity risk.</li>` : ""}
            ${isLaNina ? `<li><strong>Typical La Niña effects (past events, not a forecast):</strong> drier than usual short rains in parts of East Africa, with drought and food-insecurity risk, and wetter conditions over parts of southern Africa.</li>` : ""}
          </ul>
          <h3 class="bulletin-h3">ICPAC products this week</h3>
          ${list(byHorizon("weekly"))}
          <h3 class="bulletin-h3">Seasonal and monthly products</h3>
          ${list(byHorizon("seasonal").concat(byHorizon("monthly")))}
        </div>
        <div>
          <h3 class="bulletin-h3">How the levels are assigned</h3>
          <ul class="bulletin-list">
            <li>${levelTagF("high")} The product title names a hazard with known health effects: floods, heavy rainfall, heat stress or drought.</li>
            <li>${levelTagF("watch")} The product is a rainfall or temperature outlook or anomaly map that may point to a hazard.</li>
            <li>${levelTagF("info")} Background products such as rainy-season onset dates and wet or dry spell lengths.</li>
            <li><strong>ENSO</strong> follows the NOAA status: a Warning is High; a Watch or Advisory is Watch; otherwise Info.</li>
          </ul>
          <p class="muted">Levels come from the product type in the title, not from the map content. High means a hazard outlook exists in the current outlooks; open it to see the affected areas. ICPAC covers the IGAD countries only; for other subregions, use national meteorological services and the WMO links on the Cyclone Watch page.</p>
        </div>
      </div>`;
  }

  // ---------- orchestration ----------
  function renderAll() {
    if (!state.payload) return;
    renderKpis();
    renderMessages();
    renderMap();
    renderFundingChart();
    renderTable();
    renderCoverageChart();
    renderMhpssChart();
    renderSources();
    renderGradingPage();
    renderCountryCard();
    renderDisplacementPanel();
    renderSsaPanel();
    renderDataHealth();
    renderPageStrips();
    renderBulletinWeekly();
    renderStatusTable();
    renderSignalsExplain();
    renderForecastBriefing();
    decorateCardDestinations();
  }

  function resizeVisible(pageId) {
    if (typeof Plotly === "undefined") return;
    const ids = {
      overviewPage: ["stratMap", "stratFundingChart", "stratCoverageChart", "stratMhpssChart"],
      attacksHealthPage: ["stratSsaChart"]
    }[pageId] || [];
    ids.forEach((id) => {
      const node = el(id);
      if (node && node.data) {
        try { Plotly.Plots.resize(node); } catch (e) { /* ignore */ }
      }
    });
  }

  async function load() {
    if (state.loading) return state.loading;
    state.loading = fetch("/api/strategic", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((payload) => {
        state.payload = payload;
        renderAll();
        if (window.__dashboardRerenderBulletin) window.__dashboardRerenderBulletin();
      })
      .catch((err) => {
        const grid = el("stratKpiGrid");
        if (grid) grid.innerHTML = `<p class="muted">Strategic indicators could not be loaded (${esc(err.message)}).</p>`;
      })
      .finally(() => {
        state.loading = null;
      });
    return state.loading;
  }


  // ---------- Page layout: shorter pages ----------
  // Detail panels start closed so each page leads with its key information.
  // Matched on the English panel title; a click on the title bar opens them.
  const COLLAPSED_PANELS = {
    overviewPage: ["Sources and Links"],
    gradingPage: ["Classification Rules"],
    fcvDataPage: ["Completeness by Indicator", "PENTA − Measles Gap", "Coverage Map", "SAM Case Severity", "Screening Volume vs. Severity", "GBV & MHPSS Cases Managed"],
    countryPage: ["Country Comparison Table", "FCV Country Profile Data"],
    conflictsDisplacementPage: ["Conflict and Displacement Pressure", "Conflict and Displacement Prioritization", "Evidence Feed"],
    attacksHealthPage: ["Public Reporting Signals (context only)", "Country Prioritization", "WHO SSA Source and Evidence Feed"],
    foodSecurityPage: ["Recent Food Security Reporting"],
    nutritionPage: ["Recent Nutrition Reporting"],
    hazardPage: ["Source Intelligence Summary", "GDACS Hazard Events", "ReliefWeb RSS Situation Reports", "WHO Disease Outbreak News (DON)", "Disease Outbreak Evidence Feed", "Historical Disaster Impact (EM-DAT)", "Largest Disasters by People Affected", "Most Affected Countries (EM-DAT)"],
    cyclonePage: ["Cyclone Source Diagnostics", "Cyclone Projections and Advisories"],
    forecastPage: ["Forecast Outlook", "Forecast Source Summary", "ICPAC Source Summary"],
    operationalReportPage: ["Source Intelligence Detail", "Conflict and Displacement Insert", "Priority Country Annexes", "Forecast and Projection Summary", "Conflicts and Displacements Summary"],
    signalsPage: ["Food Security and Event Pressure Snapshot"],
    dataHealthPage: ["Data Validation Ledger"]
  };
  // Panels that repeat older calculations and contradict the verified figures.
  const HIDDEN_PANELS = {
    countryPage: ["Country Profile Trend", "Country Operational Brief"],
    conflictsDisplacementPage: ["Population Movement: IDP Estimates (IOM DTM)"]
  };

  function panelTitle(panel) {
    const h = panel.querySelector(".panel-header h2, h2");
    return h ? (h.dataset.i18nBaseText || h.textContent || "").trim() : "";
  }
  function panelsOf(pageId) {
    const page = el(pageId);
    return page ? Array.from(page.querySelectorAll(":scope > .panel, :scope > section > .panel, :scope > div > .panel")) : [];
  }
  function setCollapsed(panel, collapsed) {
    panel.classList.toggle("is-collapsed", collapsed);
    const btn = panel.querySelector(".panel-toggle");
    if (btn) {
      const fr = document.documentElement.lang === "fr";
      btn.textContent = collapsed ? (fr ? "Afficher le détail ▾" : "Show detail ▾") : (fr ? "Masquer le détail ▴" : "Hide detail ▴");
      btn.setAttribute("aria-expanded", String(!collapsed));
    }
    if (!collapsed && typeof Plotly !== "undefined") {
      panel.querySelectorAll(".js-plotly-plot").forEach((node) => { try { Plotly.Plots.resize(node); } catch (e) { /* hidden chart */ } });
    }
  }
  function applyPageLayout() {
    Object.entries(HIDDEN_PANELS).forEach(([pageId, titles]) => {
      panelsOf(pageId).forEach((panel) => {
        if (titles.includes(panelTitle(panel))) panel.classList.add("is-retired");
      });
    });
    Object.entries(COLLAPSED_PANELS).forEach(([pageId, titles]) => {
      panelsOf(pageId).forEach((panel) => {
        if (!titles.includes(panelTitle(panel)) || panel.dataset.collapsible) return;
        panel.dataset.collapsible = "1";
        const header = panel.querySelector(".panel-header");
        if (!header) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "panel-toggle";
        btn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          setCollapsed(panel, !panel.classList.contains("is-collapsed"));
        });
        header.appendChild(btn);
        setCollapsed(panel, true);
      });
    });
  }

  // A "Back to top" button on every page.
  function ensureBackToTop() {
    if (el("backToTopBtn")) return;
    const btn = document.createElement("button");
    btn.id = "backToTopBtn";
    btn.type = "button";
    btn.className = "back-to-top";
    btn.textContent = "▲ Top";
    btn.title = "Back to the top of the page";
    btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
    document.body.appendChild(btn);
    const update = () => btn.classList.toggle("is-visible", window.scrollY > 500);
    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  function goToPage(target) {
    if (/^https?:/.test(target)) {
      window.open(target, "_blank", "noopener");
      return;
    }
    const [pageId, anchor] = String(target).split("#");
    const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (btn && !btn.classList.contains("active")) btn.click();
    const focus = anchor ? el(anchor) : el(pageId);
    if (focus) {
      const owner = focus.closest(".panel");
      if (owner && owner.classList.contains("is-collapsed")) setCollapsed(owner, false);
      setTimeout(() => {
        const panel = focus.closest(".panel") || focus;
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
        panel.classList.add("panel-jump-highlight");
        setTimeout(() => panel.classList.remove("panel-jump-highlight"), 2200);
      }, 250);
    }
  }

  function bind() {
    const scope = el("stratScopeSelect");
    if (scope) {
      scope.addEventListener("change", () => {
        state.scope = scope.value;
        renderKpis();
        renderMessages();
        renderMap();
        renderFundingChart();
        renderTable();
        renderCoverageChart();
        renderMhpssChart();
        renderStatusTable();
        decorateCardDestinations();
      });
    }
    const layer = el("stratMapLayer");
    if (layer) {
      layer.addEventListener("change", () => {
        state.mapLayer = layer.value;
        renderMap();
      });
    }
    document.addEventListener("click", (ev) => {
      if (ev.target.closest("a")) return;
      const card = ev.target.closest("[data-strat-target]");
      if (card && card.dataset.stratTarget) {
        goToPage(card.dataset.stratTarget);
        return;
      }
      const country = ev.target.closest("[data-strat-country]");
      if (country) {
        const select = el("countrySelect");
        if (select) {
          select.value = country.dataset.stratCountry;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        goToPage("countryPage");
      }
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      const card = ev.target.closest && ev.target.closest("[data-strat-target]");
      if (card && card.tagName !== "BUTTON" && card.dataset.stratTarget) goToPage(card.dataset.stratTarget);
    });
    const select = el("countrySelect");
    if (select) select.addEventListener("change", renderCountryCard);
    // On a phone the menu sits above the content: jump to the page after choosing it.
    document.querySelectorAll(".nav-btn[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (window.innerWidth > 900) return;
        setTimeout(() => el(btn.dataset.page)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
      });
    });
  }

  window.StrategicDashboard = {
    onDashboardData(dash) {
      state.dash = dash;
      if (state.payload) {
        renderMhpssChart();
        renderKpis();
        renderDataHealth();
        renderCountryCard();
        renderPageStrips();
        renderBulletinWeekly();
        renderStatusTable();
        renderSignalsExplain();
        renderForecastBriefing();
        decorateCardDestinations();
      } else {
        load();
      }
    },
    onPage(pageId, opts = {}) {
      if (!state.payload) {
        load();
        return;
      }
      if (opts.resizeOnly) {
        resizeVisible(pageId);
        return;
      }
      if (pageId === "countryPage") renderCountryCard();
      setTimeout(() => resizeVisible(pageId), 60);
    },
    reload: load,
    decorate: decorateCardDestinations,
    renderCover: renderCoverMessages,
    // Major then Severe FCV countries, highest score first (used by the bulletin annexes).
    priorityIso3() {
      if (!state.payload) return [];
      return rowsInScope("fcv13")
        .filter((r) => ["Major", "Severe"].includes(r.classification.level))
        .sort((a, b) => (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score) || ((b.health_in_need?.value || 0) - (a.health_in_need?.value || 0)))
        .map((r) => r.iso3);
    },
    goToPage
  };

  const start = () => { applyPageLayout(); ensureBackToTop(); bind(); load(); };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
