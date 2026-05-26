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

If port 3000 is stuck from a previous run, use `start-local.bat` — it clears the port first.

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
| `GET /api/health` | Health check — returns `{"ok": true}` |
| `GET /api/dashboard-data` | Full aggregated dashboard payload |
| `GET /api/country-feed/status` | Service delivery data freshness |
| `POST /api/country-feed` | Ingest service delivery CSV or JSON |

---

## Pages

1. **Overview** — Risk map, top alerts, country comparison table
2. **Food Security** — IPC phase analysis by country
3. **Nutrition** — Acute malnutrition indicators (HDX)
4. **Conflicts & Displacements** — ACLED conflict index, displacement signals
5. **Hazard Monitor** — GDACS flood and hazard events
6. **Cyclone Watch** — Active cyclone signals (Meteo-France, WMO)
7. **Forecast Studio** — ICPAC weekly/monthly/seasonal bulletins
8. **Country Profiles** — Per-country humanitarian response brief
9. **Operational Report** — Auto-generated situation bulletin for briefings
