"use client";

import {
  Building2,
  ClipboardCheck,
  Crown,
  Handshake,
  History,
  Landmark,
  LayoutGrid,
  LogOut,
  MonitorPlay,
  ShieldCheck,
  UserCog,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/brand";
import { ClockChip, ThemeToggle } from "@/components/header-chips";
import { useSession } from "@/components/session-provider";
import { UserAvatar } from "@/components/user-avatar";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";

type NavItem = { label: string; icon: LucideIcon; href?: string };

const COMPANY_NAV: NavItem[] = [
  { label: "Dashboard", icon: LayoutGrid, href: "/" },
  // Built in later parts
  { label: "Deals", icon: Handshake },
  { label: "Channels", icon: MonitorPlay },
  { label: "CMS & Finance", icon: Landmark },
  { label: "People", icon: Users },
  { label: "Approvals", icon: ClipboardCheck },
  { label: "Users", icon: UserCog, href: "/settings/users" },
  { label: "Activity", icon: History, href: "/settings/activity" },
  { label: "My account", icon: UserRound, href: "/settings/account" },
];

const ADMIN_NAV: NavItem[] = [
  { label: "Companies", icon: Building2, href: "/admin/companies" },
  { label: "All users", icon: Users, href: "/admin/users" },
  { label: "My account", icon: UserRound, href: "/settings/account" },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/settings/users": "Users",
  "/settings/activity": "Activity",
  "/settings/account": "My account",
  "/admin/companies": "Companies",
  "/admin/users": "All users",
};

type Mode = "company" | "admin";

function modeFor(me: Me, pathname: string): Mode {
  if (!me.organization) return "admin";
  if (me.user.is_superadmin && pathname.startsWith("/admin")) return "admin";
  return "company";
}

/** Pages that work without a company, and pages only the super admin may open. */
function guard(me: Me, pathname: string): string | null {
  const isAdminPage = pathname.startsWith("/admin");
  if (isAdminPage && !me.user.is_superadmin) return "This page is for the super admin only.";
  if (!isAdminPage && pathname !== "/settings/account" && !me.organization) {
    return "You are not a member of any company. Create one under Companies, then add yourself to it under All users.";
  }
  return null;
}

function ModeSwitch({ mode }: { mode: Mode }) {
  const router = useRouter();
  const tabs: { mode: Mode; label: string; icon: LucideIcon; href: string }[] = [
    { mode: "company", label: "Company", icon: Building2, href: "/" },
    { mode: "admin", label: "Admin", icon: ShieldCheck, href: "/admin/companies" },
  ];
  return (
    <div className="flex rounded-xl border bg-muted/60 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          onClick={() => router.push(tab.href)}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium transition-colors",
            mode === tab.mode
              ? "bg-card text-primary shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <tab.icon className="h-4 w-4" />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** All of the user's companies side by side; the active one is highlighted. */
function CompanyTabs({ me, onSwitch }: { me: Me; onSwitch: (id: string) => void }) {
  const [pending, setPending] = useState<string | null>(null);
  return (
    <div role="tablist" aria-label="Company" className="flex rounded-xl border bg-muted/60 p-1">
      {me.organizations.map((org) => {
        const active = org.id === me.organization?.id;
        return (
          <button
            key={org.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={pending !== null}
            onClick={() => {
              if (active) return;
              setPending(org.id);
              onSwitch(org.id);
            }}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-card hover:text-foreground",
              pending === org.id && "opacity-60",
            )}
          >
            <Building2 className="h-4 w-4" />
            {org.name}
          </button>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { me, logout, switchOrganization } = useSession();
  const mode = modeFor(me, pathname);
  const nav = mode === "admin" ? ADMIN_NAV : COMPANY_NAV;
  const blocked = guard(me, pathname);
  const subtitle =
    mode === "admin" ? "Admin workspace" : `${me.organization?.name ?? ""} workspace`;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-72 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="border-b px-6 py-5">
          <Brand subtitle={subtitle} />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
          {me.user.is_superadmin && me.organization && <ModeSwitch mode={mode} />}
          <nav className="space-y-1">
            {nav.map((item) => {
              const active = item.href === pathname;
              return item.href ? (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-sidebar-foreground hover:bg-sidebar-accent",
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Link>
              ) : (
                <span
                  key={item.label}
                  title="Coming in a later part"
                  className="flex cursor-default items-center gap-3 rounded-xl px-4 py-3 text-[15px] font-medium text-muted-foreground/50"
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                  <span className="ml-auto rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                    Soon
                  </span>
                </span>
              );
            })}
          </nav>
        </div>

        <div className="space-y-3 border-t px-4 py-4">
          <div className="flex items-center gap-3 px-2">
            <UserAvatar name={me.user.full_name} square />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{me.user.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">{me.user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[15px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
          >
            <LogOut className="h-5 w-5" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-20 items-center justify-between gap-4 border-b bg-card/90 px-6 backdrop-blur lg:px-10">
          <h2 className="text-xl font-semibold">{TITLES[pathname] ?? ""}</h2>
          <div className="flex items-center gap-3">
            {me.organizations.length > 1 && (
              <CompanyTabs me={me} onSwitch={switchOrganization} />
            )}
            <ClockChip />
            <ThemeToggle />
            {me.user.is_superadmin && (
              <span className="hidden items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 sm:inline-flex">
                <Crown className="h-4 w-4" />
                Super Admin
              </span>
            )}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold">{me.user.full_name}</p>
              <p className="text-xs text-muted-foreground">
                {me.organization?.name ?? "All companies"}
              </p>
            </div>
            <UserAvatar name={me.user.full_name} square />
          </div>
        </header>
        <main className="flex-1 px-6 py-8 lg:px-10">
          {blocked ? <p className="text-muted-foreground">{blocked}</p> : children}
        </main>
      </div>
    </div>
  );
}
