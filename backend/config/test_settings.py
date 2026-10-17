"""Settings for the test suite: no network-shared state, no throttling."""

import os

os.environ.setdefault("SECRET_KEY", "test-only-secret")

from .settings import *  # noqa: E402,F403

CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "tests"}}
REST_FRAMEWORK = {**REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}  # noqa: F405
