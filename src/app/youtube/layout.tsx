import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    // Template so every page's own title reads as "<page> · YT Intel" without
    // each route repeating the suffix.
    title: { default: t("app.title"), template: `%s · ${t("app.name")}` },
    description: t("app.description"),
    // Private tool — keep it out of indexes even though it now lives under a
    // path on the main app rather than its own subdomain.
    robots: { index: false, follow: false },
  };
}

// The header reads spendStatus() on every request (the counter must never go
// stale), which also means this subtree can't be statically generated at
// build time on a machine with no DATABASE_URL.
export const dynamic = "force-dynamic";

export default async function YouTubeLayout({ children }: { children: React.ReactNode }) {
  // lang must follow the chosen locale — it is what a screen reader uses to
  // pick a pronunciation, and a Swedish UI announced in English is unusable.
  // (The root layout owns the actual <html> tag; this only scopes the
  // section's own styling and header.)
  const locale = await getLocale();

  return (
    <div data-youtube-section lang={locale} className="min-h-screen antialiased">
      <Header />
      {children}
    </div>
  );
}
