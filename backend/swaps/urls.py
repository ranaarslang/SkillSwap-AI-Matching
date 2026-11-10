from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    # Health (no auth)
    path("health/", views.health, name="health"),
    # Auth (JWT)
    path("auth/signup/", views.signup, name="signup"),
    path("auth/login/", views.login, name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/logout/", views.logout, name="logout"),
    # Profiles
    path("profile/me/", views.profile_me, name="profile_me"),
    path("profiles/<int:user_id>/", views.profile_detail, name="profile_detail"),
    # Matching / community
    path("matches/", views.matches, name="matches"),
    path("community/", views.community, name="community"),
    # Sessions
    path("sessions/", views.sessions, name="sessions"),
    path("sessions/<int:session_id>/", views.session_detail, name="session_detail"),
    # Messaging
    path("conversations/", views.conversations, name="conversations"),
    path("messages/", views.messages, name="messages"),
    # Reviews
    path("reviews/", views.reviews, name="reviews"),
]
