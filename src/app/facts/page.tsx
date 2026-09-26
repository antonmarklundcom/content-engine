import type { Metadata } from "next";
import { FactAddForm } from "@/components/FactAddForm";
import { FactCorrections } from "@/components/FactCorrections";
import { FactRow } from "@/components/FactRow";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { brandScriptsNeedingCorrection, listFactsByTopic } from "@/lib/bridge/facts";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { isFactStale, STALE_AFTER_DAYS } from "@/lib/studio/staleness";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("facts.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * A brand's fact sheet (build 2b, idea 3): checked facts grouped by topic, a
 * stale badge past 90 days, and the posted videos a changed fact may have made
 * wrong. `?brand=` picks the brand. Anyone signed in reads; the owner writes.
 */
export default async function FactsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const [params, user, brands, locale] = await Promise.all([searchParams, requireUser(), listBrands(), getLocale()]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const canEdit = isOwner(user);

  const [groups, flagged] = brand
    ? await Promise.all([listFactsByTopic(brand.id), brandScriptsNeedingCorrection(brand.id)])
    : [[], []];
  const topics = groups.map((g) => g.topic);
  const now = new Date();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">{t("facts.eyebrow")}</p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("facts.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">{t("facts.intro")}</p>

      {!brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("facts.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("facts.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={`/facts?${new URLSearchParams({ brand: b.id })}`}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("facts.corrections")}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t("facts.correctionsNote")}</p>
            <FactCorrections flagged={flagged} locale={locale} />
          </section>

          <section className="surface-border surface-card mt-10 p-5">
            {canEdit ? (
              <FactAddForm key={brand.id} brandId={brand.id} topics={topics} locale={locale} />
            ) : (
              <p className="text-sm text-[var(--color-ink-muted)]">{t("facts.ownerOnly")}</p>
            )}
          </section>

          {groups.length === 0 ? (
            <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("facts.empty")}</p>
          ) : (
            groups.map((group) => (
              <section key={group.topic} className="mt-8">
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">{group.topic}</h2>
                <ul className="mt-3 flex flex-col gap-3">
                  {group.facts.map((fact) => (
                    <FactRow
                      key={fact.id}
                      fact={{
                        id: fact.id,
                        topic: fact.topic,
                        claim: fact.claim,
                        sourceUrl: fact.sourceUrl,
                        notes: fact.notes,
                        lastCheckedAt: fact.lastCheckedAt.toISOString(),
                        stale: isFactStale(fact.lastCheckedAt, now),
                      }}
                      topics={topics}
                      canEdit={canEdit}
                      staleDays={STALE_AFTER_DAYS}
                      locale={locale}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </main>
  );
}
