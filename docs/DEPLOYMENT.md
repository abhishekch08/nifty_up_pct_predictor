# Deployment

## Recommended topology

- Static frontend on Vercel/Netlify or the included Nginx container.
- FastAPI container behind TLS on Render, Railway, Fly.io, Cloud Run, ECS or Kubernetes.
- Managed PostgreSQL with point-in-time recovery.
- Persistent encrypted object storage for joblib artifacts and raw-source cache.
- Exactly one scheduler worker; API replicas should run with `SCHEDULER_ENABLED=false`.

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

