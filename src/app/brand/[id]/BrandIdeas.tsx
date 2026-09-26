import { BrandIdeaBoard } from "@/components/BrandIdeaBoard";
import type { Locale } from "@/lib/i18n";

export type AnalyzedVideoOption = {
  analysisId: number;
  videoId: number;
  title: string;
  channelTitle: string | null;
};

/**
 * The brand page's ideas section. A server component that hands the client
 * islands everything they need as props (locale included, so the first paint
 * is already in the right language).
 *
 * The list itself is still loaded by the board from `/api/ideas`: there is no
 * bridge read for ideas yet (S6 owns `src/lib/bridge/ideas.ts`), and lane 2
 * reads only through the bridge (PLAN.md §4.7). S9 moves it server-side.
 */
export default function BrandIdeas({
  brandId,
  analyzedVideos,
  locale,
}: {
  brandId: string;
  /** The "seed from a video" picker's list (PLAN.md §6.S3.2) — bridge.listAnalyzedVideos(). */
  analyzedVideos: AnalyzedVideoOption[];
  locale: Locale;
}) {
  return (
    <section className="mt-8">
      <BrandIdeaBoard brandId={brandId} analyzedVideos={analyzedVideos} locale={locale} />
    </section>
  );
}
