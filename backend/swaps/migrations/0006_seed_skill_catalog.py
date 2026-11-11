"""Seed the backend skill catalog (round 4) with the 36 skills the
frontend shipped as a hardcoded list (skills.ts), in the same group
order. Uses update_or_create by name so re-running the migration (or a
catalog edited by the admin) never duplicates or clobbers rows."""

from django.db import migrations

CATALOG = [
    ("Programming & Tech", [
        "Python", "JavaScript", "React", "TypeScript", "Java", "C++",
        "SQL", "Data Analysis", "Machine Learning", "Web Development",
        "Mobile App Development",
    ]),
    ("Design & Media", [
        "UI/UX Design", "Figma", "Graphic Design", "Photography",
        "Video Editing", "Storytelling", "Creative Writing",
    ]),
    ("Languages", [
        "English", "Spanish", "French", "German", "Urdu", "Arabic",
    ]),
    ("Music & Arts", ["Guitar", "Piano", "Singing", "Drawing"]),
    ("Business & Life", [
        "Public Speaking", "Marketing", "Business Strategy", "Accounting",
        "Leadership", "Time Management", "Cooking", "Fitness Coaching",
    ]),
]


def seed_catalog(apps, schema_editor):
    SkillCatalog = apps.get_model("swaps", "SkillCatalog")
    for group, skills in CATALOG:
        for name in skills:
            SkillCatalog.objects.update_or_create(
                name=name, defaults={"group": group, "is_active": True}
            )


def unseed_catalog(apps, schema_editor):
    # Reverse: only remove the seeded rows that are still untouched
    # (still active, same group). Admin-added skills are never touched.
    SkillCatalog = apps.get_model("swaps", "SkillCatalog")
    for group, skills in CATALOG:
        SkillCatalog.objects.filter(name__in=skills, group=group).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("swaps", "0005_round4_admin_features"),
    ]

    operations = [
        migrations.RunPython(seed_catalog, unseed_catalog),
    ]
