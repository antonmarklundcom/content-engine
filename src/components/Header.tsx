import Link from "next/link";
import { getSession } from "@/lib/auth/session";
import { logout } from "@/lib/auth/actions";
import { spendStatus } from "@/lib/spend";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { LocaleToggle } from "./LocaleToggle";
import { SpendMeter } from "./SpendMeter";

type NavLink = { href: string; label: string };
type NavItem = NavLink | { label: string; items: NavLink[] };

const LINK =
  "text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] focus:outline-none focus-visible:text-[var(--color-ink)]";

export async function Header() {
  const [locale, user] = await Promise.all([getLocale(), getSession()]);
  const t = translator(locale);

  // Signed out (the login page renders inside this layout): no nav to offer and
  // no spend figure to leak. Reading spendStatus() unconditionally would also
  // put MySQL in the path of the one page that must work when things are broken.
  const status = user ? await spendStatus() : null;

  // Final order (PLAN.md §6.S9). A group opens on hover or focus (a tap on a
  // phone), so the header stays a server component with no menu state.
  const nav: NavItem[] = [
    { href: "/", label: t("header.content") },
    {
      label: t("header.research"),
      items: [
        { href: "/research", label: t("header.research.outliers") },
        { href: "/research/report", label: t("header.research.report") },
        { href: "/research/questions", label: t("header.research.questions") },
        { href: "/research/compare", label: t("header.research.compare") },
      ],
    },
    {
      label: t("header.studio"),
      items: [
        { href: "/studio", label: t("header.studio.scripts") },
        { href: "/studio/plan", label: t("header.studio.plan") },
        { href: "/studio/listing", label: t("header.studio.listing") },
      ],
    },
    { href: "/facts", label: t("header.facts") },
    { href: "/lessons", label: t("header.lessons") },
    {
      label: t("header.youtube"),
      items: [
        { href: "/youtube", label: t("nav.digest") },
        { href: "/youtube/topics", label: t("nav.topics") },
        { href: "/youtube/marks", label: t("nav.marks") },
        { href: "/youtube/sources", label: t("nav.sources") },
        { href: "/youtube/ingest", label: t("nav.ingest") },
      ],
    },
    { href: "/inbox", label: t("nav.inbox") },
  ];

  return (
    <header className="surface-border sticky top-0 z-10 border-x-0 border-t-0 bg-[var(--color-surface)]/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="whitespace-nowrap text-sm font-semibold tracking-tight text-[var(--color-ink)]"
          >
            {t("app.name")}
          </Link>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {user &&
              nav.map((item) =>
                "items" in item ? (
                  <div key={item.label} className="group relative">
                    <button
                      type="button"
                      aria-haspopup="true"
                      className={`${LINK} flex items-center gap-1`}
                    >
                      {item.label}
                      <span aria-hidden className="text-[10px]">
                        ▾
                      </span>
                    </button>
                    <div className="absolute left-0 top-full z-20 hidden pt-2 group-hover:block group-focus-within:block">
                      <ul className="surface-border flex min-w-40 flex-col gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface)] p-2 shadow-lg">
                        {item.items.map((sub) => (
                          <li key={sub.href}>
                            <Link
                              href={sub.href}
                              className={`${LINK} block rounded-[var(--radius-sm)] px-2 py-1`}
                            >
                              {sub.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <Link key={item.href} href={item.href} className={LINK}>
                    {item.label}
                  </Link>
                ),
              )}
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
