"""Round 4 admin-panel features (user-approved 2026-11-11): user reports,
skill catalog management, analytics, announcements, audit log, CSV export.

Kept in its own module so the main views.py (edited by the round-3f fix
in parallel) is untouched. All /api/admin/* endpoints are staff-only
(IsAdminUser); the audit middleware logs every successful mutating
admin request, including the pre-round-4 actions.
"""
import csv
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from .models import (
    Announcement,
    AuditLog,
    ChatMessage,
    IntegrityReview,
    Profile,
    SkillCatalog,
    SwapSession,
    UserReport,
    UserSkill,
)
from .serializers import UserMiniSerializer

User = get_user_model()


def _user_mini(user):
    return UserMiniSerializer(user).data if user else None


# ------------------------------------------------------------------ catalog
# The SkillPicker reads this from the backend (AllowAny — it is used on
# the unauthenticated signup screen). Falls back to the hardcoded list
# in the frontend when the request fails.
@api_view(["GET"])
@permission_classes([AllowAny])
def skill_catalog(request):
    groups = {}
    order = []
    for s in SkillCatalog.objects.filter(is_active=True).order_by("id"):
        if s.group not in groups:
            groups[s.group] = []
            order.append(s.group)
        groups[s.group].append({"id": s.id, "name": s.name})
    return Response([{"label": g, "skills": groups[g]} for g in order])


# ------------------------------------------------------------------ reports
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_report(request):
    """A student reports another user. Reason is required; details are
    free text. The admin sees it in the Reports queue."""
    reported_id = request.data.get("reported_user_id")
    reason = (request.data.get("reason") or "").strip()
    details = (request.data.get("details") or "").strip()
    valid_reasons = {c for c, _ in UserReport.Reason.choices}
    if reason not in valid_reasons:
        return Response(
            {"detail": f"reason must be one of: {', '.join(sorted(valid_reasons))}."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    try:
        reported = User.objects.get(id=reported_id)
    except (User.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Reported user not found."}, status=404)
    if reported.id == request.user.id:
        return Response(
            {"detail": "You cannot report yourself."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(details) > 2000:
        return Response(
            {"detail": "Details must be at most 2000 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    report = UserReport.objects.create(
        reporter=request.user, reported_user=reported,
        reason=reason, details=details,
    )
    return Response(_report_data(report), status=status.HTTP_201_CREATED)


def _report_data(r):
    return {
        "id": r.id,
        "reporter": _user_mini(r.reporter),
        "reported_user": _user_mini(r.reported_user),
        "reason": r.reason,
        "reason_label": r.get_reason_display(),
        "details": r.details,
        "status": r.status,
        "action_taken": r.action_taken,
        "resolution_note": r.resolution_note,
        "resolved_by": _user_mini(r.resolved_by),
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
        "created_at": r.created_at.isoformat(),
    }


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_reports(request):
    status_filter = (request.query_params.get("status") or "").strip().lower()
    qs = UserReport.objects.all().select_related(
        "reporter", "reported_user", "resolved_by"
    )
    if status_filter in ("open", "resolved"):
        qs = qs.filter(status=status_filter)
    return Response([_report_data(r) for r in qs])


@api_view(["POST"])
@permission_classes([IsAdminUser])
def admin_resolve_report(request, report_id):
    """Resolve a report: dismiss it, warn (note only), or deactivate the
    reported user. The resolution is stored on the report."""
    try:
        report = UserReport.objects.get(id=report_id)
    except (UserReport.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Report not found."}, status=404)
    if report.status != UserReport.Status.OPEN:
        return Response(
            {"detail": "This report has already been resolved."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    action = (request.data.get("action") or "").strip()
    note = (request.data.get("note") or "").strip()
    if action == "dismiss":
        action_taken = UserReport.Action.DISMISSED
    elif action == "warn":
        action_taken = UserReport.Action.WARNED
    elif action == "deactivate":
        if report.reported_user.id == request.user.id:
            return Response(
                {"detail": "You cannot deactivate your own admin account."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        report.reported_user.is_active = False
        report.reported_user.save(update_fields=["is_active"])
        action_taken = UserReport.Action.DEACTIVATED
    else:
        return Response(
            {"detail": "action must be one of: dismiss, warn, deactivate."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    report.status = UserReport.Status.RESOLVED
    report.action_taken = action_taken
    report.resolution_note = note
    report.resolved_by = request.user
    report.resolved_at = timezone.now()
    report.save()
    # The audit middleware records this resolution (action + note).
    return Response(_report_data(report))


# ------------------------------------------------------------------- skills
def _skill_data(s):
    return {
        "id": s.id, "name": s.name, "group": s.group,
        "is_active": s.is_active,
        "created_at": s.created_at.isoformat(),
    }


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def admin_skills(request):
    if request.method == "GET":
        return Response([
            _skill_data(s) for s in SkillCatalog.objects.all().order_by("id")
        ])
    name = (request.data.get("name") or "").strip()
    group = (request.data.get("group") or "").strip() or "General"
    if not name:
        return Response(
            {"detail": "name is required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(name) > 120 or len(group) > 80:
        return Response(
            {"detail": "name must be at most 120 characters, group at most 80."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    existing = SkillCatalog.objects.filter(name__iexact=name).first()
    if existing:
        if existing.is_active:
            return Response(
                {"detail": f'"{existing.name}" is already in the catalog.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Re-adding a soft-removed skill: reactivate it (keeps its id).
        existing.is_active = True
        existing.group = group
        existing.save(update_fields=["is_active", "group"])
        return Response(_skill_data(existing))
    skill = SkillCatalog.objects.create(name=name, group=group)
    return Response(_skill_data(skill), status=status.HTTP_201_CREATED)


@api_view(["PUT", "DELETE"])
@permission_classes([IsAdminUser])
def admin_skill_detail(request, skill_id):
    try:
        skill = SkillCatalog.objects.get(id=skill_id)
    except (SkillCatalog.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Skill not found."}, status=404)
    if request.method == "DELETE":
        # Soft remove: the picker stops offering it, but users who
        # already picked it keep their USER_SKILL rows.
        skill.is_active = False
        skill.save(update_fields=["is_active"])
        return Response({"detail": f'"{skill.name}" removed from the catalog.',
                         "label": skill.name})
    name = (request.data.get("name") or "").strip()
    group = (request.data.get("group") or "").strip()
    if name:
        if len(name) > 120:
            return Response(
                {"detail": "name must be at most 120 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        clash = SkillCatalog.objects.filter(
            name__iexact=name, is_active=True
        ).exclude(id=skill.id).first()
        if clash:
            return Response(
                {"detail": f'"{clash.name}" is already in the catalog.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        skill.name = name
    if group:
        if len(group) > 80:
            return Response(
                {"detail": "group must be at most 80 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        skill.group = group
    skill.save()
    return Response(_skill_data(skill))


# ---------------------------------------------------------------- analytics
def _week_starts(count=12):
    """Monday-start dates for the last `count` weeks, oldest first."""
    today = timezone.now().date()
    monday = today - timedelta(days=today.weekday())
    return [monday - timedelta(weeks=i) for i in range(count - 1, -1, -1)]


def _month_starts(count=6):
    """First-of-month dates for the last `count` months, oldest first."""
    today = timezone.now().date().replace(day=1)
    months = []
    y, m = today.year, today.month
    for _ in range(count):
        months.append(today.replace(year=y, month=m, day=1))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return list(reversed(months))


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_analytics(request):
    """Lightweight aggregates for the admin dashboard charts. All counts
    are computed from the existing tables — no new model needed."""
    weeks = _week_starts(12)
    users_per_week = []
    sessions_by_week = []
    for start in weeks:
        end = start + timedelta(days=7)
        users_per_week.append({
            "week": start.isoformat(),
            "count": User.objects.filter(
                date_joined__date__gte=start, date_joined__date__lt=end
            ).count(),
        })
        by_status = {}
        for code, _ in SwapSession.Status.choices:
            by_status[code.lower()] = SwapSession.objects.filter(
                created_at__date__gte=start, created_at__date__lt=end,
                session_status=code,
            ).count()
        sessions_by_week.append({"week": start.isoformat(), **by_status})
    months = _month_starts(6)
    users_per_month = []
    for i, start in enumerate(months):
        end = months[i + 1] if i + 1 < len(months) else start.replace(
            year=start.year + (1 if start.month == 12 else 0),
            month=1 if start.month == 12 else start.month + 1,
        )
        users_per_month.append({
            "month": start.strftime("%Y-%m"),
            "count": User.objects.filter(
                date_joined__date__gte=start, date_joined__date__lt=end
            ).count(),
        })
    total_sessions = SwapSession.objects.count()
    completed = SwapSession.objects.filter(
        session_status=SwapSession.Status.COMPLETED).count()
    cancelled = SwapSession.objects.filter(
        session_status=SwapSession.Status.CANCELLED).count()
    return Response({
        "users_per_week": users_per_week,
        "users_per_month": users_per_month,
        "sessions_by_week": sessions_by_week,
        # "Matches made" = sessions created (each session is a match the
        # two students acted on); completion rate over all sessions.
        "total_matches": total_sessions,
        "total_sessions": total_sessions,
        "sessions_completed": completed,
        "sessions_cancelled": cancelled,
        "completion_rate": round(100 * completed / total_sessions, 1)
        if total_sessions else 0.0,
        "total_messages": ChatMessage.objects.count(),
        "total_reviews": IntegrityReview.objects.count(),
    })


# ------------------------------------------------------------- announcements
def _announcement_data(a, viewer=None):
    return {
        "id": a.id,
        "title": a.title,
        "body": a.body,
        "created_by": _user_mini(a.created_by),
        "created_at": a.created_at.isoformat(),
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
        "is_active": a.is_active,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def announcements(request):
    """Active, unexpired announcements for all students (the dismissible
    banner). Staff see them here too; the admin list has its own view."""
    now = timezone.now()
    qs = Announcement.objects.filter(is_active=True).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    ).order_by("-created_at")
    return Response([_announcement_data(a) for a in qs])


@api_view(["GET", "POST"])
@permission_classes([IsAdminUser])
def admin_announcements(request):
    if request.method == "GET":
        qs = Announcement.objects.all().select_related(
            "created_by").order_by("-created_at")
        return Response([_announcement_data(a) for a in qs])
    title = (request.data.get("title") or "").strip()
    body = (request.data.get("body") or "").strip()
    if not title or not body:
        return Response(
            {"detail": "title and body are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(title) > 200:
        return Response(
            {"detail": "title must be at most 200 characters."},
            status=status.HTTP_400_BAD_REQUEST,
        )
    expires_raw = (request.data.get("expires_at") or "").strip()
    expires_at = None
    if expires_raw:
        expires_at = parse_datetime(expires_raw)
        if expires_at is None:
            day = parse_date(expires_raw)
            if day is not None:
                expires_at = timezone.datetime(
                    day.year, day.month, day.day, 23, 59, 59,
                    tzinfo=timezone.get_current_timezone(),
                )
        if expires_at is None:
            return Response(
                {"detail": "expires_at must be an ISO date or datetime."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    ann = Announcement.objects.create(
        title=title, body=body, created_by=request.user,
        expires_at=expires_at,
    )
    return Response(_announcement_data(ann), status=status.HTTP_201_CREATED)


@api_view(["DELETE"])
@permission_classes([IsAdminUser])
def admin_delete_announcement(request, announcement_id):
    try:
        ann = Announcement.objects.get(id=announcement_id)
    except (Announcement.DoesNotExist, ValueError, TypeError):
        return Response({"detail": "Announcement not found."}, status=404)
    title = ann.title
    ann.delete()
    return Response({"detail": f'Announcement "{title}" deleted.',
                     "label": title})


# ---------------------------------------------------------------- audit log
@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_audit_log(request):
    action = (request.query_params.get("action") or "").strip()
    q = (request.query_params.get("q") or "").strip()
    qs = AuditLog.objects.all().select_related("admin")
    if action:
        qs = qs.filter(action__icontains=action)
    if q:
        qs = qs.filter(
            Q(target_label__icontains=q)
            | Q(admin__username__icontains=q)
            | Q(detail__icontains=q)
        )
    qs = qs.order_by("-created_at")[:500]
    return Response([{
        "id": e.id,
        "admin": _user_mini(e.admin),
        "action": e.action,
        "target_type": e.target_type,
        "target_id": e.target_id,
        "target_label": e.target_label,
        "detail": e.detail,
        "created_at": e.created_at.isoformat(),
    } for e in qs])


# -------------------------------------------------------------------- export
def _csv_response(filename, header, rows):
    resp = HttpResponse(content_type="text/csv")
    resp["Content-Disposition"] = f'attachment; filename="{filename}"'
    writer = csv.writer(resp)
    writer.writerow(header)
    writer.writerows(rows)
    return resp


def _skills_of(user, skill_type):
    return "; ".join(
        UserSkill.objects.filter(user=user, skill_type=skill_type)
        .order_by("skill_name").values_list("skill_name", flat=True)
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_export_users(request):
    today = timezone.now().date().isoformat()
    rows = []
    for u in User.objects.all().order_by("id"):
        p = Profile.objects.filter(user=u).first()
        full_name = f"{u.first_name} {u.last_name}".strip() or u.username
        rows.append([
            u.id, u.username, full_name, u.email,
            u.date_joined.isoformat(), "yes" if u.is_active else "no",
            "yes" if u.is_staff else "no",
            p.country if p else "", p.location if p else "",
            p.trust_score if p else "",
            "yes" if (p and p.verified_badge) else "no",
            _skills_of(u, UserSkill.SkillType.TEACH),
            _skills_of(u, UserSkill.SkillType.LEARN),
        ])
    return _csv_response(
        f"skillswap-users-{today}.csv",
        ["id", "username", "full_name", "email", "date_joined", "is_active",
         "is_staff", "country", "city", "trust_score", "verified",
         "teach_skills", "learn_skills"],
        rows,
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_export_sessions(request):
    today = timezone.now().date().isoformat()
    rows = []
    for s in SwapSession.objects.all().order_by("id"):
        rows.append([
            s.id, s.partner_one.username, s.partner_two.username, s.title,
            s.calendar_date.isoformat(), s.duration_block, s.session_status,
            s.created_at.isoformat(),
        ])
    return _csv_response(
        f"skillswap-sessions-{today}.csv",
        ["id", "partner_one", "partner_two", "title", "calendar_date",
         "duration_block", "session_status", "created_at"],
        rows,
    )


@api_view(["GET"])
@permission_classes([IsAdminUser])
def admin_export_reviews(request):
    today = timezone.now().date().isoformat()
    rows = []
    for r in IntegrityReview.objects.all().order_by("id"):
        rows.append([
            r.id, r.session_id, r.author_user.username,
            r.target_user.username, r.rating_stars,
            r.feedback_text or "", r.created_at.isoformat(),
        ])
    return _csv_response(
        f"skillswap-reviews-{today}.csv",
        ["id", "session_id", "author", "target", "rating_stars",
         "feedback_text", "created_at"],
        rows,
    )
