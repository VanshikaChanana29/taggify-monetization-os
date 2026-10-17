import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Monetization OS",
  description: "Rights, channels, revenue and payouts in one place.",
};

const NAV = ["Dashboard", "Deals", "Channels", "CMS & Finance", "People", "Approvals"];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <div className="flex min-h-screen bg-muted/40">
          <aside className="hidden w-56 shrink-0 border-r bg-background p-4 md:block">
            <p className="text-sm font-bold tracking-widest text-emerald-700">TAGGIFY</p>
            <p className="mb-6 text-xs text-muted-foreground">Monetization OS</p>
            <nav className="space-y-1">
              {NAV.map((item) => (
                <span
                  key={item}
                  className="block rounded-md px-3 py-2 text-sm text-muted-foreground"
                >
                  {item}
                </span>
              ))}
            </nav>
          </aside>
          <div className="flex flex-1 flex-col">
            <header className="flex h-14 items-center justify-between border-b bg-background px-6">
              {/* Company switcher (Taggify / Sociodoor) arrives in Part 1 */}
              <span className="text-sm font-medium">Company: —</span>
              <span className="text-xs text-muted-foreground">Setup build</span>
            </header>
            <main className="flex-1 p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
