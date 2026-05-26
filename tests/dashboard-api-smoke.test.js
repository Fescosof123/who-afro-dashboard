const assert = require("assert/strict");
const path = require("path");
const { spawn } = require("child_process");

const cwd = path.join(__dirname, "..");
const port = process.env.SMOKE_TEST_PORT || "3107";
const baseUrl = `http://127.0.0.1:${port}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 45000) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await sleep(1000);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const server = spawn(process.execPath, ["server.js"], {
    cwd,
    env: { ...process.env, PORT: port },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderr = "";
  let stdout = "";
  server.stdout.on("data", (chunk) => {
    stdout += String(chunk || "");
  });
  server.stderr.on("data", (chunk) => {
    stderr += String(chunk || "");
  });

  try {
    await waitForServer(`${baseUrl}/api/health`);

    const response = await fetch(`${baseUrl}/api/dashboard-data`);
    assert.equal(response.ok, true, `dashboard-data request failed: HTTP ${response.status}`);
    const payload = await response.json();

    assert.equal(typeof payload.metric_ledger, "object", "Expected metric_ledger object in dashboard payload");
    assert.equal(typeof payload.metric_ledger.metrics, "object", "Expected metric_ledger.metrics object");
    assert.equal(typeof payload.metric_ledger.rule_version, "string", "Expected metric_ledger.rule_version string");
    assert.equal(payload.metric_ledger.rule_version.length > 0, true, "Expected metric_ledger.rule_version to be non-empty");
    const priorityFromCountries = Array.isArray(payload.countries)
      ? payload.countries.filter((country) => Number(country.risk_score || 0) >= 65).length
      : 0;
    assert.equal(
      Number(payload.metric_ledger.metrics?.priority_escalation_countries?.count || 0),
      priorityFromCountries,
      "Expected metric ledger priority escalation count to match country risk threshold computation"
    );

    assert.equal(Array.isArray(payload.fews_references), true, "Expected fews_references array");
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "fews_signals"), false, "fews_signals alias should not be present");
    assert.equal(typeof payload.fews_ipc_source_status, "object", "Expected fews_ipc_source_status object (FEWS Data Warehouse IPC integration)");
    assert.equal(["available", "unavailable"].includes(String(payload.fews_ipc_source_status?.overall || "")), true, "Expected fews_ipc_source_status.overall to be 'available' or 'unavailable'");
      assert.equal(Number.isFinite(Number(payload.fews_ipc_source_status?.mapped_countries)), true, "Expected fews_ipc_source_status.mapped_countries to be numeric");
    assert.equal(Array.isArray(payload.acled_context_entries), true, "Expected acled_context_entries array");
    assert.equal(Array.isArray(payload.acaps_updates), true, "Expected acaps_updates array");
    assert.equal(typeof payload.acaps_source_status, "object", "Expected acaps_source_status object");
    assert.equal(typeof payload.enso_source_status, "object", "Expected enso_source_status object");
    assert.equal(["available", "partial", "unavailable"].includes(String(payload.enso_source_status?.overall || "")), true, "Expected enso_source_status.overall to be available/partial/unavailable");
    assert.equal(Object.prototype.hasOwnProperty.call(payload, "enso_advisory"), true, "Expected enso_advisory field in dashboard payload");
    if (payload.enso_advisory) {
      assert.equal(typeof payload.enso_advisory.alert_status, "string", "Expected enso_advisory.alert_status string when advisory exists");
      assert.equal(payload.enso_advisory.alert_status.length > 0, true, "Expected enso_advisory.alert_status to be non-empty when advisory exists");
    }
    assert.equal(typeof payload.reliefweb_api_status, "object", "Expected reliefweb_api_status object");
    assert.equal(
      ["disabled", "configured_no_matches", "active", "error"].includes(String(payload.reliefweb_api_status?.overall || "")),
      true,
      "Expected reliefweb_api_status.overall to be disabled/configured_no_matches/active/error"
    );
    assert.equal(typeof payload.reliefweb_api_status.appname_configured, "boolean", "Expected reliefweb_api_status.appname_configured boolean");
    assert.equal(Number.isFinite(Number(payload.reliefweb_api_status.reports_returned)), true, "Expected reliefweb_api_status.reports_returned numeric");
    assert.equal(Number.isFinite(Number(payload.reliefweb_api_status.matching_signals)), true, "Expected reliefweb_api_status.matching_signals numeric");
    const apiTaggedFloodSignals = Array.isArray(payload.regional_flood_signals)
      ? payload.regional_flood_signals.filter((item) => String(item.source || "") === "ReliefWeb API").length
      : 0;
    assert.equal(
      Number(payload.reliefweb_api_status.matching_signals),
      apiTaggedFloodSignals,
      "Expected reliefweb_api_status.matching_signals to equal the number of ReliefWeb API-tagged regional flood signals"
    );
    assert.equal(Array.isArray(payload.who_don_reports), true, "Expected who_don_reports array");
    assert.equal(Array.isArray(payload.iom_dtm_reports), true, "Expected iom_dtm_reports array");
    assert.equal(typeof payload.who_don_source_status, "object", "Expected who_don_source_status object");
    assert.equal(["available", "partial", "unavailable", "fallback", "disabled"].includes(String(payload.who_don_source_status?.overall || "")), true, "Expected who_don_source_status.overall to be available/partial/unavailable/fallback/disabled");
    assert.equal(typeof payload.iom_dtm_source_status, "object", "Expected iom_dtm_source_status object");
    assert.equal(["available", "partial", "unavailable"].includes(String(payload.iom_dtm_source_status?.overall || "")), true, "Expected iom_dtm_source_status.overall to be available/partial/unavailable");
    assert.equal(Number.isFinite(Number(payload.acaps_source_status.pages_cap)), true, "Expected ACAPS pages_cap to be numeric");
    assert.equal(Number(payload.acaps_source_status.pages_cap) >= 1, true, "Expected ACAPS pages_cap >= 1");
    assert.equal(typeof payload.acaps_source_status.pages_scanned, "number", "Expected ACAPS pages_scanned telemetry");
    assert.equal(typeof payload.acaps_source_status.pages_with_cards, "number", "Expected ACAPS pages_with_cards telemetry");
    assert.equal(typeof payload.acaps_source_status.pages_with_new_items, "number", "Expected ACAPS pages_with_new_items telemetry");
    assert.equal(typeof payload.acaps_source_status.crawl_mode, "string", "Expected ACAPS crawl_mode telemetry");
    assert.equal(["fast", "deep"].includes(String(payload.acaps_source_status.crawl_mode).toLowerCase()), true, "Expected ACAPS crawl_mode to be 'fast' or 'deep'");
    assert.equal(typeof payload.acaps_source_status.pagination_stopped_reason, "string", "Expected ACAPS pagination_stopped_reason telemetry");
    assert.equal(String(payload.acaps_source_status.pagination_stopped_reason || "").trim().length > 0, true, "Expected ACAPS pagination_stopped_reason to be non-empty");

    const conflictCandidateKeys = Object.keys(
      payload.conflict_displacement_source_status?.candidate_items_current
      || payload.conflict_displacement_source_status?.candidate_items_30d
      || {}
    );
    assert.equal(conflictCandidateKeys.includes("acled"), false, "ACLED must not appear in current-refresh conflict reporting candidate counts");
    const candidateUnhcr = Number(
      payload.conflict_displacement_source_status?.candidate_items_current?.unhcr
      || payload.conflict_displacement_source_status?.candidate_items_30d?.unhcr
      || 0
    );
    assert.equal(candidateUnhcr > 0, true, "Expected UNHCR candidate count to be > 0 in current-refresh candidate set via active fallback chain");
    const candidateIomDtm = Number(
      payload.conflict_displacement_source_status?.candidate_items_current?.iom_dtm
      || payload.conflict_displacement_source_status?.candidate_items_30d?.iom_dtm
      || 0
    );
    assert.equal(Number.isFinite(candidateIomDtm), true, "Expected IOM DTM candidate count to be numeric in current-refresh candidate set");

    const latestHistory = Array.isArray(payload.conflict_displacement_source_status_history)
      ? payload.conflict_displacement_source_status_history[payload.conflict_displacement_source_status_history.length - 1]
      : null;
    assert.equal(!!latestHistory, true, "Expected conflict_displacement_source_status_history to contain at least one entry");

    const matched = latestHistory?.matched_signal_items || {};
    const unhcrRss = Number(matched["unhcr rss"] || 0);
    const unhcrReliefweb = Number(matched["unhcr via reliefweb"] || 0);
    const unhcrPopulation = Number(matched["unhcr population data"] || 0);
    const unhcrTotal = Number(matched["unhcr total"] || 0);
    const iomDtmMatched = Number(matched["iom dtm event tracking"] || 0);
    assert.equal(
      unhcrTotal,
      unhcrRss + unhcrReliefweb + unhcrPopulation,
      "UNHCR matched total must equal RSS + ReliefWeb fallback + Population Data fallback"
    );
    assert.equal(Number.isFinite(iomDtmMatched), true, "Expected IOM DTM matched signal count to be numeric");

    // Decision Protocol trigger fields: structural and reporting-30d candidate buckets must exist
    const conflictStatus = payload.conflict_displacement_source_status;
    assert.equal(
      typeof conflictStatus.candidate_items_structural, "object",
      "Expected candidate_items_structural to be an object (needed by Decision Protocol trigger matrix)"
    );
    assert.equal(
      typeof conflictStatus.candidate_items_reporting_30d, "object",
      "Expected candidate_items_reporting_30d to be an object (needed by Decision Protocol trigger matrix)"
    );

    const ledgerResponse = await fetch(`${baseUrl}/api/metric-ledger`);
    assert.equal(ledgerResponse.ok, true, `metric-ledger request failed: HTTP ${ledgerResponse.status}`);
    const ledgerPayload = await ledgerResponse.json();
    assert.equal(typeof ledgerPayload.metrics, "object", "Expected metric-ledger endpoint payload to include metrics object");
    assert.equal(typeof ledgerPayload.rule_version, "string", "Expected metric-ledger endpoint payload to include rule_version string");
    assert.equal(
      Number(ledgerPayload.metrics?.priority_escalation_countries?.count || 0),
      Number(payload.metric_ledger.metrics?.priority_escalation_countries?.count || 0),
      "Expected /api/metric-ledger and /api/dashboard-data metric_ledger priority counts to match"
    );

    console.log("dashboard api smoke test passed");
  } finally {
    server.kill();
    await sleep(500);
    if (server.exitCode && server.exitCode !== 0) {
      throw new Error(`Smoke test server exited with code ${server.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});