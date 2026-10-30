const assert = require("assert");
const strategic = require("../lib/strategic");

function run() {
  // Classification is transparent and additive.
  const major = strategic.classifyCountry({
    inform_risk: { risk_class: 5, overall: 8.5 },
    health_in_need: { value: 6000000 },
    ipc: { fraction: 0.55, stale: false },
    idps: { value: 2000000 },
    refugees: { value: 600000 },
    attacks: { ytd: { attacks: 26, deaths: 28 } }
  });
  assert.equal(major.level, "Major");
  assert.equal(major.score, 8);
  assert.equal(major.max_score, 8);

  // Stale IPC earns no points.
  const staleIpc = strategic.classifyCountry({
    inform_risk: { risk_class: 3, overall: 4.8 },
    health_in_need: { value: 600000 },
    ipc: { fraction: 0.4, stale: true },
    idps: null,
    refugees: null,
    attacks: null
  });
  assert.equal(staleIpc.points.some((p) => /IPC/.test(p.criterion)), false);
  // Only two core indicators are current (INFORM, health PiN), so no tier is assigned.
  assert.equal(staleIpc.level, "Insufficient data");

  // A stale IDP figure is not counted as displacement.
  const staleIdp = strategic.classifyCountry({
    inform_risk: { risk_class: 5, overall: 8 },
    health_in_need: { value: 3000000 },
    ipc: { fraction: 0.3, stale: false },
    idps: { value: 3000000, stale: true },
    refugees: { value: 10000 },
    attacks: null
  });
  assert.equal(staleIdp.points.some((p) => /IDPs/.test(p.criterion)), false);

  // The seeded payload keeps FCV totals to the 13 FCV countries and never counts stale IDPs.
  const payload = strategic.buildStrategicPayload(null);
  const fcv = payload.countries.filter((c) => ["fcv_prioritized", "fcv_accelerated"].includes(c.group));
  assert.equal(fcv.length, 13);
  const freshIdps = fcv.reduce((s, c) => s + (c.idps && !c.idps.stale ? c.idps.value : 0), 0);
  assert.equal(payload.kpis.idps, freshIdps);
  assert.ok(payload.kpis.health_requirements_usd > 0, "Expected FTS health requirements in the seed cache");
  fcv.forEach((c) => {
    if (c.health_funding) {
      assert.ok(c.health_funding.pct >= 0, `Funding share should be non-negative for ${c.iso3}`);
    }
  });

  // No current plan: the last plan's figure counts toward the tier only while it is recent.
  const lastPlanRecent = strategic.classifyCountry({
    inform_risk: { risk_class: 5, overall: 7 },
    health_in_need: null,
    health_outdated: { value: 3000000, year: "2024", counts_for_tier: true },
    ipc: null,
    idps: null,
    refugees: { value: 1200000 },
    attacks: null
  });
  assert.equal(lastPlanRecent.level, "Severe");
  assert.ok(lastPlanRecent.points.some((p) => /last plan, 2024/.test(p.criterion)));
  assert.equal(lastPlanRecent.uses_last_plan, true);
  const lastPlanOld = strategic.classifyCountry({
    inform_risk: { risk_class: 5, overall: 7 },
    health_in_need: null,
    health_outdated: { value: 3000000, year: "2022", counts_for_tier: false },
    ipc: null,
    idps: null,
    refugees: { value: 1200000 },
    attacks: null
  });
  assert.equal(lastPlanOld.level, "Insufficient data");
  assert.ok(lastPlanOld.missing.includes("no humanitarian plan since 2022"));

  // HPC plan parsing: Health cluster by name (French), latest monitoring period, numeric strings.
  const plan = {
    monitoringPeriods: [
      { id: 1, startDate: "2025-01-01", endDate: "2025-03-31", measurementsGenerated: true },
      { id: 2, startDate: "2025-04-01", endDate: "2025-06-30", measurementsGenerated: true }
    ],
    attachments: [{ type: "caseLoad", attachmentVersion: { value: { metrics: { values: { totals: [{ type: "inNeed", value: 900 }, { type: "target", value: 500 }] } } } } }],
    governingEntities: [
      { governingEntityVersion: { name: "Nutrition" }, attachments: [{ type: "caseLoad", attachmentVersion: { value: { metrics: { values: { totals: [{ type: "inNeed", value: 50 }] } } } } }] },
      {
        governingEntityVersion: { name: "Santé" },
        attachments: [{
          type: "caseLoad",
          attachmentVersion: { value: { metrics: { values: { totals: [{ type: "inNeed", value: "400" }, { type: "target", value: 200 }] } } } },
          measurements: [
            { planReportingPeriodId: 1, measurementVersion: { value: { metrics: { values: { totals: [{ type: "cumulativeReach", value: "60" }] } } } } },
            { planReportingPeriodId: 2, measurementVersion: { value: { metrics: { values: { totals: [{ type: "cumulativeReach", value: "120.5" }] } } } } }
          ]
        }]
      }
    ]
  };
  const health = strategic.extractHealthFromPlan(plan);
  assert.equal(health.in_need, 400);
  assert.equal(health.targeted, 200);
  assert.equal(health.reach.reached, 120.5);
  assert.equal(health.reach.period_end, "2025-06-30");

  // Country rows: the current HPC plan wins over HDX HAPI; an ended plan is never a current figure;
  // implausible reach is excluded; a full-year reach is flagged as such.
  const reference = { groups: { fcv_prioritized: [{ iso3: "AAA", name: "Alpha" }, { iso3: "BBB", name: "Beta" }] } };
  const now = new Date("2026-10-28T00:00:00Z");
  const cache = {
    hapi: {
      AAA: { health_history: { 2026: { year: "2026", in_need: 700, targeted: 300 }, 2025: { year: "2025", in_need: 800, targeted: 400 } } },
      BBB: {}
    },
    hpc: {
      plans: {
        1: { iso3: "AAA", year: "2026", code: "HAAA26", end: "2026-12-31", health: { in_need: 1000, targeted: 500, reach: null }, plan_totals: { in_need: 2000 } },
        2: { iso3: "AAA", year: "2025", code: "HAAA25", end: "2025-12-31", health: { in_need: 900, targeted: 450, reach: { reached: 300, period_start: "2025-10-01", period_end: "2025-12-31" } } },
        3: { iso3: "BBB", year: "2025", code: "FBBB25", name: "Beta Flash Appeal 2025", end: "2025-06-01", health: { in_need: 3000000, targeted: 2000, reach: { reached: 5, period_start: "2025-01-01", period_end: "2025-06-01" } } }
      }
    },
    fts: [],
    ssa: {}
  };
  const rows = strategic.buildCountryRows(cache, reference, null, { rows: [] }, now);
  const a = rows.find((r) => r.iso3 === "AAA");
  const bRow = rows.find((r) => r.iso3 === "BBB");
  assert.equal(a.health_in_need.value, 1000);
  assert.equal(a.health_targeted.value, 500);
  assert.equal(a.people_in_need.value, 2000);
  assert.equal(a.health_in_need_previous.value, 900);
  assert.equal(a.health_reach_latest.full_year, true);
  assert.equal(a.health_reach_latest.reached, 300);
  assert.equal(bRow.health_in_need, null);
  assert.equal(bRow.health_outdated.value, 3000000);
  // A flash appeal that has ended does not count toward the tier.
  assert.equal(bRow.health_outdated.counts_for_tier, false);
  assert.equal(bRow.health_reach_latest, null);
  assert.equal(bRow.health_reach_excluded.plan_code, "FBBB25");

  // Annual plan ended 22 months ago counts toward the tier; last year's annual plan
  // carries over in January until the new plan appears.
  const cache2 = { hapi: {}, fts: [], ssa: {}, hpc: { plans: {
    7: { iso3: "AAA", year: "2024", code: "HAAA24", name: "Alpha HRP 2024", end: "2024-12-31", health: { in_need: 3000000, targeted: 1, reach: null } },
    8: { iso3: "BBB", year: "2026", code: "HBBB26", end: "2026-12-31", health: { in_need: 5000, targeted: 2500, reach: null }, plan_totals: { in_need: 4000 } }
  } } };
  const oct = strategic.buildCountryRows(cache2, reference, null, { rows: [] }, now);
  assert.equal(oct.find((r) => r.iso3 === "AAA").health_outdated.counts_for_tier, true);
  // A plan total smaller than the health figure is not used.
  assert.equal(oct.find((r) => r.iso3 === "BBB").people_in_need, null);
  const jan = strategic.buildCountryRows(cache2, reference, null, { rows: [] }, new Date("2027-01-10T00:00:00Z"));
  assert.equal(jan.find((r) => r.iso3 === "BBB").health_in_need.value, 5000);
  assert.equal(jan.find((r) => r.iso3 === "BBB").health_in_need.year, "2026");

  // Reach register: used for the current plan year when OCHA has not published reach.
  const regRows = [{ iso3: "AAA", plan_year: "2026", period_end: "2026-09-30", reached: 250, targeted: 500, reference: "Health Cluster bulletin Sep 2026" }];
  const withReg = strategic.buildCountryRows(cache, reference, null, { rows: [] }, now, regRows);
  assert.equal(withReg.find((r) => r.iso3 === "AAA").health_reached.value, 250);
  assert.ok(/Health Cluster report/.test(withReg.find((r) => r.iso3 === "AAA").health_reached.source));
  const badReg = strategic.buildCountryRows(cache, reference, null, { rows: [] }, now, [{ ...regRows[0], reached: 1 }]);
  assert.equal(badReg.find((r) => r.iso3 === "AAA").health_reached, null);

  // Monthly snapshots: the latest snapshot in a month wins; the base is the latest earlier month.
  const snapA = strategic.snapshotFromRows(rows, new Date("2026-09-10T00:00:00Z"));
  const snapB = strategic.snapshotFromRows(rows, new Date("2026-09-30T00:00:00Z"));
  const snapC = strategic.snapshotFromRows(rows, new Date("2026-10-28T00:00:00Z"));
  const merged = strategic.mergeHistory({ snapshots: [snapB, snapC] }, { snapshots: [snapA] });
  assert.deepEqual(merged.snapshots.map((x) => x.month), ["2026-09", "2026-10"]);
  assert.equal(merged.snapshots[0].taken_at, snapB.taken_at);
  const hist = strategic.historyForPayload(merged, new Date("2026-10-28T00:00:00Z"));
  assert.equal(hist.base.month, "2026-09");
  assert.equal(strategic.historyForPayload(merged, new Date("2026-09-15T00:00:00Z")).base, null);

  // Weekly snapshots: one per ISO week; the week base is the latest earlier week.
  assert.equal(strategic.weekKey(new Date("2026-10-28T00:00:00Z")), "2026-W44");
  const w1 = strategic.snapshotFromRows(rows, new Date("2026-10-19T08:00:00Z"));
  const w2 = strategic.snapshotFromRows(rows, new Date("2026-10-25T08:00:00Z"));
  const w3 = strategic.snapshotFromRows(rows, new Date("2026-10-28T08:00:00Z"));
  const mergedW = strategic.mergeHistory({ snapshots: [w1, w2, w3], weekly: [w1, w2, w3] });
  assert.deepEqual(mergedW.weekly.map((x) => x.week), ["2026-W43", "2026-W44"]);
  const hw = strategic.historyForPayload(mergedW, new Date("2026-10-28T12:00:00Z"));
  assert.equal(hw.week_base.week, "2026-W43");
  assert.equal(hw.week_base.taken_at, w2.taken_at);

  // ACMAD bulletin parser.
  const acmad = require("../lib/acmad");
  const sample = [
    "                             Issued on: October 29th, 2026",
    "                    VIGILANCE MAP AND POLICY BRIEF FOR MENINGITIS OUBREAK",
    "                                                           Valid From October 30 to November 5, 2026",
    "HIGHLIGHT: Emergence of Meningitis cases is very likely and epidemics status possible in Mali, Niger, and Chad.",
    "Emergence of Meningitis cases is likely in Burkina Faso, Nigeria, Cameroon, and Sudan.",
    "                                                                                                 Phenomenon                   Hazard",
    "                    VIGILANCE MAP AND POLICY BRIEF FOR HEAVY RAINFALL AND STRONG WINDS",
    "                                                               Valid From October 30 to November 3, 2026",
    "HIGHLIGHT: Heavy rainfall is expected in Cameroon, Gabon, Congo, Angola, and D.R.C."
  ].join("\n");
  const parsed = acmad.parseBulletinText(sample);
  assert.equal(parsed.issued_on, "2026-10-29");
  assert.equal(parsed.sections.length, 2);
  const men = parsed.sections[0];
  assert.equal(men.hazard, "meningitis");
  assert.equal(men.valid_from, "2026-10-30");
  assert.equal(men.valid_to, "2026-11-05");
  assert.deepEqual(men.sentences[0].countries.sort(), ["MLI", "NER", "TCD"]);
  assert.equal(men.sentences[0].level, "high");
  assert.equal(men.sentences[1].level, "watch");
  assert.ok(men.sentences[1].countries.includes("SDN") && !men.sentences[1].countries.includes("SSD"));
  assert.ok(!men.sentences[0].countries.includes("NGA"));
  const rain = parsed.sections[1];
  assert.ok(rain.sentences[0].countries.includes("COD") && rain.sentences[0].countries.includes("COG"));

  console.log("strategic unit test passed");
}

run();
