"""Data model per the SDD data dictionary.

Tables:
  Profile        — OneToOne to User, trust ledger fields + location/bio/etc.
  UserSkill      — one row per (user, skill, TEACH|LEARN)
  ChatMessage    — sender/receiver/message_body/sent_at
  SwapSession    — partner_one/partner_two, calendar_date, duration_block,
                   session_status PENDING/ACCEPTED/COMPLETED/CANCELLED
  IntegrityReview — per-session review, drives the target's trust_score
"""
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Profile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    bio = models.TextField(blank=True, default="")
    # Location is country + city (round 3c): `country` is picked from the
    # full world list in the frontend; `location` is the city/area free
    # text. Older profiles have a city-only `location` and an empty
    # country — they keep working, and the same-city bonus still compares
    # `location` only.
    country = models.CharField(max_length=100, blank=True, default="")
    location = models.CharField(max_length=120, blank=True, default="")
    availability = models.CharField(max_length=120, blank=True, default="")
    portfolio_link = models.URLField(blank=True, default="")
    avatar_color = models.CharField(max_length=7, default="#4F46E5")
    # Trust ledger (SDD): default 100, recalculated from IntegrityReviews.
    trust_score = models.IntegerField(
        default=100, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    verified_badge = models.BooleanField(default=False)

    def __str__(self):
        return f"Profile({self.user.username}, trust={self.trust_score})"


class UserSkill(models.Model):
    class SkillType(models.TextChoices):
        TEACH = "TEACH", "Teach"
        LEARN = "LEARN", "Learn"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="skills"
    )
    skill_name = models.CharField(max_length=120)
    skill_type = models.CharField(
        max_length=5, choices=SkillType.choices, default=SkillType.TEACH
    )

    class Meta:
        unique_together = ("user", "skill_name", "skill_type")
        ordering = ["skill_name"]

    def __str__(self):
        return f"{self.user.username} {self.skill_type}: {self.skill_name}"


class ChatMessage(models.Model):
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sent_messages",
    )
    receiver = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="received_messages",
    )
    message_body = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    # Additive (not in the SDD): read tracking so conversations can report
    # a real unread_count. Marked read when the peer's history is fetched.
    is_read = models.BooleanField(default=False)
    # Additive (round 3b, in-app code sharing): when set, the message is a
    # code snippet rendered in a monospace block. One of CODE_LANGUAGES
    # (validated in views), or None for a plain text message.
    code_language = models.CharField(max_length=32, blank=True, null=True)
    # Additive (round 3c, chat privacy filter): a message that looks like
    # it shares a phone number or a link is held for admin approval
    # instead of being delivered. APPROVED is the default, so normal
    # messages flow instantly exactly as before.
    class ModerationStatus(models.TextChoices):
        PENDING = "pending", "Pending admin approval"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected by admin"

    moderation_status = models.CharField(
        max_length=10,
        choices=ModerationStatus.choices,
        default=ModerationStatus.APPROVED,
    )
    # Which filter pattern matched, e.g. "phone", "link" or "phone,link".
    flag_reason = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        indexes = [models.Index(fields=["sender", "receiver", "sent_at"])]
        ordering = ["sent_at"]

    def __str__(self):
        return f"{self.sender.username} -> {self.receiver.username} @ {self.sent_at}"


def attachment_upload_path(instance, filename):
    """Randomised name under attachments/<year>/<month>/ — never the
    client-supplied name, so no collisions and no path traversal.
    (created_at is None here — upload_to runs before the row is saved —
    so the current date is used instead.)"""
    import os
    import uuid

    from django.utils import timezone

    ext = os.path.splitext(filename)[1].lower()
    now = timezone.now()
    return f"attachments/{now:%Y/%m}/{uuid.uuid4().hex}{ext}"


class ChatAttachment(models.Model):
    """One file attached to a chat message (round 3b, in-app document
    sharing). The file lives on the backend disk under MEDIA_ROOT; the
    download URL is signed per viewer (see serializers.attachment_payload)
    so only the two chat participants can fetch it. NOTE: on Render's free
    tier the disk is ephemeral — an uploaded file survives until the next
    deploy/restart, like the old SQLite data did before the Neon move."""

    message = models.OneToOneField(
        ChatMessage, on_delete=models.CASCADE, related_name="attachment"
    )
    file = models.FileField(upload_to=attachment_upload_path)
    original_filename = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True, default="")
    size = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Attachment({self.original_filename}, {self.size} bytes)"

    def delete(self, *args, **kwargs):
        # Remove the stored file too (admin message delete cascades here).
        storage = self.file.storage
        name = self.file.name
        super().delete(*args, **kwargs)
        if name:
            storage.delete(name)


# File uploads: 10 MB cap, images / PDF / office+text docs only. Executables
# and anything else are rejected (validated in views.upload_message).
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".pdf",
    ".doc", ".docx", ".txt", ".md", ".csv", ".xls", ".xlsx", ".ppt", ".pptx",
}
IMAGE_ATTACHMENT_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}

# Code snippets: the languages the composer offers (validated in views).
CODE_LANGUAGES = {
    "python", "javascript", "typescript", "java", "c", "cpp", "csharp",
    "go", "rust", "ruby", "php", "html", "css", "sql", "bash", "json",
    "other",
}


class SwapSession(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        ACCEPTED = "ACCEPTED", "Accepted"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"

    partner_one = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sessions_as_partner_one",
    )
    partner_two = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="sessions_as_partner_two",
    )
    title = models.CharField(max_length=200, blank=True, default="")
    calendar_date = models.DateField()
    duration_block = models.CharField(max_length=100, default="1 Hour Mutual Swap")
    session_status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Session({self.partner_one.username} <-> {self.partner_two.username}, "
            f"{self.calendar_date}, {self.session_status})"
        )


class IntegrityReview(models.Model):
    session = models.ForeignKey(
        SwapSession, on_delete=models.CASCADE, related_name="reviews"
    )
    author_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews_authored",
    )
    target_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reviews_received",
    )
    rating_stars = models.IntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    feedback_text = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("session", "author_user")
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Review({self.author_user.username} -> {self.target_user.username}, "
            f"{self.rating_stars} stars)"
        )


def recalculate_trust_score(user):
    """trust_score = round(avg(rating_stars for target) / 5 * 100); 100 if none."""
    from django.db.models import Avg

    avg = IntegrityReview.objects.filter(target_user=user).aggregate(
        Avg("rating_stars")
    )["rating_stars__avg"]
    profile, _ = Profile.objects.get_or_create(user=user)
    profile.trust_score = 100 if avg is None else round(avg / 5 * 100)
    profile.save(update_fields=["trust_score"])
    return profile.trust_score


# ------------------------------------------------------------------ round 4
# Admin-panel additions (user-approved 2026-11-11): user reports,
# backend-stored skill catalog, announcements, audit log. Analytics and
# CSV export are computed from the existing tables (no new model needed).


class SkillCatalog(models.Model):
    """One row per catalog skill (round 4). The SkillPicker reads this
    table from the backend instead of a hardcoded list, so an admin can
    add / rename / remove skills and every signup + profile edit sees
    the change. `is_active=False` is a soft remove: users who already
    picked the skill keep their USER_SKILL rows (free-text values)."""

    name = models.CharField(max_length=120, unique=True)
    group = models.CharField(max_length=80, default="General")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]

    def __str__(self):
        return f"SkillCatalog({self.name}, {self.group})"


class UserReport(models.Model):
    """A student reporting another user (round 4). The admin resolves it
    from the Reports queue: dismiss, warn (note only), or deactivate the
    reported user. Stored in the DB with reporter/reported/reason/text."""

    class Reason(models.TextChoices):
        BAD_BEHAVIOUR = "bad_behaviour", "Bad behaviour"
        FAKE_SKILLS = "fake_skills", "Fake skills"
        SPAM = "spam", "Spam"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        RESOLVED = "resolved", "Resolved"

    class Action(models.TextChoices):
        DISMISSED = "dismissed", "Dismissed"
        WARNED = "warned", "Warned"
        DEACTIVATED = "deactivated", "User deactivated"

    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reports_made",
    )
    reported_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="reports_received",
    )
    reason = models.CharField(max_length=20, choices=Reason.choices)
    details = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.OPEN
    )
    action_taken = models.CharField(
        max_length=20, choices=Action.choices, blank=True, default=""
    )
    resolution_note = models.TextField(blank=True, default="")
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reports_resolved",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"Report({self.reporter.username} -> {self.reported_user.username}, "
            f"{self.reason}, {self.status})"
        )


class Announcement(models.Model):
    """An admin announcement (round 4): shown to all students as a
    dismissible banner until deleted or expired."""

    title = models.CharField(max_length=200)
    body = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="announcements_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Announcement({self.title})"


class AuditLog(models.Model):
    """One row per admin action (round 4). Written by the audit
    middleware for every successful mutating /api/admin/* request, so
    no admin view has to remember to log itself."""

    admin = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="audit_entries",
    )
    action = models.CharField(max_length=80)
    target_type = models.CharField(max_length=40, blank=True, default="")
    target_id = models.IntegerField(null=True, blank=True)
    target_label = models.CharField(max_length=200, blank=True, default="")
    detail = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at", "action"])]

    def __str__(self):
        return f"Audit({self.admin}, {self.action}, {self.target_label})"
