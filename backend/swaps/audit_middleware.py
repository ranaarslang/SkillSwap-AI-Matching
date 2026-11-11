"""Audit middleware (round 4): one AuditLog row per successful mutating
/api/admin/* request by a staff user. It is the single audit mechanism,
so no admin view has to remember to log itself — including the
pre-round-4 actions (activate/deactivate, password reset, trust
override, verified toggle, session cancel, review/message delete,
message approve/reject). GETs, failed requests (non-2xx) and non-staff
requests are never logged. The middleware never raises: the audit trail
must not break the request it records.
"""
import json
import re

_PATTERNS = [
    # (path regex, action, target_type)
    (r"^/api/admin/users/(?P<id>\d+)/toggle-active/$", "user.toggle_active", "user"),
    (r"^/api/admin/users/(?P<id>\d+)/toggle-verified/$", "user.toggle_verified", "user"),
    (r"^/api/admin/users/(?P<id>\d+)/reset-password/$", "user.reset_password", "user"),
    (r"^/api/admin/users/(?P<id>\d+)/set-trust/$", "user.set_trust", "user"),
    (r"^/api/admin/sessions/(?P<id>\d+)/cancel/$", "session.cancel", "session"),
    (r"^/api/admin/reviews/(?P<id>\d+)/$", "review.delete", "review"),
    (r"^/api/admin/messages/(?P<id>\d+)/$", "message.delete", "message"),
    (r"^/api/admin/message-approvals/(?P<id>\d+)/approve/$", "message.approve", "message"),
    (r"^/api/admin/message-approvals/(?P<id>\d+)/reject/$", "message.reject", "message"),
    (r"^/api/admin/reports/(?P<id>\d+)/resolve/$", "report.resolve", "report"),
    (r"^/api/admin/skills/$", "skill.add", "skill"),
    (r"^/api/admin/skills/(?P<id>\d+)/$", "skill.rename_or_remove", "skill"),
    (r"^/api/admin/announcements/$", "announcement.create", "announcement"),
    (r"^/api/admin/announcements/(?P<id>\d+)/$", "announcement.delete", "announcement"),
]


def _target_label(target_type, target_id):
    """A human label for the audit row; never raises."""
    try:
        from django.contrib.auth import get_user_model

        if target_type == "user":
            u = get_user_model().objects.filter(id=target_id).first()
            return u.username if u else f"User #{target_id}"
        if target_type == "session":
            from .models import SwapSession

            s = SwapSession.objects.filter(id=target_id).select_related(
                "partner_one", "partner_two").first()
            return (f"Session #{target_id} ({s.partner_one.username} ↔ "
                    f"{s.partner_two.username})" if s else f"Session #{target_id}")
        if target_type == "review":
            from .models import IntegrityReview

            r = IntegrityReview.objects.filter(id=target_id).select_related(
                "author_user", "target_user").first()
            return (f"Review #{target_id} ({r.author_user.username} → "
                    f"{r.target_user.username})" if r else f"Review #{target_id}")
        if target_type == "message":
            from .models import ChatMessage

            m = ChatMessage.objects.filter(id=target_id).select_related(
                "sender", "recipient").first()
            return (f"Message #{target_id} ({m.sender.username} → "
                    f"{m.recipient.username})" if m else f"Message #{target_id}")
        if target_type == "report":
            from .models import UserReport

            r = UserReport.objects.filter(id=target_id).select_related(
                "reporter", "reported_user").first()
            return (f"Report #{target_id} ({r.reporter.username} → "
                    f"{r.reported_user.username})" if r else f"Report #{target_id}")
        if target_type == "skill":
            from .models import SkillCatalog

            s = SkillCatalog.objects.filter(id=target_id).first()
            return s.name if s else f"Skill #{target_id}"
        if target_type == "announcement":
            from .models import Announcement

            a = Announcement.objects.filter(id=target_id).first()
            return a.title if a else f"Announcement #{target_id}"
    except Exception:
        pass
    return f"{target_type} #{target_id}" if target_id else target_type


class AuditLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        self._maybe_log(request, response)
        return response

    def _maybe_log(self, request, response):
        try:
            if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
                return
            if not request.path.startswith("/api/admin/"):
                return
            if not (request.user.is_authenticated and request.user.is_staff):
                return
            if not (200 <= response.status_code < 300):
                return
            for pattern, action, target_type in _PATTERNS:
                m = re.match(pattern, request.path)
                if not m:
                    continue
                target_id = m.groupdict().get("id")
                target_id = int(target_id) if target_id else None
                if action == "skill.rename_or_remove":
                    action = ("skill.remove" if request.method == "DELETE"
                              else "skill.rename")
                # Detail: pull the meaningful payload from the request
                # body / response, so the audit row says what actually
                # happened (resolution action + note, trust value, …).
                data = {}
                try:
                    if getattr(response, "content", None):
                        data = json.loads(response.content.decode("utf-8"))
                except Exception:
                    data = {}
                if not isinstance(data, dict):
                    data = {}
                body = {}
                try:
                    if getattr(request, "body", None):
                        body = json.loads(request.body.decode("utf-8"))
                except Exception:
                    body = {}
                if not isinstance(body, dict):
                    body = {}
                detail = ""
                if action == "report.resolve":
                    detail = f"{body.get('action', '')}: {body.get('note', '')}".strip(": ").strip()
                elif action == "user.set_trust":
                    detail = f"trust_score={body.get('trust_score')}"
                elif action == "user.reset_password":
                    detail = ("temporary password generated" if data.get("generated")
                              else "password set as supplied")
                elif action == "skill.add":
                    detail = str(data.get("name") or "")[:100]
                label = (data.get("label") or data.get("name")
                         or data.get("title")
                         or _target_label(target_type, target_id))
                if action == "skill.add" and detail:
                    label = detail
                from .models import AuditLog

                AuditLog.objects.create(
                    admin=request.user, action=action, target_type=target_type,
                    target_id=target_id,
                    target_label=str(label)[:200], detail=detail[:300],
                )
                return
        except Exception:
            return
