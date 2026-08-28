import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { CLIP_PLATFORMS, CLIP_STATUSES, type ClipPlatform, type ClipStatus } from "@/db/schema";

const STATUS_KEY: Record<ClipStatus, TranslationKey> = {
  unprocessed: "inbox.status.unprocessed",
  ingesting: "inbox.status.ingesting",
  analyzed: "inbox.status.analyzed",
  promoted: "inbox.status.promoted",
  failed: "inbox.status.failed",
};

const PLATFORM_KEY: Record<ClipPlatform, TranslationKey> = {
  youtube: "inbox.platform.youtube",
  instagram: "inbox.platform.instagram",
  facebook: "inbox.platform.facebook",
  other: "inbox.platform.other",
};

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** The same plain GET form idiom as MarksFilters/DigestFilters — see MarksFilters. */
export function ClipFilters({
  status,
  platform,
  locale,
}: {
  status: string;
  platform: string;
  locale: Locale;
}) {
  const t = translator(locale);

  return (
    <form method="get" className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="clip-status">
        {t("inbox.filter.allStatuses")}
      </label>
      <select id="clip-status" name="status" defaultValue={status} className={FIELD}>
        <option value="">{t("inbox.filter.allStatuses")}</option>
        {CLIP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(STATUS_KEY[s])}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="clip-platform">
        {t("inbox.filter.allPlatforms")}
      </label>
      <select id="clip-platform" name="platform" defaultValue={platform} className={FIELD}>
        <option value="">{t("inbox.filter.allPlatforms")}</option>
        {CLIP_PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {t(PLATFORM_KEY[p])}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t("filters.submit")}
      </button>
    </form>
  );
}

export { STATUS_KEY, PLATFORM_KEY };
