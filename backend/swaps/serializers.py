"""Serializers for the Skill Swap API (JWT user shape everywhere).

User shape: {id, username, full_name, email}
Profile shape: {id, user, bio, location, availability, portfolio_link,
                avatar_color, trust_score, verified_badge,
                teach_skills:[...], learn_skills:[...]}
"""
from django.contrib.auth import get_user_model
from django.core import signing
from rest_framework import serializers

from django.db.models import Avg, Count

from .models import (
    ChatAttachment,
    ChatMessage,
    IMAGE_ATTACHMENT_EXTENSIONS,
    IntegrityReview,
    Profile,
    SwapSession,
    UserSkill,
)

ATTACHMENT_URL_SALT = "skillswap-attachment"
# Signed download links stay valid for 1 hour; the chat re-fetches history
# on open, so links are always fresh when shown.
ATTACHMENT_URL_MAX_AGE_SECONDS = 3600


def attachment_download_url(attachment, viewer):
    """Signed, per-viewer download URL (path relative to the API root).

    The token binds the attachment id to the viewer, so an <img> tag or a
    plain <a> can fetch it without an Authorization header, and no other
    user can reuse the link. The download view re-checks that the viewer
    is a participant of the message.
    """
    token = signing.dumps(
        {"att": attachment.id, "u": viewer.id}, salt=ATTACHMENT_URL_SALT
    )
    # No leading slash: the client resolves this against the API base
    # (e.g. https://host/api) so the /api prefix is kept.
    return f"attachments/{attachment.id}/download/?t={token}"


def attachment_payload(attachment, viewer):
    return {
        "id": attachment.id,
        "name": attachment.original_filename,
        "size": attachment.size,
        "content_type": attachment.content_type,
        "is_image": attachment.file.name.lower().endswith(
            tuple(IMAGE_ATTACHMENT_EXTENSIONS)
        ),
        "url": attachment_download_url(attachment, viewer),
    }


def rating_stats_for(user):
    """(average_rating, review_count) for a user from IntegrityReview.

    average_rating is None when the user has no reviews yet; trust_score
    is a separate ledger field and is NOT derived here.
    """
    agg = IntegrityReview.objects.filter(target_user=user).aggregate(
        avg=Avg("rating_stars"), count=Count("id"),
    )
    avg = agg["avg"]
    return (round(float(avg), 1) if avg is not None else None, agg["count"])

User = get_user_model()


def full_name_of(user):
    return f"{user.first_name} {user.last_name}".strip() or user.username


class UserMiniSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "username", "full_name", "email")

    def get_full_name(self, obj):
        return full_name_of(obj)


class ProfileSerializer(serializers.ModelSerializer):
    user = UserMiniSerializer(read_only=True)
    teach_skills = serializers.SerializerMethodField()
    learn_skills = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = Profile
        fields = (
            "id", "user", "bio", "location", "availability", "portfolio_link",
            "avatar_color", "trust_score", "verified_badge",
            "teach_skills", "learn_skills",
            "average_rating", "review_count",
        )

    def _skills(self, profile, skill_type):
        return list(
            UserSkill.objects.filter(user=profile.user, skill_type=skill_type)
            .order_by("skill_name")
            .values_list("skill_name", flat=True)
        )

    def get_teach_skills(self, obj):
        return self._skills(obj, UserSkill.SkillType.TEACH)

    def get_learn_skills(self, obj):
        return self._skills(obj, UserSkill.SkillType.LEARN)

    def _rating_stats(self, obj):
        # One aggregate per profile, shared by both rating fields.
        if not hasattr(obj, "_rating_stats_cache"):
            obj._rating_stats_cache = rating_stats_for(obj.user)
        return obj._rating_stats_cache

    def get_average_rating(self, obj):
        return self._rating_stats(obj)[0]

    def get_review_count(self, obj):
        return self._rating_stats(obj)[1]


class ProfileUpdateSerializer(serializers.Serializer):
    full_name = serializers.CharField(required=False, allow_blank=True)
    bio = serializers.CharField(required=False, allow_blank=True)
    location = serializers.CharField(required=False, allow_blank=True, max_length=120)
    availability = serializers.CharField(
        required=False, allow_blank=True, max_length=120
    )
    portfolio_link = serializers.URLField(required=False, allow_blank=True)
    avatar_color = serializers.CharField(required=False, allow_blank=True, max_length=7)
    teach_skills = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False
    )
    learn_skills = serializers.ListField(
        child=serializers.CharField(max_length=120), required=False
    )

    def update_profile(self, user, profile, data):
        if "full_name" in data and data["full_name"].strip():
            parts = data["full_name"].strip().split(None, 1)
            user.first_name = parts[0]
            user.last_name = parts[1] if len(parts) > 1 else ""
            user.save(update_fields=["first_name", "last_name"])
        for field in ("bio", "location", "availability", "portfolio_link",
                      "avatar_color"):
            if field in data:
                setattr(profile, field, data[field])
        profile.save()
        for field, skill_type in (
            ("teach_skills", UserSkill.SkillType.TEACH),
            ("learn_skills", UserSkill.SkillType.LEARN),
        ):
            if field in data:
                UserSkill.objects.filter(
                    user=user, skill_type=skill_type
                ).delete()
                seen = set()
                for raw in data[field]:
                    name = str(raw).strip()
                    if name and name.lower() not in seen:
                        seen.add(name.lower())
                        UserSkill.objects.create(
                            user=user, skill_name=name, skill_type=skill_type
                        )
        return profile


class SessionSerializer(serializers.ModelSerializer):
    partner_one = UserMiniSerializer(read_only=True)
    partner_two = UserMiniSerializer(read_only=True)

    class Meta:
        model = SwapSession
        fields = (
            "id", "partner_one", "partner_two", "title", "calendar_date",
            "duration_block", "session_status", "created_at",
        )


class MessageSerializer(serializers.ModelSerializer):
    sender = UserMiniSerializer(read_only=True)
    recipient = UserMiniSerializer(read_only=True, source="receiver")
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = ChatMessage
        fields = ("id", "sender", "recipient", "body", "created_at", "is_mine")

    # The DB field is message_body; the API contract calls it "body".
    body = serializers.CharField(source="message_body")

    def get_is_mine(self, obj):
        request = self.context.get("request")
        return bool(request and request.user.is_authenticated
                    and obj.sender_id == request.user.id)


class ReviewSerializer(serializers.ModelSerializer):
    reviewer = UserMiniSerializer(read_only=True, source="author_user")
    reviewee = UserMiniSerializer(read_only=True, source="target_user")

    class Meta:
        model = IntegrityReview
        fields = (
            "id", "session", "reviewer", "reviewee", "rating_stars",
            "feedback_text", "created_at",
        )
