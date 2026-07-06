# Nifty Probability Terminal

A full-stack research application that estimates the calibrated probability that the Nifty 50 closes higher on its next trading session. It combines a resilient market-data pipeline, auditable feature timestamps, walk-forward model validation, a versioned deployment gate, and a responsive financial dashboard.

This is intentionally a probability terminal—not a deterministic “buy/sell” oracle. Every output carries data-quality, completeness, calibration, regime, and expected-range context.

## What is implemented

- Responsive React/TypeScript terminal with overview, institutional flows, derivatives, options range calculator, backtest, calibration, model registry, and admin pages.
- FastAPI API with SQLAlchemy persistence for daily markets, FII/DII cash flows, participant OI, options EOD, model versions, predictions, backtests, quality logs, and event flags.
- Internet ingestion through Yahoo's chart endpoint for Nifty, India VIX, major global indices, USD/INR, DXY, Brent, and the US 10-year yield.
- Three-attempt exponential retry, disk cache, stale-cache fallback, per-source provenance, and visible degradation instead of silent zero filling.
- Manual CSV fallback with aliases, validation, preview response, upsert semantics, and `manual_upload` provenance.
- Price, volatility, VIX, flow, trend, momentum, range, breakout, and calendar feature engineering.
- Calibrated logistic classification plus Ridge next-day-return regression, with all imputing/scaling fitted inside training pipelines.
- Expanding-window walk-forward backtest, probability buckets, Brier/log-loss, threshold analysis, transaction costs, and an equity curve.
- Model registry, artifact versioning, deployment gates, explicit force override, current/candidate/retired state, and rollback-capable records.
- Weekday post-close data/prediction schedule and weekly candidate retraining schedule.
- Docker Compose stack, GitHub Actions CI, backend tests, and a frontend smoke test.

## Architecture

```text
Market sources / CSVs
        │
        ▼
retry → cache → validation → SQL database → timestamp-safe feature frame
                                                │
                         expanding walk-forward ├─ calibrated classifier
                                                └─ return regressor
                                                        │
                              model registry + gates → deployed artifact
                                                        │
                                  FastAPI JSON API → React terminal
```

PostgreSQL is used in Docker/production. Local Python runs default to SQLite to keep first-run setup light.

## Quick start on Windows (no Docker or WSL)

Only Python 3.11 or newer is required. Download it from [python.org](https://www.python.org/downloads/) and select **Add Python to PATH** during installation.

1. Download or clone this repository.
2. Double-click `run.bat`, or run it from PowerShell:

   ```powershell
   .\run.bat
   ```

3. The first launch creates an isolated Python environment and installs the required packages. Later launches start immediately.
4. The dashboard opens automatically at `http://127.0.0.1:8000`.
5. Open **Admin**, enter `change-me`, then run **Fetch market data**, **Train candidate**, and **Deploy latest eligible**.

Keep the launcher window open while using the app. Press `Ctrl+C` to stop it. The database, downloaded data, and trained models remain on your computer for the next launch. The first 12-year refresh and training run can take several minutes.

To choose a private admin key, edit `backend/.env` after the first run and replace `ADMIN_API_KEY=change-me`.

## Optional Docker setup

Docker is not needed for normal local use. It remains available for server deployment or users who prefer PostgreSQL:

```bash
docker compose up --build
```

The Docker dashboard runs at `http://localhost:3000`; API documentation is at `http://localhost:8000/docs`.

## Developer setup

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_URL=http://localhost:8000` when the frontend and API have different origins.

## Pipeline workflow

```bash
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:8000/api/admin/fetch-data
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" http://localhost:8000/api/admin/retrain-model
curl -X POST -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" \
  -d '{"model_version":"v2026.07.07.120000"}' http://localhost:8000/api/admin/deploy-model
```

A model is automatically eligible only when it beats the majority baseline, has Brier score below 0.25, and has at least 252 out-of-sample observations. `force=true` exists for an intentional, authenticated override; it is never applied automatically.

## CSV fallback

`POST /api/admin/upload-csv?dataset=<type>` accepts multipart field `file`. Supported core types:

- `nifty` and `india_vix`: `date, open, high, low, close` plus optional `volume, prev_close`.
- `fii_dii`: `date, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net`.
- `participant_oi`: date, participant and index futures/call/put long and short quantities.
- `options`: date, expiry, strike, spot and CE/PE OI, change, volume, IV, and LTP fields.
- `breadth`: date, advances, declines, unchanged, with optional moving-average breadth and highs/lows.
- `global` and `macro`: the OHLC fields above plus `symbol`.

Column names are normalized to lowercase snake case. A successful response contains the mapped columns and five-row preview. Invalid data is rejected before insertion.

## API

Public reads:

- `GET /api/health`
- `GET /api/latest-prediction`
- `GET /api/predictions/history`
- `GET /api/data-status`
- `GET /api/fii-dii/latest` and `/history`
- `GET /api/fno/latest`
- `GET /api/options/latest`
- `GET /api/backtest/latest` and `/model/{version}`
- `GET /api/calibration/latest`
- `GET /api/models`

Authenticated writes require `X-Admin-Key`: fetch, retrain, deploy, run prediction, upload CSV, and add event flag.

## Testing

```bash
cd backend && pytest --cov=app
cd frontend && npm test && npm run build
```

Tests cover source parsing with mocked internet responses, feature invariants, no-look-ahead rejection, walk-forward evaluation, signal thresholds, endpoint behavior, and privileged endpoint authentication.

## Production deployment

- Build the backend image on Render, Railway, Fly.io, ECS, Cloud Run, or Kubernetes and attach managed PostgreSQL plus durable artifact storage.
- Build the frontend image or deploy `frontend` to Vercel/Netlify with `VITE_API_URL` pointing to the API.
- Use a single scheduler leader in horizontally scaled deployments. For multiple API replicas, move scheduled work to a dedicated worker/managed cron.
- Store the admin key and database credentials in the platform secret store. Terminate TLS at the load balancer.
- Preserve `/app/artifacts` and `/app/data/cache`, or replace artifacts with S3/GCS and cache with managed object storage.
- Add an exchange holiday calendar and alert transport before unattended trading-day operation.

See [Data Sources](docs/DATA_SOURCES.md), [Modeling](docs/MODELING.md), [Backtesting](docs/BACKTESTING.md), and [Deployment](docs/DEPLOYMENT.md).

## Known limitations

- Yahoo Finance is an unofficial convenience source and can change or impose limits. Official/licensed feeds are recommended for production trading decisions.
- Historical FII/DII, participant OI, options-chain, breadth, GIFT Nifty, and event data often lack stable, license-clear public APIs. These are never fabricated; the terminal exposes manual EOD imports and degrades confidence when they are absent.
- The next-weekday helper does not by itself know exchange holidays. Add the NSE holiday calendar in a production deployment.
- Feature attribution uses deterministic one-feature perturbation. It is directional context, not a causal explanation.
- Model eligibility is a minimum safety gate, not proof of economic value or future performance.

## Legal and risk notice

This software is for research and education only and is not investment advice. Predictions are uncertain. Past performance does not ensure future performance. Exchange and institutional data may be delayed, revised, or unavailable. High probability does not automatically mean a profitable trade; transaction costs, slippage, liquidity, and independent risk controls matter.
