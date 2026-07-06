.PHONY: dev test build fetch train
dev:
	docker compose up --build
test:
	cd backend && pytest -q
	cd frontend && npm test
build:
	docker compose build
fetch:
	curl -X POST -H "X-Admin-Key: $${ADMIN_API_KEY}" http://localhost:8000/api/admin/fetch-data
train:
	curl -X POST -H "X-Admin-Key: $${ADMIN_API_KEY}" http://localhost:8000/api/admin/retrain-model

