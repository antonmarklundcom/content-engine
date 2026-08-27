import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Engine",
  description: "Research, ideas, and copy for social media — per brand.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <a href="/" className="brand-mark">Content Engine</a>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
