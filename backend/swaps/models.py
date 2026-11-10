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

    class Meta:
        indexes = [models.Index(fields=["sender", "receiver", "sent_at"])]
        ordering = ["sent_at"]

    def __str__(self):
        return f"{self.sender.username} -> {self.receiver.username} @ {self.sent_at}"


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
