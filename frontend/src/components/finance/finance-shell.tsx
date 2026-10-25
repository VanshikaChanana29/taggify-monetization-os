"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { MonthPicker } from "@/components/month-picker";
import { PageHeader } from "@/components/page-header";
import { Tabs } from "@/components/ui/tabs";
import { shiftMonth, thisMonth } from "@/lib/finance";

type FinanceTab = "overview" | "revenue" | "fx" | "incentives" | "close";

const TABS: { key: FinanceTab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "/finance" },
  { key: "revenue", label: "Revenue", path: "/finance/revenue" },
  { key: "fx", label: "FX rates", path: "/finance/fx" },
  { key: "incentives", label: "Incentives", path: "/finance/incentives" },
  { key: "close", label: "Month close", path: "/finance/close" },
];

/** The month every finance tab shows, kept in the URL (?month=2026-09) so it survives switching tabs. */
export function useFinanceMonth(): [string, (month: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const month = params.get("month") ?? shiftMonth(thisMonth(), -1);
  const setMonth = useCallback(
    (m: string) => {
      const next = new URLSearchParams(params);
      next.set("month", m);
      router.replace(`${pathname}?${next}`, { scroll: false });
    },
    [params, pathname, router],
  );
  return [month, setMonth];
}

function tabFor(pathname: string): FinanceTab {
  const match = TABS.find((t) => t.path !== "/finance" && pathname.startsWith(t.path));
  return match?.key ?? "overview"; // /finance and /finance/<cms> both sit under Overview
}

export function FinanceShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [month, setMonth] = useFinanceMonth();
  const tab = tabFor(pathname);

  return (
    <div className="space-y-6">
      <PageHeader
        title="CMS & Finance"
        description="From what the channels earn to what reaches the bank — per CMS, per month."
        actions={tab !== "fx" ? <MonthPicker month={month} onChange={setMonth} /> : undefined}
      />
      <Tabs
        value={tab}
        onChange={(key) => router.push(`${TABS.find((t) => t.key === key)!.path}?month=${month}`)}
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
      />
      {children}
    </div>
  );
}
