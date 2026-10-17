from django.conf import settings
from django.http import FileResponse, Http404, JsonResponse
from django.urls import include, path, re_path
from django.views.decorators.cache import never_cache


@never_cache
def spa(request, *args):
    """Serve the React app for client-side routes; built assets come from WhiteNoise."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.exists():
        raise Http404("Frontend not built. Run `npm run build` in frontend/ or use the Vite dev server.")
    return FileResponse(index.open("rb"), content_type="text/html")


def api_not_found(request, *args):
    return JsonResponse({"error": {"code": "not_found", "message": "No such API endpoint."}}, status=404)


urlpatterns = [
    path("api/", include("planner.urls")),
    re_path(r"^api/", api_not_found),
    # Anything else is a client-side route, except missing build files, which must 404
    # rather than return HTML to a <script> tag.
    re_path(r"^(?!assets/|static/).*$", spa),
]
