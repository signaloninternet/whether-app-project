# One image serves both the API and the built React app (WhiteNoise), so it
# deploys as a single web service on Render, Railway, Fly.io or any Docker host.

FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    FRONTEND_DIST=/app/frontend/dist \
    CACHE_DIR=/tmp/routecast-cache
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/frontend/dist /app/frontend/dist
# Pre-compress assets so WhiteNoise can serve .br/.gz without doing it per request.
RUN python -m whitenoise.compress /app/frontend/dist \
    && useradd --create-home --uid 10001 app
USER app
EXPOSE 8000
# Long-haul plans fan out to several routing requests, hence the generous timeout.
CMD ["sh", "-c", "exec gunicorn config.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers ${WEB_CONCURRENCY:-2} --threads 4 --timeout 120 --access-logfile -"]
