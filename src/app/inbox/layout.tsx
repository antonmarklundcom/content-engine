import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("inbox.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// listClips() reads on every request (PLAN.md §6.S3.1 — an inbox that's stale
// by a redeploy is the one page this build can least afford), same reasoning
// as the /youtube layout it's styled after.
export const dynamic = "force-dynamic";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();

  // data-youtube-section: the inbox reuses that design system (Tailwind +
  // the surface-* tokens), not the legacy "/" and "/brand/[id]" styling — see
  // globals.css's layer comment for why that scoping matters.
  return (
    <div data-youtube-section lang={locale} className="min-h-screen antialiased">
      <Header />
      {children}
    </div>
  );
}
