import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return { title: t("studio.title"), robots: { index: false, follow: false } };
}

// Scripts, brands and the spend meter are read on every request; nothing here
// can be prerendered on a machine with no DATABASE_URL (same as /youtube).
export const dynamic = "force-dynamic";

/**
 * The script studio (PLAN.md §6.S12) shares the YouTube section's header and
 * design tokens. The nav link to it is S9's (the header is not S12's file);
 * until then it is reached from /research's "Use as reference" and by URL.
 */
export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div data-youtube-section lang={locale} className="min-h-screen antialiased">
      <Header />
      {children}
    </div>
  );
}
