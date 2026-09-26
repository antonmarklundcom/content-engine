/** Header nav groups and the links under them (PLAN.md §6.S9). `nav.ts` is pinned by the O6 key snapshot, so these live here. */

export const en = {
  "header.content": "Content",
  "header.research": "Research",
  "header.research.outliers": "Outliers",
  "header.research.report": "Report",
  "header.research.questions": "Questions",
  "header.research.compare": "Compare",
  "header.studio": "Studio",
  "header.studio.scripts": "Scripts",
  "header.studio.plan": "Plan",
  "header.studio.listing": "From listing",
  "header.facts": "Facts",
  "header.lessons": "Lessons",
  "header.settings": "Settings",
  "header.youtube": "YouTube",
} as const;

export const sv: Record<keyof typeof en, string> = {
  "header.content": "Innehåll",
  "header.research": "Research",
  "header.research.outliers": "Avvikare",
  "header.research.report": "Rapport",
  "header.research.questions": "Frågor",
  "header.research.compare": "Jämför",
  "header.studio": "Studio",
  "header.studio.scripts": "Manus",
  "header.studio.plan": "Plan",
  "header.studio.listing": "Från annons",
  "header.facts": "Fakta",
  "header.lessons": "Lärdomar",
  "header.settings": "Inställningar",
  "header.youtube": "YouTube",
};
