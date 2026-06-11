# Offline Data Directory

When network access is unavailable the server falls back to files in this directory.
Place source files here before running the server offline.

## Directory Structure

```
data/
  country-feed/
    latest.csv          Country override CSV (optional)
  ipc/
    {ISO3}.csv          IPC food security CSV from HDX
  nutrition/
    {ISO3}.xlsx         HDX acute malnutrition XLSX from HDX
  worldbank/
    {indicator_code}.json   World Bank rows array (see format below)
  feeds/
    gdacs.json          GDACS hazard RSS items
    reliefweb.json      ReliefWeb reports RSS items
    unhcr.json          UNHCR displacement RSS items
    idmc.json           IDMC displacement RSS items
    ocha.json           OCHA situation RSS items
```

## File Formats

### IPC CSV  (`data/ipc/{ISO3}.csv`)
Download from HDX: search the country + "IPC Food Security".
Use the URL from `HDX_IPC_URLS` in `server.js` and save the raw CSV.
Example file name: `BFA.csv`, `ETH.csv`, `NGA.csv`

### Nutrition XLSX  (`data/nutrition/{ISO3}.xlsx`)
Download the "FEWS NET / UNICEF acute malnutrition" XLSX from HDX.
Use the URL from `HDX_MALNUTRITION_URLS` in `server.js` and save the file.
Example file name: `NGA.xlsx`, `BFA.xlsx`

### World Bank JSON  (`data/worldbank/{indicator_code}.json`)
Format: a JSON array of World Bank row objects (the `data[1]` element from the API response).
Each element must have at least `countryiso3code`, `date`, and `value`.

Example filename: `SH.STA.WAST.ZS.json`

```json
[
  { "countryiso3code": "BFA", "date": "2022", "value": 14.2 },
  { "countryiso3code": "ETH", "date": "2022", "value": 9.5 }
]
```

### RSS Feed JSON  (`data/feeds/{source}.json`)
Format: `{ "items": [ ...rss-parser item objects... ] }`

Each item should have the fields that rss-parser would return:
`title`, `link`, `pubDate`, `contentSnippet`, `content`, `guid`

```json
{
  "items": [
    {
      "title": "Cyclone Freddy makes landfall in Mozambique",
      "link": "https://...",
      "pubDate": "Mon, 20 Feb 2023 00:00:00 +0000",
      "contentSnippet": "...",
      "content": "..."
    }
  ]
}
```

To capture a live feed for offline use, copy the parsed `feed.items` array from the
running server (e.g. via a small script calling `parser.parseURL(url)`) and wrap it
in `{ "items": [...] }`.

### EM-DAT Cache JSON (`data/emdat-cache.json`)

Historical natural-disaster impact data (deaths, people affected, damage) for Africa.

EM-DAT has no public API. To refresh:

1. Log in at <https://public.emdat.be> (free registration).
2. Access Data → filter Classification: Natural, Countries: Africa, period 2000–present.
3. Download the `public_emdat_*.xlsx` export into `data/`.
4. Run `node scripts/build-emdat-cache.js` to regenerate `emdat-cache.json`.

The raw xlsx is gitignored (EM-DAT terms of use forbid redistribution); only the
aggregated cache JSON is committed. EM-DAT updates a few times per year, so a manual
refresh every few months is sufficient. Current-year figures are provisional until
EM-DAT's annual validation.

### Country Feed CSV (`data/country-feed/latest.csv`)
Format: one row per country using ISO3 as key.

Minimum required column:
- `iso3`

Recommended columns (all optional beyond `iso3`):
- `ipc_phase3plus_pct`, `ipc_phase3plus_number`, `ipc_phase4_number`, `ipc_phase5_number`, `ipc_analysis_date`
- `ipc_projection_phase3plus_pct`, `ipc_projection_phase3plus_number`, `ipc_projection_date`
- `fews_cs_phase`, `fews_ml1_phase`
- `wasting_u5_pct`, `stunting_u5_pct`, `pregnant_anemia_pct`, `nutrition_year`
- `hazard_count`, `flood_count`, `cyclone_count`, `drought_signal_count`, `report_count_30d`
- `conflict_signal_count`, `displacement_signal_count`, `icpac_forecast_count`

Reference template file:
- `data/country-feed-template.csv`

## ISO3 Country Codes for AFRO FCV Countries

| Country | ISO3 |
|---------|------|
| Burkina Faso | BFA |
| Cameroon | CMR |
| Central African Republic | CAF |
| Chad | TCD |
| Democratic Republic of Congo | COD |
| Ethiopia | ETH |
| Kenya | KEN |
| Libya | LBY |
| Mali | MLI |
| Mozambique | MOZ |
| Niger | NER |
| Nigeria | NGA |
| Somalia | SOM |
| South Sudan | SSD |
| Sudan | SDN |
| Tanzania | TZA |
| Uganda | UGA |
| Zimbabwe | ZWE |

(Verify against `FCV_COUNTRIES` in `server.js` for the complete list.)
