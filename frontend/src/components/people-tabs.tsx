"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/people", label: "People" },
  { href: "/people/teams", label: "Teams" },
  { href: "/settings/roles", label: "Roles" },
];

/** People / Teams / Roles switcher shown at the top of those pages. */
export function PeopleTabs() {
  const pathname = usePathname();
  return (
    <div className="inline-flex rounded-xl border bg-muted/60 p-1">
      {TABS.map((t) => {
        const active = t.href === "/people" ? pathname === "/people" : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
              active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
