# WHO AFRO Humanitarian Events Decision Dashboard

A real-time humanitarian situation dashboard for WHO AFRO covering 48 FCV and AFRO countries.
Aggregates food security (IPC/FEWS), conflict (ACLED), health alerts (ACAPS), hazards (GDACS),
cyclone signals, ICPAC forecasts, and service delivery data into a single decision-support interface.

---

## Live Deployment

| Item | Detail |
| --- | --- |
| **URL** | <https://who-afro-humanitarian-dashboard.onrender.com> |
| **Platform** | Render.com (free tier) |
| **GitHub repo** | <https://github.com/Fescosof123/who-afro-dashboard> |
| **Keep-alive** | cron-job.org pings `/api/health` every 10 minutes |

---

## Publishing an Update

Any change pushed to GitHub automatically redeploys on Render (~2 minutes).

```bash
# From dashboard-app/ folder:
git add .
git commit -m "describe what changed"
git push
```

Render detects the push and rebuilds. No manual steps on Render needed.

---

## Run Locally

```bash
npm install
npm start
```

Open: <http://localhost:3000>

If port 3000 is stuck from a previous run, use `start-local.bat`; it clears the port first.

---

## Data Sources & Cache Files

Cached data lives in `data/`. The server refreshes these automatically on a schedule.
They are committed to the repo so the live deployment has seed data on startup.

| File | Source | Refresh |
| --- | --- | --- |
| `data/fews-ipc-cache.json` | FEWS NET / IPC food security phases | Auto |
| `data/country-feed-cache.json` | WHO FCV service delivery database | Auto / manual ingest |
| `data/acaps-cache.json` | ACAPS analysis reports | Auto |
| `data/acled-conflict-index-cache.csv` | ACLED conflict index | Auto |
| `FCV-Country-Profile-Data.xlsx` | HRP funding, people in need | Manual update |
| `FCV-Services-Deliveries-Database.xlsx` | Monthly service delivery by country | Manual update |

To force a data refresh without redeploying, click **"Refresh Data"** in the dashboard sidebar.

---

## Updating the Excel Data Files

1. Replace `FCV-Country-Profile-Data.xlsx` or `FCV-Services-Deliveries-Database.xlsx` with the new version.
2. Run:

```bash
git add FCV-Country-Profile-Data.xlsx FCV-Services-Deliveries-Database.xlsx
git commit -m "Update FCV profile and service delivery data"
git push
```

Render redeploys automatically.

---

## Environment Variables (Optional)

Create a `.env` file in this folder for local overrides. On Render, set these under
**Dashboard → Environment**.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Server port (Render sets this automatically) |
| `COUNTRY_FEED_INGEST_TOKEN` | *(none)* | Shared secret for `POST /api/country-feed` |
| `COUNTRY_FEED_PULL_MODE` | `auto` | `auto` or `off` |
| `COUNTRY_FEED_REFRESH_MINUTES` | `60` | How often to pull service delivery CSV |
| `RELIEFWEB_APPNAME` | *(none)* | Set to `whoafro-dashboard-a9z2` for direct API access |
| `DASHBOARD_CACHE_TTL_SECONDS` | `300` | API response cache lifetime |

---

## API Endpoints

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Health check: returns `{"ok": true}` |
| `GET /api/dashboard-data` | Full aggregated dashboard payload |
| `GET /api/country-feed/status` | Service delivery data freshness |
| `POST /api/country-feed` | Ingest service delivery CSV or JSON |

---

## Pages

Strategic view (verified sources only):

1. **Overview**: six headline KPIs for the 13 FCV countries (humanitarian classification, health people in need, health reach, health funding gap, displaced people, attacks on health care), monthly strategic messages, map, health funding against plan, FCV country scorecard, plan coverage and MHPSS.
2. **Crisis Classification**: WHO grading register (entered by DHM) and the DHM rule-based humanitarian classification with points per criterion.
3. **FCV Response**: service delivery from the FCV service database, with implausible values excluded at ingest.
4. **Country Profiles**: strategic country card plus the existing country brief.

Risk monitoring: Conflict & Displacement (verified IDP and refugee figures on top), Attacks on Health Care (WHO SSA figures on top), Food Security, Nutrition, Hazards & Floods, Cyclone Watch, Climate Forecasts.

Outputs and data: Operational Bulletin, Event Signals (the former overview of public-signal counts, for monitoring only) and Data Health (source status, values excluded at ingest, validation ledger).

---

## Strategic data sources

| File / endpoint | Source | Maintained by |
| --- | --- | --- |
| `data/strategic-cache.json` | OCHA HDX HAPI (needs, appeals, IOM DTM IDPs, UNHCR refugees, IPC, INFORM Risk), OCHA FTS (health cluster funding), OCHA Response Monitoring/HPC (Health Cluster people in need, targeted and reached per plan), WHO SSA | Server every 12 hours, and the GitHub refresh job (`scripts/refresh-strategic.js`) |
| `data/strategic-history.json` | Monthly KPI snapshots (one per month) used for the "since last month" arrows | Server and the GitHub refresh job; do not edit by hand |
| `data/who-grading.csv` | WHO grading decisions | DHM (one row per graded event) |
| `data/fcv-reference.json` | FCV country list and tracks | DHM |
| `FCV-Services-Deliveries-Database.csv` | FCV service database | FCV data focal point |
| `GET /api/strategic` | Strategic payload used by the Overview | Server |
| `POST /api/strategic/refresh` | Forces a refresh (header `x-refresh-token`) | Admin |

Rules worth knowing:

- Health people in need for the current year comes from the current OCHA plan in HPC (it reflects mid-year revisions), then HDX HAPI, then the FCV profile workbook.
- A country with no current plan keeps its last annual plan's health figure for the triage tier for up to 24 months after the plan ended (a flash appeal's figure stops counting when the appeal ends). The tier is shown as provisional and the figure is never added to regional totals.
- Last year's annual plan carries over until this year's plan is published, from either OCHA source. Where HDX HAPI holds a different figure for a revised plan, it is kept for reference in the tooltip.
- Health reach uses OCHA Response Monitoring. Until the current year is published, the card shows the latest full-year result and lists plans whose reporting stopped early. A reach below 1% or above 150% of the target is treated as a reporting error.
- Month-on-month arrows compare with the last snapshot of the previous month. Year-on-year arrows compare with the previous plan (health need) or the same period last year (attacks).

Strategic environment variables: `HDX_HAPI_APP_IDENTIFIER` (base64 of `app-name:contact-email`, set this on Render), `STRATEGIC_REFRESH_HOURS` (default 12), `STRATEGIC_REFRESH_ENABLED` (`on`/`off`), `STRATEGIC_REFRESH_TOKEN`, `STRATEGIC_HISTORY_URL` (where the server pulls committed snapshots from; `off` to disable), `HDX_WASTING_PROXY_AS_LATEST` (default `off`). For the GitHub refresh job, add the same `HDX_HAPI_APP_IDENTIFIER` as a repository secret.

The pre-overhaul version is kept as git tag `v1.0-pre-overhaul` and branch `backup/v1-2026-10-27`.
