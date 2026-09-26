"use client";

import { useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { CopyTextButton } from "./CopyTextButton";
import { BUTTON_SECONDARY } from "./BrandStyles";

export type BrandIdea = {
  id: number;
  title: string;
  angle: string;
  format: string;
  platform: string;
  draftCopy: string;
  visualNotes: string | null;
  // Model-written JSON: `sources` is typed as an array but is not guaranteed one.
  citations: { claim: string; sources?: string[] | null }[] | null;
  status: "proposed" | "approved" | "rejected" | "posted";
  createdAt: string;
};

const TAG = "surface-border inline-block rounded-full px-2 py-0.5 text-[11px] tracking-wide uppercase";

const STATUS_TAG: Record<BrandIdea["status"], string> = {
  proposed: "text-[var(--color-ink-muted)]",
  approved: "border-[var(--color-accent)] text-[var(--color-accent)]",
  rejected: "border-[var(--color-danger)] text-[var(--color-danger)]",
  posted: "border-[var(--color-accent)] text-[var(--color-accent)]",
};

/** One idea: editable caption, copy, approve/reject. Same actions as before the port. */
export function BrandIdeaCard({
  idea,
  locale,
  onStatus,
  onSaveCopy,
}: {
  idea: BrandIdea;
  locale: Locale;
  onStatus: (id: number, status: BrandIdea["status"]) => void;
  onSaveCopy: (id: number, draftCopy: string) => void;
}) {
  const t = translator(locale);
  const [copy, setCopy] = useState(idea.draftCopy);
  const [dirty, setDirty] = useState(false);

  return (
    <article className="surface-border surface-card p-5">
      <div className="flex flex-wrap gap-1.5">
        <span className={`${TAG} ${STATUS_TAG[idea.status]}`}>{t(`brands.status.${idea.status}`)}</span>
        <span className={`${TAG} text-[var(--color-ink-muted)]`}>{idea.format}</span>
        <span className={`${TAG} text-[var(--color-ink-muted)]`}>{idea.platform}</span>
      </div>
      <h2 className="mt-3 text-base font-semibold text-[var(--color-ink)]">{idea.title}</h2>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{idea.angle}</p>

      <textarea
        rows={6}
        value={copy}
        onChange={(e) => {
          setCopy(e.target.value);
          setDirty(true);
        }}
        className="surface-border mt-4 w-full resize-y rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-3 text-sm leading-relaxed text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      />

      {idea.visualNotes && (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          <strong className="text-[var(--color-ink)]">{t("brands.visual")}</strong> {idea.visualNotes}
        </p>
      )}

      {idea.citations && idea.citations.length > 0 && (
        <details className="mt-2 text-sm text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer">{t("brands.sources", { count: idea.citations.length })}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {idea.citations.map((c, i) => (
              <li key={i} className="break-words">
                {c.claim} — {(c.sources ?? []).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {dirty && (
          <button
            type="button"
            className={BUTTON_SECONDARY}
            onClick={() => {
              onSaveCopy(idea.id, copy);
              setDirty(false);
            }}
          >
            {t("brands.saveCopy")}
          </button>
        )}
        <CopyTextButton text={copy} label={t("brands.copyCaption")} />
        <button
          type="button"
          className={`${BUTTON_SECONDARY} text-[var(--color-accent)]`}
          onClick={() => onStatus(idea.id, "approved")}
          disabled={idea.status === "approved"}
        >
          {t("brands.approve")}
        </button>
        <button
          type="button"
          className={`${BUTTON_SECONDARY} text-[var(--color-danger)] hover:border-[var(--color-danger)]`}
          onClick={() => onStatus(idea.id, "rejected")}
          disabled={idea.status === "rejected"}
        >
          {t("brands.reject")}
        </button>
      </div>
    </article>
  );
}
