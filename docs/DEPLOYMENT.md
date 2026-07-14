# Deployment

## Recommended topology

- Static frontend on Vercel/Netlify or the included Nginx container.
- FastAPI container behind TLS on Render, Railway, Fly.io, Cloud Run, ECS or Kubernetes.
- Managed PostgreSQL with point-in-time recovery.
- Persistent encrypted object storage for joblib artifacts and raw-source cache.
- Exactly one scheduler worker; API replicas should run with `SCHEDULER_ENABLED=false`.

## Render free Blueprint

This repository includes `render.yaml` for a one-service Render deployment on the free web-service plan. The FastAPI backend serves both the API and the checked-in production frontend bundle, so no separate static-site service is required.

Render settings are intentionally simple:

- Root directory: `backend`
- Build command: `pip install --upgrade pip && pip install -r requirements.txt`
- Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health check: `/api/health`
- Plan: `free`

The checked-in `backend/data/nifty.db` and deployed model artifact seed the public website with a working model on first boot. On Render's free tier, runtime filesystem writes are not durable across redeploys/restarts. For production-grade persistence, upgrade to a persistent disk or PostgreSQL and object storage for model artifacts.

To publish from the Render dashboard:

1. Open Render → **New** → **Blueprint**.
2. Connect `abhishekch08/nifty_up_pct_predictor`.
3. Select the Blueprint in `render.yaml`.
4. Keep the generated `ADMIN_API_KEY` private.
5. Deploy. The website will be available at the Render `.onrender.com` URL after the first build.

## Required secrets

- `DATABASE_URL`
- `ADMIN_API_KEY`
- `POSTGRES_PASSWORD` for the example Compose stack
- Future licensed vendor credentials, injected only into the backend

Never expose the admin key through `VITE_*` variables; Vite variables are compiled into public browser JavaScript.

## Release sequence

1. Run backend tests and the frontend test/build in CI.
2. Apply database migrations (Alembic is the recommended next hardening step; initial boot creates tables).
3. Deploy backend and check `/api/health`.
4. Deploy frontend with the backend origin.
5. Fetch sources and inspect `/api/data-status`.
6. Train a candidate, inspect walk-forward/calibration reports, and deploy only if gates and human review pass.
7. Create monitors for stale latest dates, pipeline failure, degraded completeness, feature drift, calibration drift, and scheduler liveness.

## Scaling and recovery

Joblib files are local in the reference implementation. In multi-instance production, store artifacts in versioned object storage and download by immutable checksum. Back up PostgreSQL and retain raw data snapshots so every model version can be reproduced. Rollback consists of marking a prior registry entry deployed and generating a new prediction with that artifact.
