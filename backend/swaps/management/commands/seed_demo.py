"""Seed demo data (idempotent — safe to run repeatedly).

Creates 6 demo users (password demo1234), their profiles + skills,
3 sessions (ACCEPTED maya<->leo, PENDING maya<->jonah,
COMPLETED maya<->sana with one IntegrityReview) and a few messages
between maya and leo. Recomputes trust scores afterwards.

Usage: python manage.py seed_demo
"""
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from swaps.models import (
    ChatMessage,
    IntegrityReview,
    Profile,
    SwapSession,
    UserSkill,
    recalculate_trust_score,
)

User = get_user_model()

TODAY = date.today()

USERS = [
    {
        "username": "maya",
        "email": "maya@skillswap.demo",
        "first_name": "Maya",
        "last_name": "Chen",
        "location": "Lahore",
        "bio": "Data analyst who loves turning messy data into clear stories. "
               "Learning design to make my dashboards beautiful.",
        "availability": "Weeknights",
        "teach": ["Python", "Data Visualization"],
        "learn": ["Public Speaking", "UI Design", "Storytelling", "Video Editing"],
        "verified": True,
        "avatar_color": "#4F46E5",
    },
    {
        "username": "leo",
        "email": "leo@skillswap.demo",
        "first_name": "Leo",
        "last_name": "Martins",
        "location": "Lahore",
        "bio": "Video editor and storyteller. I cut short films and YouTube "
               "videos, and I want to learn Python to automate my workflow.",
        "availability": "Weeknights",
        "teach": ["Video Editing", "Storytelling"],
        "learn": ["Python", "Product Design"],
        "verified": True,
        "avatar_color": "#0EA5E9",
    },
    {
        "username": "jonah",
        "email": "jonah@skillswap.demo",
        "first_name": "Jonah",
        "last_name": "Williams",
        "location": "Karachi",
        "bio": "Frontend developer working with React and TypeScript. "
               "Picking up photography and Figma on the side.",
        "availability": "Weekends",
        "teach": ["React", "TypeScript"],
        "learn": ["Photography", "Figma"],
        "verified": True,
        "avatar_color": "#22C55E",
    },
    {
        "username": "sana",
        "email": "sana@skillswap.demo",
        "first_name": "Sana",
        "last_name": "Patel",
        "location": "Islamabad",
        "bio": "UI designer who lives in Figma. I design clean interfaces "
               "and want to learn video editing for my portfolio.",
        "availability": "Weeknights",
        "teach": ["UI Design", "Figma"],
        "learn": ["Video Editing"],
        "verified": False,
        "avatar_color": "#EC4899",
    },
    {
        "username": "alex",
        "email": "alex@skillswap.demo",
        "first_name": "Alex",
        "last_name": "Rivera",
        "location": "Karachi",
        "bio": "Guitarist and music teacher. I teach guitar and music theory, "
               "and I want to build a small React app for my students.",
        "availability": "Weekends",
        "teach": ["Guitar", "Music Theory"],
        "learn": ["React"],
        "verified": False,
        "avatar_color": "#F59E0B",
    },
    {
        "username": "priya",
        "email": "priya@skillswap.demo",
        "first_name": "Priya",
        "last_name": "Nair",
        "location": "Lahore",
        "bio": "Content writer and public speaking coach. I help people find "
               "their voice, and I want to learn data visualization.",
        "availability": "Weekdays",
        "teach": ["Public Speaking", "Content Writing"],
        "learn": ["Data Visualization"],
        "verified": False,
        "avatar_color": "#8B5CF6",
    },
]


class Command(BaseCommand):
    help = "Seed the 6 demo users, sessions, messages and one review."

    def handle(self, *args, **options):
        users = {}
        for spec in USERS:
            user, created = User.objects.get_or_create(
                username=spec["username"],
                defaults={
                    "email": spec["email"],
                    "first_name": spec["first_name"],
                    "last_name": spec["last_name"],
                },
            )
            if created:
                user.set_password("demo1234")
                user.save()
            else:
                # Keep the demo password working even on re-seed.
                user.set_password("demo1234")
                user.email = spec["email"]
                user.first_name = spec["first_name"]
                user.last_name = spec["last_name"]
                user.save()
            users[spec["username"]] = user

            profile, _ = Profile.objects.update_or_create(
                user=user,
                defaults={
                    "bio": spec["bio"],
                    "location": spec["location"],
                    "availability": spec["availability"],
                    "avatar_color": spec["avatar_color"],
                    "verified_badge": spec["verified"],
                },
            )
            UserSkill.objects.filter(user=user).delete()
            for skill in spec["teach"]:
                UserSkill.objects.create(
                    user=user, skill_name=skill,
                    skill_type=UserSkill.SkillType.TEACH,
                )
            for skill in spec["learn"]:
                UserSkill.objects.create(
                    user=user, skill_name=skill,
                    skill_type=UserSkill.SkillType.LEARN,
                )
            self.stdout.write(
                f"  user {user.username} ({'created' if created else 'exists'})"
            )

        maya, leo, jonah, sana = (
            users["maya"], users["leo"], users["jonah"], users["sana"]
        )

        sessions = [
            {
                "p1": maya, "p2": leo,
                "title": "Python for Video Editing",
                "date": TODAY + timedelta(days=2),
                "block": "1 Hour Mutual Swap",
                "status": SwapSession.Status.ACCEPTED,
            },
            {
                "p1": maya, "p2": jonah,
                "title": "Python for React Tips",
                "date": TODAY + timedelta(days=4),
                "block": "1 Hour Mutual Swap",
                "status": SwapSession.Status.PENDING,
            },
            {
                "p1": maya, "p2": sana,
                "title": "Data Visualization for UI Design",
                "date": TODAY - timedelta(days=4),
                "block": "1 Hour Mutual Swap",
                "status": SwapSession.Status.COMPLETED,
            },
        ]
        created_sessions = {}
        for spec in sessions:
            session, _ = SwapSession.objects.update_or_create(
                partner_one=spec["p1"],
                partner_two=spec["p2"],
                calendar_date=spec["date"],
                defaults={
                    "title": spec["title"],
                    "duration_block": spec["block"],
                    "session_status": spec["status"],
                },
            )
            created_sessions[(spec["p1"].username, spec["p2"].username)] = session
            self.stdout.write(f"  session {session}")

        completed = created_sessions[("maya", "sana")]
        review, _ = IntegrityReview.objects.update_or_create(
            session=completed,
            author_user=maya,
            defaults={
                "target_user": sana,
                "rating_stars": 5,
                "feedback_text": "Sana explained UI design so clearly — "
                                 "great session, highly recommended!",
            },
        )
        self.stdout.write(f"  review {review}")

        # 4 messages between maya and leo (only seed if none exist yet).
        if not ChatMessage.objects.filter(
            sender__in=[maya, leo], receiver__in=[maya, leo]
        ).exists():
            ChatMessage.objects.create(
                sender=maya, receiver=leo,
                message_body="Hi Leo! Excited for our Python session — "
                             "I can show you how to automate your video exports.",
            )
            ChatMessage.objects.create(
                sender=leo, receiver=maya,
                message_body="Hi Maya! That sounds perfect. I will bring a "
                             "short clip so we can work on a real example.",
            )
            ChatMessage.objects.create(
                sender=maya, receiver=leo,
                message_body="Great idea. Do you prefer weekday evenings? "
                             "I am usually free after 7pm.",
            )
            ChatMessage.objects.create(
                sender=leo, receiver=maya,
                message_body="Weeknights after 7 works for me too. "
                             "See you then!",
            )
            self.stdout.write("  4 messages maya <-> leo")

        for user in users.values():
            recalculate_trust_score(user)
        self.stdout.write(self.style.SUCCESS("Seed complete."))
