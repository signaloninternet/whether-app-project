PYTHON ?= python3.12

.PHONY: setup backend frontend test docker

setup:  ## install backend (venv) and frontend dependencies
	cd backend && $(PYTHON) -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci

backend:  ## API on http://127.0.0.1:8000
	cd backend && DEBUG=1 .venv/bin/python manage.py runserver 127.0.0.1:8000

frontend:  ## app on http://127.0.0.1:5173 (proxies /api to :8000)
	cd frontend && npm run dev

test:  ## backend + frontend tests and type checks
	cd backend && .venv/bin/pytest
	cd frontend && npm test && npm run typecheck

docker:  ## production image on http://127.0.0.1:8000
	docker build -t routecast .
	docker run --rm -p 8000:8000 -e SECRET_KEY=change-me -e ALLOWED_HOSTS=127.0.0.1,localhost routecast
