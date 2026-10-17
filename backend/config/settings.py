"""Django settings for the weather-aware truck routing API.

Everything deploy-specific comes from environment variables so the same code
runs locally (``DEBUG=1``) and in a container behind gunicorn.
"""

import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = env_bool("DEBUG", False)
SECRET_KEY = os.environ.get("SECRET_KEY") or ("dev-insecure-key" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY must be set when DEBUG is off")

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1,0.0.0.0" if DEBUG else "")
if render_host := os.environ.get("RENDER_EXTERNAL_HOSTNAME"):
    ALLOWED_HOSTS.append(render_host)
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")

INSTALLED_APPS = [
    "corsheaders",
    "rest_framework",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.gzip.GZipMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

# The built React app (frontend/dist) is served by WhiteNoise from the site
# root, and index.html is returned for client-side routes (see config/urls.py).
FRONTEND_DIST = Path(os.environ.get("FRONTEND_DIST", REPO_DIR / "frontend" / "dist"))

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": False,
        "OPTIONS": {"context_processors": []},
    }
]

# The app keeps no relational state; SQLite only satisfies Django's checks.
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.environ.get("SQLITE_PATH", BASE_DIR / "db.sqlite3"),
    }
}

# File-based so every gunicorn worker shares forecasts, plans and throttle
# counters (a per-process LocMem cache would multiply upstream calls).
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.filebased.FileBasedCache",
        "LOCATION": os.environ.get("CACHE_DIR", "/tmp/routecast-cache"),
        "TIMEOUT": 20 * 60,
        "OPTIONS": {"MAX_ENTRIES": 20_000},
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = None  # no Django static files; WhiteNoise serves the frontend build instead
WHITENOISE_ROOT = FRONTEND_DIST if FRONTEND_DIST.exists() else None
WHITENOISE_INDEX_FILE = True
WHITENOISE_MAX_AGE = 3600
_VITE_HASHED_ASSET = re.compile(r"^/assets/.+-[\w-]{8,}\.\w+$")


def WHITENOISE_IMMUTABLE_FILE_TEST(path: str, url: str) -> bool:
    """Vite fingerprints everything under /assets/, so those can be cached forever."""
    return bool(_VITE_HASHED_ASSET.match(url))


DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_ALL_ORIGINS = DEBUG and not CORS_ALLOWED_ORIGINS

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True

REST_FRAMEWORK = {
    # Anonymous, read-mostly API: no sessions, so no CSRF on JSON POSTs.
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": [],
    "UNAUTHENTICATED_USER": None,
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "plan": os.environ.get("THROTTLE_PLAN", "20/min"),
        "heatmap": os.environ.get("THROTTLE_HEATMAP", "20/min"),
        "geocode": os.environ.get("THROTTLE_GEOCODE", "120/min"),
    },
    "EXCEPTION_HANDLER": "planner.api_errors.exception_handler",
}

# --- Third-party services (all keyless by default) ---------------------------
ROUTING = {
    # Public FOSSGIS Valhalla: real truck costing (weight, height, hgv=no).
    # It rejects routes whose straight-line length exceeds VALHALLA_MAX_KM;
    # longer trips fall back to OSRM (see planner/services/routing).
    "VALHALLA_URL": os.environ.get("VALHALLA_URL", "https://valhalla1.openstreetmap.de"),
    "VALHALLA_API_KEY": os.environ.get("VALHALLA_API_KEY", ""),
    "VALHALLA_MAX_KM": float(os.environ.get("VALHALLA_MAX_KM", "1495")),
    "OSRM_URL": os.environ.get("OSRM_URL", "https://router.project-osrm.org"),
    "TIMEOUT_S": float(os.environ.get("ROUTING_TIMEOUT_S", "25")),
}
GEOCODING = {
    "PHOTON_URL": os.environ.get("PHOTON_URL", "https://photon.komoot.io"),
    "TIMEOUT_S": float(os.environ.get("GEOCODING_TIMEOUT_S", "8")),
}
WEATHER = {
    "OPEN_METEO_URL": os.environ.get("OPEN_METEO_URL", "https://api.open-meteo.com"),
    # A commercial key switches to customer-api.open-meteo.com automatically.
    "OPEN_METEO_API_KEY": os.environ.get("OPEN_METEO_API_KEY", ""),
    "TIMEOUT_S": float(os.environ.get("WEATHER_TIMEOUT_S", "30")),
    "MAX_CHECKPOINT_LOCATIONS": int(os.environ.get("MAX_CHECKPOINT_LOCATIONS", "150")),
    "MAX_HEATMAP_CELLS": int(os.environ.get("MAX_HEATMAP_CELLS", "120")),
    # Development aid only (planner/services/storm_sim.py); ignored unless DEBUG is on.
    "SIMULATE_STORM": DEBUG and env_bool("SIMULATE_STORM", False),
}
TRUCK = {
    # Valhalla's truck costing wants gross vehicle weight; the user enters the
    # load, so we add a typical tractor + 53' trailer tare weight.
    "TARE_WEIGHT_LB": int(os.environ.get("TRUCK_TARE_WEIGHT_LB", "35000")),
    "MAX_SPEED_MPH": float(os.environ.get("TRUCK_MAX_SPEED_MPH", "65")),
}
# Public routing/geocoding services ask clients to identify themselves; set a
# contact URL or email here for a production deployment.
HTTP_USER_AGENT = os.environ.get("HTTP_USER_AGENT", "routecast/1.0 (weather-aware truck routing)")

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "INFO")},
}
