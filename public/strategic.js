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
  function levelTag(level) {
    const color = LEVEL_COLOR[level] || "#b9c4cf";
    const ink = level === "Moderate" || level === "Insufficient data" ? "#0d1f33" : "#fff";
    return `<span class="strat-level" style="background:${color};color:${ink}">${esc(level)}</span>`;
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
      healthPinPrevYear: rows.filter((r) => r.health_in_need && r.people_in_need && String(r.health_in_need.year) !== String(r.people_in_need.year)),
      noHealthPlan: rows.filter((r) => !r.health_in_need),
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
  function kpiCard({ id, title, value, sub, source, target, tone }) {
    return `
      <button type="button" class="strat-kpi ${tone ? `strat-kpi-${tone}` : ""}" data-strat-target="${target || ""}" id="${id}">
        <span class="strat-kpi-title">${title}</span>
        <span class="strat-kpi-value">${value}</span>
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

    const reachValue = k.healthReachedCountries
      ? fmtPct(k.healthReached / Math.max(1, k.healthReachTargeted))
      : "Awaiting data";
    const reachSub = k.healthReachedCountries
      ? `${fmtCompact(k.healthReached)} reached of ${fmtCompact(k.healthReachTargeted)} targeted in ${k.healthReachedCountries} countries.`
      : `Plans target ${fmtCompact(k.healthTargeted)} people (${fmtPct(k.healthTargeted / Math.max(1, k.healthPin))} of need). Proxy from the FCV service database: ${fmtCompact(k.svcReached)} people reached in ${k.svcCountries} countries (${k.svcQuarter || "latest quarter"}).`;
    const prevYearNote = k.healthPinPrevYear.length
      ? ` Uses the 2025 plan figure for ${k.healthPinPrevYear.map((r) => esc(shortName(r.country))).join(", ")}.`
      : "";
    const noPlanNote = k.noHealthPlan.length ? ` No current figure: ${k.noHealthPlan.map((r) => esc(shortName(r.country))).join(", ")}.` : "";

    grid.innerHTML = [
      kpiCard({
        id: "kpiCrises",
        title: "Countries in major or severe crisis",
        value: `${k.major.length + k.severe.length}<small> of ${rows.length}</small>`,
        sub: `Major: ${k.major.map((r) => esc(shortName(r.country))).join(", ") || "none"}. Severe: ${k.severe.length}. Insufficient data: ${k.insufficient.map((r) => esc(shortName(r.country))).join(", ") || "none"}.<br>WHO grades: ${k.graded ? `${k.graded} recorded` : "none recorded yet"}.`,
        source: "DHM triage tier from verified indicators; not a WHO grade",
        target: "gradingPage",
        tone: k.major.length ? "bad" : ""
      }),
      kpiCard({
        id: "kpiHealthPin",
        title: "People in need of health assistance",
        value: fmtCompact(k.healthPin),
        sub: `${k.healthPinCountries} countries. All sectors: ${fmtCompact(k.pin)} people in need.${prevYearNote}${noPlanNote}`,
        source: `OCHA humanitarian plans via HDX HAPI, ${hapiDate}`,
        target: "countryPage"
      }),
      kpiCard({
        id: "kpiReach",
        title: "Health reach against target",
        value: reachValue,
        sub: reachSub,
        source: k.healthReachedCountries ? `OCHA plan monitoring via HDX HAPI, ${hapiDate}` : "Health Cluster reach is not yet in a verified public source",
        target: "fcvDataPage",
        tone: k.healthReachedCountries ? "" : "warn"
      }),
      kpiCard({
        id: "kpiFunding",
        title: "Health funding gap (2026 plans)",
        value: fmtUsd(k.gap),
        sub: `${fmtPct(k.pct)} of ${fmtUsd(k.req)} received across ${k.fundedPlans} plans; median country ${fmtPct(k.medianPct)}. Excludes refugee response plans and funding not assigned to a cluster.`,
        source: `OCHA FTS, health cluster requirements and reported funding, ${ftsDate}`,
        target: "overviewPage",
        tone: k.medianPct != null && k.medianPct < 0.5 ? "bad" : "warn"
      }),
      kpiCard({
        id: "kpiDisplaced",
        title: "Displaced people",
        value: fmtCompact(k.idps + k.refugees),
        sub: `${fmtCompact(k.idps)} internally displaced and ${fmtCompact(k.refugees)} refugees and asylum seekers hosted.${k.idpsFromPlan ? ` ${k.idpsFromPlan} countries use the 2026 plan figure where IOM DTM is outdated or partial.` : ""}`,
        source: `IOM DTM and UNHCR via HDX HAPI, ${hapiDate}`,
        target: "conflictsDisplacementPage"
      }),
      kpiCard({
        id: "kpiAttacks",
        title: "Attacks on health care this year",
        value: fmtFull(k.attacks),
        sub: `${fmtFull(k.deaths)} health workers and patients killed, ${fmtFull(k.injuries)} injured, in ${k.ssaCountries} countries with WHO surveillance.${k.notInSsa.length ? ` Not covered: ${k.notInSsa.map((r) => esc(shortName(r.country))).join(", ")}.` : ""}`,
        source: `WHO Surveillance System for Attacks on Health Care (SSA), ${ssaDate}`,
        target: "attacksHealthPage",
        tone: k.deaths > 0 ? "bad" : ""
      }),
      kpiCard({
        id: "kpiMhpss",
        title: "Mental health and psychosocial support",
        value: k.mhpssMedian != null ? `${k.mhpssMedian.toFixed(0)}<small> per 10,000</small>` : "n/a",
        sub: k.mhpss.length
          ? `Median people reached with MHPSS in the latest quarter per 10,000 people in need of health assistance (${k.mhpss.length} countries). No regional MHPSS target is published, so the gap cannot yet be sized.`
          : "No MHPSS figures reported for this scope.",
        source: "FCV service database (WHO country offices); OCHA plans for the denominator",
        target: "fcvDataPage",
        tone: "warn"
      }),
      kpiCard({
        id: "kpiCoverage",
        title: "Data coverage",
        value: `${k.coverage.plan}<small> of ${k.coverage.n} with funded plan data</small>`,
        sub: `Current IPC/CH analysis: ${k.coverage.ipc}. Current displacement figure: ${k.coverage.displacement}. WHO attack surveillance: ${k.coverage.ssa}.`,
        source: "Shows how complete the figures above are",
        target: "dataHealthPage"
      })
    ].join("");
  }

  function renderMessages() {
    const list = el("stratMessages");
    if (!list) return;
    const rows = rowsInScope();
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
      .filter((x) => x.cur > x.prev && x.cur >= 5)
      .sort((a, b) => b.cur - a.cur);
    const majors = k.major.map((r) => esc(shortName(r.country)));
    const thisYear = new Date().getFullYear();
    messages.push(
      `<strong>What is getting worse.</strong> ${majors.length ? `${majors.join(", ")} ${majors.length === 1 ? "is" : "are"} in the major tier of the DHM triage classification. ` : ""}`
      + (rising.length
        ? `Attacks on health care are up on the same period of ${thisYear - 1} in ${rising.map((x) => `${esc(shortName(x.r.country))} (${x.cur} against ${x.prev}${x.deaths ? `, ${x.deaths} killed` : ""})`).join("; ")}.`
        : `No WHO-monitored country shows more attacks on health care than in the same period of ${thisYear - 1}.`)
    );

    const funded = rows.filter((r) => r.health_funding && isNum(r.health_funding.pct)).sort((a, b) => a.health_funding.pct - b.health_funding.pct);
    if (funded.length) {
      const low = funded.slice(0, 3);
      const biggestGap = funded.slice().sort((a, b) => b.health_funding.gap_usd - a.health_funding.gap_usd)[0];
      messages.push(
        `<strong>Funding point for management.</strong> Health funding coverage is lowest in ${low.map((r) => `${esc(shortName(r.country))} (${fmtPct(r.health_funding.pct)})`).join(", ")}; the median across countries is ${fmtPct(k.medianPct)}. The largest unfunded health requirement is ${esc(shortName(biggestGap.country))} (${fmtUsd(biggestGap.health_funding.gap_usd)}). Possible action: raise these in donor briefings and pooled-fund discussions.`
      );
    }
    list.innerHTML = messages.map((m) => `<li>${m}</li>`).join("");
  }

  function mapValue(r, layer) {
    switch (layer) {
      case "classification": return LEVEL_ORDER[r.classification.level] ?? null;
      case "health_pin": return r.health_in_need?.value ?? null;
      case "funding_pct": return r.health_funding && isNum(r.health_funding.pct) ? r.health_funding.pct * 100 : null;
      case "displaced": {
        const v = (r.idps?.value || 0) + (r.refugees?.value || 0);
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
    plot(node, [grey, trace], layout);
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
    const head = `
      <thead><tr>
        <th>Country</th><th>Group</th><th title="DHM triage tier, not a WHO grade">DHM tier</th><th>WHO grade</th>
        <th title="People in need of health assistance (OCHA plans)">Health PiN</th><th title="Health cluster funding received (OCHA FTS)">Funded</th><th title="Unfunded health requirement, US$">Gap</th>
        <th title="Internally displaced people">IDPs</th><th title="Refugees and asylum seekers hosted (UNHCR)">Refugees</th><th title="IPC/CH Phase 3+, share of the population analysed">IPC/CH 3+</th><th title="Attacks on health care this year (WHO SSA)">Attacks</th><th title="INFORM Risk index (EC JRC), 0 to 10">INFORM</th>
      </tr></thead>`;
    const body = rows.map((r) => {
      const grade = (r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)}`).join("<br>") || '<span class="muted">none</span>';
      const hp = r.health_in_need
        ? `<span title="${esc(`${r.health_in_need.source}, ${r.health_in_need.year}`)}">${fmtCompact(r.health_in_need.value)}</span>${String(r.health_in_need.year) !== String(new Date().getFullYear()) ? ` <small>${esc(r.health_in_need.year)}</small>` : ""}`
        : r.health_outdated
          ? cellStale(`${fmtCompact(r.health_outdated.value)} <small>(${esc(r.health_outdated.year)})</small>`, true, "No current humanitarian plan figure; last plan shown for reference")
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
        <td>${levelTag(r.classification.level)} <small>${r.classification.score}/${r.classification.max_score}</small></td>
        <td>${grade}</td>
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
        ["Insufficient data", counts(fcv, "Insufficient data"), "fewer than 3 core indicators current"],
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
      const sorted = rows.slice().sort((a, b) =>
        (LEVEL_ORDER[b.classification.level] - LEVEL_ORDER[a.classification.level]) || (b.classification.score - a.classification.score));
      table.innerHTML = `
        <thead><tr><th>Country</th><th>Group</th><th>DHM triage tier</th><th>Points</th><th>Criteria met</th><th>Core indicators current</th><th>WHO grade</th></tr></thead>
        <tbody>${sorted.map((r) => `
          <tr>
            <td><button type="button" class="strat-link" data-strat-country="${r.iso3}">${esc(r.country)}</button></td>
            <td>${esc(GROUP_LABEL[r.group] || r.group)}</td>
            <td>${levelTag(r.classification.level)}</td>
            <td class="num">${r.classification.score}/${r.classification.max_score}</td>
            <td>${r.classification.points.length
              ? `<ul class="strat-points">${r.classification.points.map((p) => `<li>${esc(p.criterion)} <small>(+${p.score})</small></li>`).join("")}</ul>`
              : '<span class="muted">none</span>'}</td>
            <td class="num">${r.classification.indicators_available ?? "n/a"} of 4</td>
            <td>${(r.who_grades || []).map((g) => `${esc(g.grade)}: ${esc(g.event)} <small>(${esc(g.date_graded)})</small>`).join("<br>") || '<span class="muted">none recorded</span>'}</td>
          </tr>`).join("")}</tbody>`;
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
      ["DHM triage tier", `${levelTag(r.classification.level)} ${r.classification.score}/${r.classification.max_score}`, "Rule-based, not a WHO grade"],
      ["WHO grade", (r.who_grades || []).map((g) => esc(g.grade)).join(", ") || "none recorded", "WHO grading register"],
      ["Humanitarian plan", r.plan ? esc(r.plan.name || r.plan.code) : "no current plan", f ? "OCHA FTS" : "HDX HAPI"],
      ["People in need (all sectors)", fmtCompact(r.people_in_need?.value), r.people_in_need ? `${esc(r.people_in_need.source)}, ${esc(r.people_in_need.year)}` : ""],
      ["People in need of health assistance", r.health_in_need ? fmtCompact(r.health_in_need.value) : r.health_outdated ? `${fmtCompact(r.health_outdated.value)} (${esc(r.health_outdated.year)}, outdated)` : "n/a", r.health_in_need ? `${esc(r.health_in_need.source)}, ${esc(r.health_in_need.year)}` : ""],
      ["Health targeted", fmtCompact(r.health_targeted?.value), r.health_targeted ? `${esc(r.health_targeted.source)}, ${esc(r.health_targeted.year)}` : ""],
      ["Health funding", f ? `${fmtUsd(f.funding_usd)} of ${fmtUsd(f.requirements_usd)} (${fmtPct(f.pct)})` : "n/a", f ? "OCHA FTS" : ""],
      ["IDPs", r.idps ? `${fmtCompact(r.idps.value)}${r.idps.stale ? " (outdated)" : ""}` : "n/a", r.idps ? `${esc(r.idps.source)}, ${esc(fmtMonth(r.idps.date))}` : ""],
      ["Refugees and asylum seekers hosted", fmtCompact(r.refugees?.value), r.refugees ? `${esc(r.refugees.source)}, ${esc(r.refugees.year)}` : ""],
      ["IPC/CH Phase 3+ (share of the population analysed)", r.ipc ? `${fmtPct(r.ipc.fraction)} (${fmtCompact(r.ipc.population)} people)${r.ipc.stale ? ", outdated" : ""}` : "no analysis", r.ipc ? `IPC, ${fmtMonth(r.ipc.period_start)} to ${fmtMonth(r.ipc.period_end)} (${esc(r.ipc.kind)})` : ""],
      ["Attacks on health care this year", r.attacks ? `${fmtFull(r.attacks.ytd.attacks)} attacks, ${fmtFull(r.attacks.ytd.deaths)} killed, ${fmtFull(r.attacks.ytd.injuries)} injured` : "not monitored by SSA", r.attacks ? "WHO SSA" : ""],
      ["INFORM Risk (0 to 10)", r.inform_risk ? `${esc(r.inform_risk.overall)} (global rank ${esc(r.inform_risk.global_rank)})` : "n/a", r.inform_risk ? `EC JRC, ${esc(r.inform_risk.year)}` : ""]
    ];
    node.innerHTML = `
      <div class="panel-header"><h2>Strategic Country Card: ${esc(r.country)}</h2><p>${esc(GROUP_LABEL[r.group] || "")} country. Verified sources only; each line shows its source and date.</p></div>
      <div class="strat-card-grid">${items.map(([k, v, s]) => `<div class="strat-card-item"><span class="strat-card-label">${k}</span><span class="strat-card-value">${v}</span>${s ? `<span class="strat-source">${s}</span>` : ""}</div>`).join("")}</div>`;
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
      <div class="strat-kpi-grid strat-kpi-grid-3">
        <div class="strat-kpi strat-kpi-static"><span class="strat-kpi-title">Attacks (FCV countries)</span><span class="strat-kpi-value">${fmtFull(sum(fcv, (r) => r.attacks.ytd.attacks))}</span></div>
        <div class="strat-kpi strat-kpi-static strat-kpi-bad"><span class="strat-kpi-title">Deaths</span><span class="strat-kpi-value">${fmtFull(sum(fcv, (r) => r.attacks.ytd.deaths))}</span></div>
        <div class="strat-kpi strat-kpi-static"><span class="strat-kpi-title">Injuries</span><span class="strat-kpi-value">${fmtFull(sum(fcv, (r) => r.attacks.ytd.injuries))}</span></div>
      </div>
      <div class="two-col strat-ssa-grid">
        <div class="table-wrap"><table class="strat-table">
          <thead><tr><th>Country</th><th>${year} attacks</th><th>Killed</th><th>Injured</th><th>Same period ${year - 1}</th><th>Full year ${year - 1}</th><th>Full year ${year - 2}</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.country)}${r.group === "context" ? ' <small class="muted">(context)</small>' : ""}</td>
            <td class="num"><strong>${fmtFull(r.attacks.ytd.attacks)}</strong></td><td class="num">${fmtFull(r.attacks.ytd.deaths)}</td><td class="num">${fmtFull(r.attacks.ytd.injuries)}</td>
            <td class="num">${r.attacks.prev_ytd ? fmtFull(r.attacks.prev_ytd.attacks) : "n/a"}</td><td class="num">${annualCell(r, year - 1)}</td><td class="num">${annualCell(r, year - 2)}</td></tr>`).join("")}</tbody></table></div>
        <div id="stratSsaChart" class="chart strat-chart"></div>
      </div>
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
          ${line(s.ssa.name, s.ssa, "Countries with an SSA deployment only.")}
          ${line(s.grading.name, { updated_at: s.grading.updated_at }, `Grading register maintained by DHM (<code>${esc(s.grading.file)}</code> in GitHub).`)}
          ${line(s.profile.name, { loaded_at: s.profile.loaded_at }, "Fallback for plan figures not yet in HDX HAPI.")}
        </tbody></table></div>
        <p class="muted">Oldest source in cache: ${isNum(state.payload.cache_age_hours) && Number.isFinite(state.payload.cache_age_hours) ? `${Math.max(0, state.payload.cache_age_hours).toFixed(1)} hours` : "n/a"}.</p>`;
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

  function goToPage(pageId) {
    const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
    if (btn) btn.click();
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
    const select = el("countrySelect");
    if (select) select.addEventListener("change", renderCountryCard);
  }

  window.StrategicDashboard = {
    onDashboardData(dash) {
      state.dash = dash;
      if (state.payload) {
        renderMhpssChart();
        renderKpis();
        renderDataHealth();
        renderCountryCard();
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
    reload: load
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { bind(); load(); });
  } else {
    bind();
    load();
  }
})();
