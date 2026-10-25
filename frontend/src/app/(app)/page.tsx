"use client";

import {
  AlertTriangle,
  Banknote,
  Building2,
  Coins,
  Landmark,
  LayoutGrid,
  MonitorPlay,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { MonthPicker } from "@/components/month-picker";
import { Notice } from "@/components/notice";
import { PageHeader } from "@/components/page-header";
import { useOrganization, useSession } from "@/components/session-provider";
import { StatCard } from "@/components/stat-card";
import { DashboardChannelsSection } from "@/components/dashboard-channels";
import { DashboardOverview } from "@/components/dashboard-overview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { compactInr, formatMonth, money } from "@/lib/finance";
import type { Dashboard, GroupDashboard } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PageLoader } from "@/components/loader";

function GroupView({ month, onMonth }: { month: string | null; onMonth: (m: string) => void }) {
  const { switchOrganization } = useSession();
  const [data, setData] = useState<GroupDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<GroupDashboard>(`/dashboard/group${month ? `?month=${month}` : ""}`)
      .then((d) => {
        setData(d);
        onMonth(d.month);
      })
      .catch((err: Error) => setError(err.message));
  }, [month, onMonth]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!data) return <PageLoader />;
  const cell = (v: string, cur: string) => (cur === "INR" ? compactInr(v) : money(v, cur));

  return (
    <div className="space-y-6">
      {data.total && data.currency && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Group gross" value={cell(data.total.gross, data.currency)} icon={Coins} tone="slate" />
          <StatCard label="Group net after CMS" value={cell(data.total.net, data.currency)} icon={Landmark} />
          <StatCard label="Group cash received" value={cell(data.total.received, data.currency)} icon={Banknote} tone="green" />
          <StatCard label="Group outstanding" value={cell(data.total.outstanding, data.currency)} icon={AlertTriangle} tone="amber" />
        </div>
      )}
      {!data.total && <Notice kind="info">Companies report in different currencies, so there is no combined total.</Notice>}
      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company · {formatMonth(data.month)}</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">CMS fee</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Received</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.companies.map((c) => (
              <TableRow key={c.organization_id}>
                <TableCell>
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.closed ? "Month closed" : "Month open"}
                    {!c.complete && " · numbers incomplete"}
                  </p>
                </TableCell>
                <TableCell className="text-right">{cell(c.gross, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.fee, c.base_currency)}</TableCell>
                <TableCell className="text-right font-semibold">{cell(c.net, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.received, c.base_currency)}</TableCell>
                <TableCell className="text-right">{cell(c.outstanding, c.base_currency)}</TableCell>
                <TableCell className="text-right">
                  {c.current ? (
                    <span className="text-xs text-muted-foreground">Current</span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => switchOrganization(c.organization_id)}>
                      Open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type Tab = "overview" | "channels" | "group";
type Range = "month" | "last30" | "custom";

function DashboardPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { me } = useSession();
  const organization = useOrganization();
  const tab: Tab =
    params.get("view") === "group" || params.get("tab") === "group" ? "group" : params.get("tab") === "channels" ? "channels" : "overview";
  const view = tab === "group" ? "group" : "company";
  const range = (params.get("range") as Range | null) ?? "month";
  const [from, setFrom] = useState(params.get("start") ?? "");
  const [to, setTo] = useState(params.get("end") ?? "");
  const requested = params.get("month");
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [groupMonth, setGroupMonth] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "company") return;
    setData(null);
    setError(null);
    api<Dashboard>(`/dashboard${requested ? `?month=${requested}` : ""}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [requested, view, organization.id]);

  const month = requested ?? (view === "group" ? groupMonth : data?.month) ?? null;
  function go(change: { month?: string; tab?: Tab; range?: Range; start?: string; end?: string }) {
    const next = new URLSearchParams(params);
    next.delete("view");
    if (change.month) next.set("month", change.month);
    if (change.tab) {
      if (change.tab === "overview") next.delete("tab");
      else next.set("tab", change.tab);
      if (!next.get("month") && month) next.set("month", month);
    }
    if (change.range) {
      if (change.range === "month") next.delete("range");
      else next.set("range", change.range);
    }
    if (change.start !== undefined) next.set("start", change.start);
    if (change.end !== undefined) next.set("end", change.end);
    router.replace(`/?${next}`);
  }

  // The channel tab can look at any dates; the money tabs are monthly (they follow month close).
  const last30: [string, string] = (() => {
    const end = new Date(Date.now() - 86_400_000);
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return [iso(new Date(end.getTime() - 29 * 86_400_000)), iso(end)];
  })();
  const channelRange: { start?: string; end?: string } =
    range === "last30" ? { start: last30[0], end: last30[1] } : range === "custom" && from && to ? { start: from, end: to } : {};
  const tabs: [Tab, string, React.ComponentType<{ className?: string }>][] = [
    ["overview", "Overview", LayoutGrid],
    ["channels", "Channels", MonitorPlay],
    ...(me.organizations.length > 1 ? ([["group", "All companies", Building2]] as [Tab, string, React.ComponentType<{ className?: string }>][]) : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${me.user.full_name.split(" ")[0]}`}
        description={
          view === "group"
            ? "All your companies side by side."
            : `${organization.name} — money and operations on one screen.`
        }
      />

      <div className="sticky top-20 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card/90 p-2 shadow-sm backdrop-blur">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Dashboard">
          {tabs.map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => go({ tab: key })}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors",
                tab === key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "channels" && (
            <NativeSelect aria-label="Period" className="w-40" value={range} onChange={(e) => go({ range: e.target.value as Range })}>
              <option value="month">A month</option>
              <option value="last30">Last 30 days</option>
              <option value="custom">Choose dates</option>
            </NativeSelect>
          )}
          {tab === "channels" && range === "custom" ? (
            <>
              <Input aria-label="From" type="date" className="w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-sm text-muted-foreground">to</span>
              <Input aria-label="To" type="date" className="w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              <Button size="sm" disabled={!from || !to} onClick={() => go({ start: from, end: to })}>
                Apply
              </Button>
            </>
          ) : (
            (tab !== "channels" || range === "month") && month && <MonthPicker month={month} onChange={(m) => go({ month: m })} />
          )}
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}

      {tab === "group" ? (
        <GroupView month={requested} onMonth={setGroupMonth} />
      ) : tab === "channels" ? (
        <DashboardChannelsSection
          month={month}
          {...(range === "custom" ? { start: params.get("start") ?? undefined, end: params.get("end") ?? undefined } : channelRange)}
        />
      ) : data ? (
        <DashboardOverview data={data} />
      ) : (
        !error && <PageLoader />
      )}
    </div>
  );
}

export default function DashboardPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <DashboardPage />
    </Suspense>
  );
}
