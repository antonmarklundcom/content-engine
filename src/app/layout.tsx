import type { Metadata } from "next";
import { TopNav } from "@/components/TopNav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Engine",
  description: "Research, ideas, and copy for social media — per brand — plus a YouTube research tool.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a href="/" className="brand-mark">Content Engine</a>
            <TopNav />
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
