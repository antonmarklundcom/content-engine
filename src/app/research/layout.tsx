import { Header } from "@/components/Header";
import { getLocale } from "@/lib/i18n/server";

// Reads the database on every request (brands, links, spend in the header).
export const dynamic = "force-dynamic";

/**
 * Same frame as `/youtube`'s layout: the token-styled header, and the section
 * attribute that keeps the legacy bare-element CSS off this subtree until S5
 * deletes that CSS.
 */
export default async function ResearchLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <div data-youtube-section lang={locale} className="min-h-screen antialiased">
      <Header />
      {children}
    </div>
  );
}
