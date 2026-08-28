"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The whole-app switcher between the two sections merged into this repo:
 * brand content ideation (content-engine's original pages, at "/") and the
 * ported YouTube research tool (at "/youtube/*"). Deliberately minimal — a
 * couple of tabs, nothing elaborate.
 */
export function TopNav() {
  const pathname = usePathname();
  const onYouTube = pathname === "/youtube" || pathname.startsWith("/youtube/");

  return (
    <nav className="top-nav" aria-label="Sections">
      <Link href="/" className={onYouTube ? "" : "active"}>
        Content
      </Link>
      <Link href="/youtube" className={onYouTube ? "active" : ""}>
        YouTube
      </Link>
    </nav>
  );
}
