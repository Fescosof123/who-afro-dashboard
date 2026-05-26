const assert = require("assert/strict");
const { extractEnsoAdvisoryFromHtml, classifyEnsoRisk } = require("../server");

function run() {
  const sampleHtml = `
    <html><body>
      ENSO DIAGNOSTIC DISCUSSION issued by CLIMATE PREDICTION CENTER/NCEP/NWS
      12 March 2026
      ENSO Alert System Status: La Niña Advisory / El Niño Watch
      Synopsis: A transition from La Niña to ENSO-neutral is expected in the next month, with
      ENSO-neutral favored through May-July 2026 (55% chance). In June-August 2026, El Niño is likely
      to emerge (62% chance) and persist through at least the end of 2026.
      The next ENSO Diagnostics Discussion is scheduled for 9 April 2026.
    </body></html>
  `;

  const advisory = extractEnsoAdvisoryFromHtml(sampleHtml);
  assert.ok(advisory, "Expected advisory to be parsed from CPC-like HTML");
  assert.equal(advisory.alert_status, "La Niña Advisory / El Niño Watch");
  assert.equal(advisory.issued_on, "12 March 2026");
  assert.equal(advisory.next_update, "9 April 2026");
  assert.equal(advisory.risk_level, "watch");
  assert.ok(/El Niño is likely to emerge/i.test(advisory.synopsis || ""), "Expected parsed synopsis to include likely El Nino emergence");

  const summaryOnlyHtml = `
    <html><body>
      ENSO DIAGNOSTIC DISCUSSION issued by CLIMATE PREDICTION CENTER/NCEP/NWS 10 January 2027 ENSO Alert System Status: El Niño Advisory
      In summary, El Niño is expected to persist through March-May 2027 (68% chance).
      The next ENSO Diagnostics Discussion is scheduled for 8 February 2027.
    </body></html>
  `;

  const summaryAdvisory = extractEnsoAdvisoryFromHtml(summaryOnlyHtml);
  assert.ok(summaryAdvisory, "Expected advisory parse from summary-only variant");
  assert.equal(summaryAdvisory.alert_status, "El Niño Advisory");
  assert.equal(summaryAdvisory.issued_on, "10 January 2027");
  assert.equal(summaryAdvisory.next_update, "8 February 2027");
  assert.ok(/persist through/i.test(summaryAdvisory.synopsis || ""), "Expected summary-based synopsis fallback");

  assert.equal(classifyEnsoRisk("El Niño Warning"), "high");
  assert.equal(classifyEnsoRisk("La Niña Advisory / El Niño Watch"), "watch");
  assert.equal(classifyEnsoRisk("ENSO Neutral"), "info");

  console.log("enso parser unit test passed");
}

run();
