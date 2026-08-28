import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { spendStatus } from "@/lib/spend";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { LocaleToggle } from "./LocaleToggle";
import { SpendMeter } from "./SpendMeter";

export async function Header() {
  const [locale, user] = await Promise.all([getLocale(), getSession()]);
  const t = translator(locale);

  // Signed out (the login page renders inside this layout): no nav to offer and
  // no spend figure to leak. Reading spendStatus() unconditionally would also
  // put MySQL in the path of the one page that must work when things are broken.
  const status = user ? await spendStatus() : null;

  const nav = [
    { href: "/youtube", label: t("nav.digest") },
    { href: "/youtube/topics", label: t("nav.topics") },
    { href: "/youtube/marks", label: t("nav.marks") },
    { href: "/youtube/sources", label: t("nav.sources") },
    { href: "/youtube/ingest", label: t("nav.ingest") },
  ];

  return (
    <header className="surface-border sticky top-0 z-10 border-x-0 border-t-0 bg-[var(--color-surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-8">
          <Link href="/youtube" className="text-sm font-semibold tracking-tight text-[var(--color-ink)]">
            {t("app.name")}
          </Link>
          <nav className="flex items-center gap-5">
            {user &&
              nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                >
                  {item.label}
                </Link>
              ))}
          </nav>
        </div>
        <div className="flex items-center gap-5">
          <LocaleToggle locale={locale} />
          {status && <SpendMeter status={status} locale={locale} />}
          {user && (
            <form action={logout}>
              <button
                type="submit"
                title={user.email}
                className="rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                {t("login.signOut")}
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
