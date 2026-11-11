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
    path("auth/change-password/", views.change_password, name="change_password"),
    # Profiles
    path("profile/me/", views.profile_me, name="profile_me"),
    path("profiles/<int:user_id>/", views.profile_detail, name="profile_detail"),
    path("users/search/", views.search_users, name="search_users"),
    # Matching / community
    path("matches/", views.matches, name="matches"),
    path("community/", views.community, name="community"),
    # Sessions
    path("sessions/", views.sessions, name="sessions"),
    path("sessions/<int:session_id>/", views.session_detail, name="session_detail"),
    # Messaging
    path("conversations/", views.conversations, name="conversations"),
    path("messages/", views.messages, name="messages"),
    path("messages/upload/", views.upload_message, name="upload_message"),
    path(
        "attachments/<int:attachment_id>/download/",
        views.download_attachment,
        name="download_attachment",
    ),
    # Reviews
    path("reviews/", views.reviews, name="reviews"),
    # Admin (staff only — IsAdminUser)
    path("admin/stats/", views.admin_stats, name="admin_stats"),
    path("admin/users/", views.admin_users, name="admin_users"),
    path("admin/users/<int:user_id>/", views.admin_user_detail, name="admin_user_detail"),
    path(
        "admin/users/<int:user_id>/toggle-active/",
        views.admin_toggle_user_active,
        name="admin_toggle_user_active",
    ),
    path(
        "admin/users/<int:user_id>/toggle-verified/",
        views.admin_toggle_verified,
        name="admin_toggle_verified",
    ),
    path(
        "admin/users/<int:user_id>/reset-password/",
        views.admin_reset_password,
        name="admin_reset_password",
    ),
    path(
        "admin/users/<int:user_id>/set-trust/",
        views.admin_set_trust,
        name="admin_set_trust",
    ),
    path("admin/sessions/", views.admin_sessions, name="admin_sessions"),
    path(
        "admin/sessions/<int:session_id>/cancel/",
        views.admin_cancel_session,
        name="admin_cancel_session",
    ),
    path("admin/reviews/", views.admin_reviews, name="admin_reviews"),
    path(
        "admin/reviews/<int:review_id>/",
        views.admin_delete_review,
        name="admin_delete_review",
    ),
    path(
        "admin/messages/<int:message_id>/",
        views.admin_delete_message,
        name="admin_delete_message",
    ),
    # Round 3c: Message Approvals queue (privacy filter).
    path(
        "admin/message-approvals/",
        views.admin_message_approvals,
        name="admin_message_approvals",
    ),
    path(
        "admin/message-approvals/<int:message_id>/approve/",
        views.admin_approve_message,
        name="admin_approve_message",
    ),
    path(
        "admin/message-approvals/<int:message_id>/reject/",
        views.admin_reject_message,
        name="admin_reject_message",
    ),
]
