from django.contrib import admin

from .models import (
    ChatMessage,
    IntegrityReview,
    Profile,
    SwapSession,
    UserSkill,
)

admin.site.site_header = "Skill Swap Platform with AI Matching"
admin.site.site_title = "Skill Swap Platform with AI Matching"
admin.site.index_title = "Skill Swap Platform with AI Matching — admin"

admin.site.register(Profile)
admin.site.register(UserSkill)
admin.site.register(ChatMessage)
admin.site.register(SwapSession)
admin.site.register(IntegrityReview)
