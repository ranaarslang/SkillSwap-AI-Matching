// Curated skill catalog used by the sign-up skills step and the profile
// editor — and the seed for the backend SkillCatalog table (round 4).
// The live source of truth is the backend (/api/skills/): SkillPicker
// fetches it and falls back to this list only when the request fails.
// A user picks from these and can also add their own free-text
// skills — everything they pick is stored as a USER_SKILL row and feeds
// the AI matcher.
export interface SkillGroup {
  label: string
  skills: string[]
}

export const SKILL_CATALOG: SkillGroup[] = [
  {
    label: 'Programming & Tech',
    skills: [
      'Python',
      'JavaScript',
      'React',
      'TypeScript',
      'Java',
      'C++',
      'SQL',
      'Data Analysis',
      'Machine Learning',
      'Web Development',
      'Mobile App Development',
    ],
  },
  {
    label: 'Design & Media',
    skills: [
      'UI/UX Design',
      'Figma',
      'Graphic Design',
      'Photography',
      'Video Editing',
      'Storytelling',
      'Creative Writing',
    ],
  },
  {
    label: 'Languages',
    skills: ['English', 'Spanish', 'French', 'German', 'Urdu', 'Arabic'],
  },
  {
    label: 'Music & Arts',
    skills: ['Guitar', 'Piano', 'Singing', 'Drawing'],
  },
  {
    label: 'Business & Life',
    skills: [
      'Public Speaking',
      'Marketing',
      'Business Strategy',
      'Accounting',
      'Leadership',
      'Time Management',
      'Cooking',
      'Fitness Coaching',
    ],
  },
]

export const ALL_CATALOG_SKILLS: string[] = SKILL_CATALOG.flatMap((g) => g.skills)

export const MAX_SKILLS_PER_LIST = 20
