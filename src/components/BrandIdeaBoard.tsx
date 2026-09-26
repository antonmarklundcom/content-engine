"use client";

import { useCallback, useEffect, useState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import type { AnalyzedVideoOption } from "@/app/brand/[id]/BrandIdeas";
import { BrandGenerateForm } from "./BrandGenerateForm";
import { BrandIdeaCard, type BrandIdea } from "./BrandIdeaCard";
import { SkeletonBlock } from "./Skeleton";

/** The brand page's ideas: generate/seed controls above, the brand's ideas below, newest first. */
export function BrandIdeaBoard({
  brandId,
  analyzedVideos,
  locale,
}: {
  brandId: string;
  analyzedVideos: AnalyzedVideoOption[];
  locale: Locale;
}) {
  const t = translator(locale);
  const [ideas, setIdeas] = useState<BrandIdea[] | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/ideas?brandId=${encodeURIComponent(brandId)}`);
    setIdeas(res.ok ? await res.json() : []);
  }, [brandId]);

  useEffect(() => {
    load();
  }, [load]);

  async function setStatus(id: number, status: BrandIdea["status"]) {
    setIdeas((prev) => prev && prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function saveCopy(id: number, draftCopy: string) {
    await fetch(`/api/ideas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftCopy }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <BrandGenerateForm
        brandId={brandId}
        analyzedVideos={analyzedVideos}
        locale={locale}
        onGenerated={load}
      />

      {ideas === null ? (
        <div className="flex flex-col gap-4" aria-label={t("brands.loading")}>
          <SkeletonBlock className="h-48 w-full" />
          <SkeletonBlock className="h-48 w-full" />
        </div>
      ) : ideas.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("brands.empty")}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {ideas.map((idea) => (
            <BrandIdeaCard
              key={idea.id}
              idea={idea}
              locale={locale}
              onStatus={setStatus}
              onSaveCopy={saveCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
