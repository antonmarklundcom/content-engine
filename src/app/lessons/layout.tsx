import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = translator(await getLocale());
  return {
    title: { default: t("lessons.title"), template: `%s · ${t("app.name")}` },
    robots: { index: false, follow: false },
  };
}

// Lessons are read on every request: one just saved from a video page has to be here.
export const dynamic = "force-dynamic";

export default async function LessonsLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Same shell as /inbox (the Tailwind token design system).
  return (
    <div data-youtube-section lang={locale} className="min-h-screen antialiased">
      <Header />
      {children}
    </div>
  );
}
