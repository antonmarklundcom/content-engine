/**
 * Posts, the calendar and the post pack (PLAN.md §6.S15). A stub from O9: S15
 * fills it. The lesson-kind labels live here because O9 added the two kinds
 * posts are generated from (`cta`, `caption_pattern`, §2); every existing
 * surface that lists lesson kinds looks them up by these keys.
 */

export const en = {
  "posts.title": "Posts",
  "lessons.kind.cta": "CTA",
  "lessons.kind.caption_pattern": "Caption pattern",
  "studio.lessonKind.cta": "CTA",
  "studio.lessonKind.caption_pattern": "Caption pattern",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "posts.title": "Inlägg",
  "lessons.kind.cta": "Uppmaning (CTA)",
  "lessons.kind.caption_pattern": "Textmönster",
  "studio.lessonKind.cta": "Uppmaning (CTA)",
  "studio.lessonKind.caption_pattern": "Textmönster",
};
