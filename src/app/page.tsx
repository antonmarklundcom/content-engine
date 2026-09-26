import Link from "next/link";
import { listBrands } from "@/lib/bridge";
import { getTranslator } from "@/lib/i18n/server";

// The brand list comes from the `brands` table now (PLAN.md §1.5), so this
// page reads the database on every request — it can't be prerendered at build
// time on a machine with no DATABASE_URL, and a brand edited in the table
// should show up without a redeploy. Same reasoning as /youtube's layout.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [brands, t] = await Promise.all([listBrands(), getTranslator()]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("brands.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("brands.intro")}</p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {brands.map((brand) => (
          <Link
            key={brand.id}
            href={`/brand/${brand.id}`}
            className="surface-border surface-card block p-5 transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            <h2 className="text-base font-semibold text-[var(--color-ink)]">{brand.name}</h2>
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{brand.niche}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
