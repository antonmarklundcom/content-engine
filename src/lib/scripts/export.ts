import type { AspectRatio, BrollShot, ScriptBodyV1 } from "./contract";

/**
 * The three exports of a script (PLAN.md §5.O8.4): teleprompter Markdown, raw
 * JSON (the body as stored), and the Higgsfield shot list (§1.34). Pure
 * functions of the stored row, so the route is a lookup and a switch.
 */

export const EXPORT_FORMATS = ["md", "json", "shots"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ExportableScript = {
  id: number;
  brandId: string;
  status: string;
  body: ScriptBodyV1;
};

// ---------------------------------------------------------------------------
// teleprompter
// ---------------------------------------------------------------------------

function onScreen(lines: string[]): string[] {
  return lines.map((t) => `> ON SCREEN: ${t}`);
}

/**
 * What Anton reads from. Spoken lines are one per paragraph (one idea per
 * line, §1.33); on-screen text and talking points are set apart so they are
 * never read aloud by mistake. Sources that must be checked are marked where
 * they are used, not only at the bottom.
 */
export function teleprompterMarkdown(script: ExportableScript): string {
  const b = script.body;
  const flagged = new Set(b.sources.filter((s) => s.verifyBeforeRecording).map((s) => s.id));
  const out: string[] = [
    `# ${b.chosenTitle}`,
    "",
    `_${b.language} · ~${b.targetMinutes} min · ${script.status} · script ${script.id}_`,
    "",
    "## Hook",
    "",
    ...b.hook.spokenLines.flatMap((l) => [l, ""]),
    ...(b.hook.onScreenText.length ? [...onScreen(b.hook.onScreenText), ""] : []),
  ];

  for (const section of b.sections) {
    out.push(`## ${section.heading}`, "");
    const toCheck = section.sourceIds.filter((id) => flagged.has(id));
    if (toCheck.length) out.push(`> ⚠ VERIFY BEFORE RECORDING: ${toCheck.join(", ")}`, "");
    for (const line of section.spokenLines) out.push(line, "");
    if (section.onScreenText.length) out.push(...onScreen(section.onScreenText), "");
    if (section.talkingPoints.length) {
      out.push("<details><summary>Talking points</summary>", "");
      out.push(...section.talkingPoints.map((t) => `- ${t}`), "", "</details>", "");
    }
  }

  out.push("## Call to action", "", ...b.cta.spokenLines.flatMap((l) => [l, ""]));
  if (b.cta.onScreenText.length) out.push(...onScreen(b.cta.onScreenText), "");

  out.push("---", "", "## Sources", "");
  if (b.sources.length === 0) out.push("_No factual claims cited._", "");
  for (const s of b.sources) {
    const mark = s.verifyBeforeRecording ? " — ⚠ verify before recording" : "";
    out.push(`- **${s.id}** ${s.claim} — [${s.title || s.url}](${s.url})${mark}`);
  }
  out.push("", "## Title options", "", ...b.titleOptions.map((t) => `- **${t.title}** — ${t.angle}`), "");
  out.push(
    "## Thumbnail concepts",
    "",
    ...b.thumbnailConcepts.map(
      (t, i) => `${i + 1}. ${t.description}${t.textOverlay ? ` — text: "${t.textOverlay}"` : ""}`,
    ),
    "",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// shot list
// ---------------------------------------------------------------------------

export type Shot = {
  /** 1-based, in the order the shots play. */
  number: number;
  /** "Hook" or the section heading it belongs to. */
  section: string;
  spokenLine: string;
  description: string;
  imagePrompt: string;
  /** Null for a still. */
  videoPrompt: string | null;
  aspectRatio: AspectRatio;
  files: { image: string; video: string | null };
};

export type ThumbnailShot = {
  number: number;
  description: string;
  textOverlay: string;
  imagePrompt: string;
  aspectRatio: "16:9";
  file: string;
};

export type ShotList = {
  scriptId: number;
  title: string;
  /** Where every file below is saved, relative to the repo running Claude Code. */
  mediaDir: string;
  shots: Shot[];
  thumbnails: ThumbnailShot[];
};

/** ASCII, lowercase, hyphenated, ≤ 40 chars — safe on Windows and in a URL. */
export function slugify(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "shot";
}

const pad = (n: number) => String(n).padStart(2, "0");

export function shotList(script: ExportableScript): ShotList {
  const b = script.body;
  const mediaDir = `media/${script.id}`;
  const blocks: { section: string; broll: BrollShot[] }[] = [
    { section: "Hook", broll: b.hook.broll },
    ...b.sections.map((s) => ({ section: s.heading, broll: s.broll })),
  ];

  const shots: Shot[] = [];
  for (const block of blocks) {
    for (const shot of block.broll) {
      const number = shots.length + 1;
      const base = `${mediaDir}/${pad(number)}-${slugify(shot.description)}`;
      shots.push({
        number,
        section: block.section,
        spokenLine: shot.spokenLine,
        description: shot.description,
        imagePrompt: shot.imagePrompt,
        videoPrompt: shot.videoPrompt,
        aspectRatio: shot.aspectRatio,
        files: { image: `${base}.png`, video: shot.videoPrompt ? `${base}.mp4` : null },
      });
    }
  }

  const thumbnails: ThumbnailShot[] = b.thumbnailConcepts.map((t, i) => ({
    number: i + 1,
    description: t.description,
    textOverlay: t.textOverlay,
    imagePrompt: t.imagePrompt,
    aspectRatio: "16:9",
    file: `${mediaDir}/thumb-${i + 1}-${slugify(t.description)}.png`,
  }));

  return { scriptId: script.id, title: b.chosenTitle, mediaDir, shots, thumbnails };
}

/**
 * The shot list as Markdown for a person, with the same list as a fenced JSON
 * block at the end for a Claude Code session to parse (§1.34: "Markdown +
 * JSON" in one paste).
 */
export function shotListMarkdown(list: ShotList): string {
  const out: string[] = [
    `# Shot list — ${list.title}`,
    "",
    `Script ${list.scriptId} · ${list.shots.length} shots · save to \`${list.mediaDir}/\``,
    "",
  ];
  for (const s of list.shots) {
    out.push(`## ${pad(s.number)}. ${s.description}`, "");
    out.push(`- **Section:** ${s.section}`);
    out.push(`- **Covers:** "${s.spokenLine}"`);
    out.push(`- **Aspect ratio:** ${s.aspectRatio}`);
    out.push(`- **Image prompt:** ${s.imagePrompt}`);
    if (s.videoPrompt) out.push(`- **Video prompt:** ${s.videoPrompt}`);
    out.push(`- **Files:** \`${s.files.image}\`${s.files.video ? `, \`${s.files.video}\`` : ""}`, "");
  }
  if (list.thumbnails.length) {
    out.push("## Thumbnails", "");
    for (const t of list.thumbnails) {
      out.push(
        `- **${t.number}.** ${t.description}${t.textOverlay ? ` (text: "${t.textOverlay}")` : ""} — ${t.imagePrompt} → \`${t.file}\``,
      );
    }
    out.push("");
  }
  out.push("```json", JSON.stringify(list, null, 2), "```", "");
  return out.join("\n");
}
