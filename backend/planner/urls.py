from django.urls import path

from . import views

urlpatterns = [
    path("health", views.HealthView.as_view()),
    path("rules", views.RulesView.as_view()),
    path("geocode", views.GeocodeView.as_view()),
    path("reverse", views.ReverseGeocodeView.as_view()),
    path("timezone", views.TimezoneView.as_view()),
    path("plan", views.PlanView.as_view()),
    path("heatmap", views.HeatmapView.as_view()),
]
