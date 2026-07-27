const assert = require("assert/strict");
const {
  detectCsvDelimiter,
  decodeCsvBuffer,
  toFiniteNumber,
  parseMonthYearLabel,
  quarterOfIsoMonth,
  hasServiceDeliverySchema,
  parseCountryFeedCsv
} = require("../server");

// Real header + first two rows from the semicolon-delimited export that
// replaced the old comma-delimited "FCV-Services-Deliveries-Database.csv".
const NEW_FORMAT_HEADER = "N°;Name of Respondent;Function/Position/Title;Month of Report;Year of Report;Admin0 (Country/State);Admin1 (Province/Region/LGA);Admin2 (District);Total outpatient department (OPD) consultations per person per month;Number of persons benefiting from mental health services and psychological support;Number of GBV cases identified and clinically managed (GBVIMS);Number of people reached;% of deliveries in a health institution;Mean number of ANC visits per pregnant woman during the time period;Measles vaccination coverage (%);PENTA vaccination coverage (%);Number of children screened for malnutrition;Percentage of severe acute malnutrition (SAM) cases with complications;Percentage of severe acute malnutrition (SAM) cases with complications managed;Total number of Health Facilities;Percentage of healthcare facilities that reported a service disruption during the last 90 days.;Percentage of health facilities that implement essential health (H3) package.";

const NEW_FORMAT_ROW_1 = "1;Daouda KOUSSOUBE;Gestionnaire d'information;January 2026;2026;Burkina Faso;Bankui;;0;2;0;0;103,1;3,47;114,4;118,1;;;;;;";
const NEW_FORMAT_ROW_2 = "2;Daouda KOUSSOUBE;Gestionnaire d'information;February 2026;2026;Burkina Faso;Bankui;;0;0;0;435;101,4;3,49;124,1;108,5;;;;;;";
const NEW_FORMAT_ROW_3 = "3;Someone Else;Data manager;March 2026;2026;Burkina Faso;Zorgo;;4 762;1;2;300;95,2;3,10;90,0;92,0;500;10;5;120;12,5;80,0";

function run() {
  assert.equal(detectCsvDelimiter(NEW_FORMAT_HEADER), ";", "Expected semicolon delimiter to be detected from the new header");
  assert.equal(detectCsvDelimiter("a,b,c"), ",", "Expected comma delimiter for a legacy-style header");

  assert.equal(toFiniteNumber("103,1", "comma_decimal"), 103.1, "comma_decimal should treat ',' as the decimal separator");
  assert.equal(toFiniteNumber("4 762", "comma_decimal"), 4762, "comma_decimal should strip space thousands separators");
  assert.equal(toFiniteNumber("0.69", "plain"), 0.69, "plain format should still parse a dotted decimal unchanged");
  assert.equal(toFiniteNumber("NA", "comma_decimal"), null, "NA should remain null regardless of number format");

  const month = parseMonthYearLabel("January 2026", "2026");
  assert.ok(month, "Expected January 2026 to parse");
  assert.equal(month.iso_month, "2026-01");

  const quarter = quarterOfIsoMonth("2026-01");
  assert.equal(quarter.quarter_label, "2026-Q1");
  const quarterQ3 = quarterOfIsoMonth("2026-08");
  assert.equal(quarterQ3.quarter_label, "2026-Q3");

  assert.equal(
    hasServiceDeliverySchema([{ "Admin0 (Country/State)": "Chad", "Month of Report": "January 2026", "Year of Report": "2026" }]),
    true,
    "New split month/year schema should be recognized"
  );
  assert.equal(
    hasServiceDeliverySchema([{ "Admin0 (Country/State)": "Chad", "Month Report": "Feb-25" }]),
    true,
    "Legacy single-field month schema should still be recognized"
  );

  // Raw-bytes decode sanity check: "N°" saved as a single Latin-1 byte
  // (0xB0) must come back as "N°", not the mis-decoded "N�".
  const rawBuffer = Buffer.from([0x4e, 0xb0, 0x3b]); // "N", 0xB0 ("°" in latin1), ";"
  assert.equal(decodeCsvBuffer(rawBuffer), "N°;");

  // Full pipeline: feed the real header + 3 rows through the CSV entry point.
  const csvText = [NEW_FORMAT_HEADER, NEW_FORMAT_ROW_1, NEW_FORMAT_ROW_2, NEW_FORMAT_ROW_3].join("\n");
  const parsed = parseCountryFeedCsv(csvText);
  assert.equal(parsed.schema_kind, "service_delivery");
  assert.equal(parsed.raw_row_count, 3);

  const bfa = parsed.records.find((r) => r.iso3 === "BFA");
  assert.ok(bfa, "Expected Burkina Faso (BFA) to resolve from 'Burkina Faso'");

  const janRow = bfa.service_delivery.monthly_series.find((r) => r.iso_month === "2026-01");
  assert.ok(janRow, "Expected a January 2026 monthly row for BFA");
  // This is a REAL >100% value already present in the source data — the
  // data-quality "values >100%" flag must fire on this, not a hypothetical.
  assert.equal(janRow.deliveries_in_health_institution_pct, 103.1);
  assert.equal(janRow.measles_vaccination_coverage_pct, 114.4);
  assert.equal(janRow.quarter_label, "2026-Q1");

  const marRow = bfa.service_delivery.monthly_series.find((r) => r.iso_month === "2026-03");
  assert.ok(marRow, "Expected a March 2026 monthly row for BFA");
  assert.equal(marRow.opd_consultations_per_person_per_month, 4762, "Space-thousands number should parse correctly");
  assert.equal(marRow.children_screened_malnutrition, 500);
  assert.equal(marRow.total_health_facilities, 120);
  assert.equal(marRow.facility_disruption_pct, 12.5);
  assert.equal(marRow.h3_package_pct, 80);

  const admin1Rows = parsed.admin1_quarterly_rows.filter((r) => r.iso3 === "BFA" && r.quarter_label === "2026-Q1");
  const bankui = admin1Rows.find((r) => r.admin1 === "Bankui");
  const zorgo = admin1Rows.find((r) => r.admin1 === "Zorgo");
  assert.ok(bankui, "Expected a Bankui admin1 quarterly row for BFA/2026-Q1");
  assert.ok(zorgo, "Expected a Zorgo admin1 quarterly row for BFA/2026-Q1");

  const bfaQuarter = parsed.quarterly_rows.find((r) => r.iso3 === "BFA" && r.quarter_label === "2026-Q1");
  assert.ok(bfaQuarter, "Expected a BFA 2026-Q1 quarterly row");
  // total_health_facilities must use the LATEST month in the quarter (120),
  // never a sum across the quarter's months — summing would itself recreate
  // the "3-month sum inflates the network count" problem.
  assert.equal(bfaQuarter.total_health_facilities, 120);

  // Legacy comma-delimited / single-field-month format must still parse.
  const legacyCsv = [
    "N°,Name of Respondent,Function/Position/Title,Month Report,Admin0 (Country/State),Admin1 (Province/Region/LGA),Admin2 (District),Total outpatient department (OPD) consultations per person per month,Number of persons benefiting from mental health services and psychological support,Number of GBV cases identified and clinically managed (GBVIMS),Number of people reached,% of deliveries in a health institution,Mean number of ANC visits per pregnant woman during the time period,Measles vaccination coverage (%),PENTA vaccination coverage (%),Number of children screened for malnutrition,Percentage of severe acute malnutrition (SAM) cases with complications,Percentage of severe acute malnutrition (SAM) cases with complications managed",
    '1,"SINANI, Moegni",data manager,Feb-25,Comoros,Ngazidja,Centre,21159,3,19,NA,0.69,3.15,0.81,NA,32,0.56,NA'
  ].join("\n");
  const legacyParsed = parseCountryFeedCsv(legacyCsv);
  assert.equal(legacyParsed.schema_kind, "service_delivery");
  const com = legacyParsed.records.find((r) => r.iso3 === "COM");
  assert.ok(com, "Expected Comoros (COM) to resolve from legacy comma-delimited format");
  assert.equal(com.service_delivery.latest.deliveries_in_health_institution_pct, 0.69);

  console.log("service delivery parser unit test passed");
}

run();
