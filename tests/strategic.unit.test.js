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

  console.log("strategic unit test passed");
}

run();
