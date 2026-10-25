"use client";

import { AlertTriangle, ArrowRight, BadgeCheck, Banknote, Check, ChevronRight, FileSpreadsheet, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { EmptyRow, TablePagination } from "@/components/data-table";
import { Field, INVALID, fieldFor } from "@/components/deal/form-bits";
import { slabSummary } from "@/components/fee-slabs";
import { CmsSlabsPanel } from "@/components/finance/cms-slabs-panel";
import { useFinanceMonth } from "@/components/finance/finance-shell";
import { isPaid, sheetOk } from "@/components/finance/lifecycle";
import { MoneyFlow } from "@/components/finance/money-flow";
import { StatementTab } from "@/components/finance/statement-tab";
import { LoadingOverlay, PageLoader } from "@/components/loader";
import { Notice } from "@/components/notice";
import { Pill } from "@/components/pill";
import { Button } from "@/components/ui/button";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { DEAL_STATUS_TONES, formatDate, todayISO } from "@/lib/deals";
import { formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import { HELP } from "@/lib/help";
import { PLATFORM_LABELS, PLATFORM_TONES } from "@/lib/people";
import type { ChannelListItem, CmsMonthDetail, CmsPartner, FeeSchedule, Page } from "@/lib/types";
import { cn } from "@/lib/utils";
import { YT_STATUS } from "@/lib/youtube";

// The CMS page as the working document lays it out: a header with the contract, currency, channels
// and latest statement, then one tab per part of the CMS's money.
type Tab = "channels" | "slabs" | "gross" | "allocation" | "statements" | "reconciliation" | "receipts" | "outstanding" | "disputes";
const TABS: Tab[] = ["channels", "slabs", "gross", "allocation", "statements", "reconciliation", "receipts", "outstanding", "disputes"];
// Old links (?tab=statement / cash / adjustments) still land on the right tab.
const OLD: Record<string, Tab> = { statement: "statements", cash: "receipts", adjustments: "disputes" };
type Errors = Partial<Record<string, string>>;

function age(days: number): string {
  if (days < 0) return "This month";
  if (days <= 30) return "0–30 days";
  if (days <= 60) return "31–60 days";
  return days <= 90 ? "61–90 days" : "90+ days";
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m, 0);
  return `${month}-${String(d.getDate()).padStart(2, "0")}`;
}

function CmsChannels({ cmsId, month, cmsName }: { cmsId: string; month: string; cmsName: string }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<Page<ChannelListItem> | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({
      cms_partner_id: cmsId,
      page: String(page),
      page_size: String(pageSize),
      start: `${month}-01`,
      end: monthEnd(month),
      sort: "revenue",
      direction: "desc",
    });
    api<Page<ChannelListItem>>(`/channels?${q}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [cmsId, month, page, pageSize]);

  return (
    <section className="relative overflow-hidden rounded-2xl border bg-card shadow-sm">
      <LoadingOverlay show={loading && Boolean(data)} />
      <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
        <div>
          <h3 className="text-lg font-semibold">Channels under {cmsName}</h3>
          <p className="text-sm text-muted-foreground">Every channel this CMS collects for, with its earnings in {formatMonth(month)}.</p>
        </div>
        <Link href={`/channels?cms=${cmsId}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open in Channels <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-14">S.No.</TableHead>
            <TableHead>Channel</TableHead>
            <TableHead>Deal · slot</TableHead>
            <TableHead>Manager</TableHead>
            <TableHead>YouTube</TableHead>
            <TableHead className="text-right">Earned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.items ?? []).map((c, idx) => {
            const yt = c.youtube_status ?? "not_connected";
            return (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => router.push(`/channels/${c.id}`)}>
                <TableCell className="w-14 tabular-nums text-muted-foreground">{(page - 1) * pageSize + idx + 1}</TableCell>
                <TableCell>
                  <p className="font-medium">{c.name}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Pill tone={PLATFORM_TONES[c.platform]}>{PLATFORM_LABELS[c.platform]}</Pill>
                    {c.status === "inactive" && <Pill tone={DEAL_STATUS_TONES.expired}>Inactive</Pill>}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  {c.slots.length ? (
                    c.slots.map((sl) => (
                      <p key={sl.slot_id}>
                        {sl.deal_title} <span className="text-muted-foreground">· {sl.slot_code}</span>
                      </p>
                    ))
                  ) : (
                    <span className="text-muted-foreground">No slot</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">{c.manager?.name ?? <span className="text-muted-foreground">No manager</span>}</TableCell>
                <TableCell>{c.platform === "youtube" ? <Pill tone={YT_STATUS[yt].tone}>{YT_STATUS[yt].label}</Pill> : "—"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{c.metrics?.revenue ? money(c.metrics.revenue, "USD") : "—"}</TableCell>
              </TableRow>
            );
          })}
          {data && data.items.length === 0 && <EmptyRow colSpan={6}>No channels are under {cmsName} yet.</EmptyRow>}
        </TableBody>
      </Table>
      {data && (
        <TablePagination
          page={page}
          pageSize={pageSize}
          total={data.total}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          noun="channels"
        />
      )}
    </section>
  );
}

function CmsMonthPage() {
  const { cmsId } = useParams<{ cmsId: string }>();
  const router = useRouter();
  const params = useSearchParams();
  const [month] = useFinanceMonth();
  const asked = params.get("tab") ?? "";
  const requested = (OLD[asked] ?? asked) as Tab;
  const tab: Tab = TABS.includes(requested) ? requested : "channels";

  const [data, setData] = useState<CmsMonthDetail | null>(null);
  const [cms, setCms] = useState<CmsPartner | null>(null);
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [dialog, setDialog] = useState<"receipt" | "adjustment" | null>(null);
  const [receipt, setReceipt] = useState({ currency: "", amount: "", amount_base: "", received_on: todayISO(), reference: "" });
  const [adjustment, setAdjustment] = useState({ direction: "-1", amount: "", reason: "" });

  const load = useCallback(() => {
    api<CmsMonthDetail>(`/finance/settlements/${cmsId}?month=${month}`)
      .then(setData)
      .catch((err: Error) => setError(err.message));
    if (cmsId !== "none")
      api<CmsPartner[]>("/cms-partners")
        .then((all) => setCms(all.find((c) => c.id === cmsId) ?? null))
        .catch(() => {});
    if (cmsId !== "none")
      api<FeeSchedule[]>(`/cms-partners/${cmsId}/fee-schedules`)
        .then(setSchedules)
        .catch(() => {});
  }, [cmsId, month]);
  useEffect(load, [load]);

  function go(next: Tab) {
    router.replace(`/finance/${cmsId}?month=${month}${next === "channels" ? "" : `&tab=${next}`}`, { scroll: false });
  }

  async function submit(action: () => Promise<unknown>, message: string, rules: [string, string][]) {
    setErrors({});
    try {
      await action();
      setDialog(null);
      setNotice(message);
      setError(null);
      load();
    } catch (err) {
      const text = err instanceof Error ? err.message : "Something went wrong";
      setErrors({ [fieldFor(text, rules, "form")]: text });
    }
  }

  async function remove(path: string, message: string) {
    setError(null);
    try {
      await api(path, { method: "DELETE" });
      setNotice(message);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete");
    }
  }

  if (!data) return error ? <Notice kind="error">{error}</Notice> : <PageLoader />;
  const s = data.summary;
  const cur = s.currency ?? cms?.slabs?.currency ?? "USD";
  const base = data.base_currency;
  const hasCms = cmsId !== "none";
  const hasTax = Number(s.tax) > 0;
  const payCurrencies = Array.from(new Set([cur, "USD", "AED", base]));
  const payCurrency = receipt.currency || payCurrencies[0];
  const preview = payCurrency === cur && s.fx_rate && receipt.amount && cur !== base ? Number(receipt.amount) * Number(s.fx_rate) : null;
  const fxGap = preview !== null && receipt.amount_base ? Number(receipt.amount_base) - preview : null;
  const rateMissing = s.warnings.some((w) => w.includes("rate"));
  const differs = s.statement_net !== null && Number(s.variance ?? 0) !== 0;
  const grossTotal = data.channels.reduce((t, c) => t + Number(c.gross), 0);

  // This month for this CMS, in three steps.
  const steps: {
    key: string;
    title: string;
    status: string;
    done: boolean;
    tab: Tab;
    action: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      key: "sheet",
      title: "CMS statement",
      status: s.statement_net === null ? "Not received yet" : differs ? `Differs by ${money(s.variance, cur)}` : "Matches our numbers",
      done: sheetOk(s),
      tab: differs ? "reconciliation" : "statements",
      action: s.statement_net === null ? "Upload statement" : differs ? "Find the difference" : "View",
      icon: FileSpreadsheet,
    },
    {
      key: "paid",
      title: "Money received",
      status: rateMissing
        ? `Set the ${cur} rate first`
        : isPaid(s)
          ? "Paid in full"
          : Number(s.received) > 0
            ? `${money(s.outstanding, base)} still to come`
            : "Nothing received yet",
      done: isPaid(s),
      tab: "receipts",
      action: "Record payment",
      icon: Banknote,
    },
    {
      key: "settled",
      title: "Settled",
      status: sheetOk(s) && isPaid(s) ? `${formatMonth(month)} is settled` : "After the two steps above",
      done: sheetOk(s) && isPaid(s),
      tab: "outstanding",
      action: "View",
      icon: BadgeCheck,
    },
  ];
  const current = steps.findIndex((x) => !x.done);

  // The slabs that apply to the month on screen (a later change does not re-price it).
  const monthSlabs =
    [...schedules]
      .sort((a, b) => a.effective_from.localeCompare(b.effective_from))
      .filter((x) => x.effective_from <= `${month}-01`)
      .pop() ?? null;
  const facts: [string, React.ReactNode][] = [
    [
      "Tier contract",
      monthSlabs ? (
        <button type="button" className="text-left hover:text-primary" onClick={() => go("slabs")}>
          {slabSummary(monthSlabs)}
          <span className="block text-xs font-normal text-muted-foreground">since {formatMonth(monthSlabs.effective_from.slice(0, 7))}</span>
        </button>
      ) : (
        <button type="button" className="text-amber-700 hover:underline dark:text-amber-400" onClick={() => go("slabs")}>
          Not set — add slabs
        </button>
      ),
    ],
    ["Reporting currency", cur],
    ["Active channels", cms ? cms.channel_count : s.channel_count],
    ["Latest statement", data.latest_statement_month ? formatMonth(data.latest_statement_month) : "None yet"],
  ];

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link href={`/finance/partners?month=${month}`} className="hover:text-primary">
          CMS partners
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="font-medium text-foreground">
          {s.cms_name} · {formatMonth(month)}
        </span>
      </nav>

      <section className="space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">{s.cms_name}</h2>
          {cms && <Pill tone={PLATFORM_TONES[cms.platform]}>{PLATFORM_LABELS[cms.platform]}</Pill>}
        </div>
        {hasCms ? (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {facts.map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-muted/30 px-4 py-3">
                <dt className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">These channels have no CMS, so there is nothing to collect from a partner.</p>
        )}
        {s.warnings.map((w) => (
          <p
            key={w}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
          >
            <AlertTriangle className="h-4 w-4" />
            {w}
            {w.includes("fee schedule") && hasCms && (
              <button type="button" onClick={() => go("slabs")} className="ml-auto font-semibold underline">
                Add slabs
              </button>
            )}
            {w.includes("rate") && (
              <Link href={`/finance/fx?month=${month}`} className="ml-auto font-semibold underline">
                Set FX rate
              </Link>
            )}
          </p>
        ))}

        {hasCms && (
          <ol className="grid gap-3 md:grid-cols-3">
            {steps.map((st, i) => {
              const Icon = st.icon;
              const state = st.done ? "done" : i === current ? "current" : "ahead";
              return (
                <li key={st.key}>
                  <button
                    type="button"
                    onClick={() => go(st.tab)}
                    className={cn(
                      "flex h-full w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors hover:border-primary/50",
                      state === "done" && "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10",
                      state === "current" && "border-primary/60 bg-primary/5",
                      state === "ahead" && "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full",
                        state === "done"
                          ? "bg-emerald-500 text-white"
                          : state === "current"
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {st.done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Icon className="h-4 w-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Step {i + 1}</span>
                      <span className="block font-semibold">{st.title}</span>
                      <span className="block text-sm text-muted-foreground">{st.status}</span>
                      {!st.done && (
                        <span className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary">
                          {st.action} <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}

        <MoneyFlow
          steps={[
            { label: "Gross", value: money(s.gross, cur), info: HELP.grossRevenue, sub: "All its channels together" },
            ...(hasTax ? [{ label: "Tax withheld", value: money(s.tax, cur), op: "−", tone: "minus" as const, info: HELP.taxWithheld }] : []),
            { label: "CMS fee", value: s.fee === null ? "—" : money(s.fee, cur), op: "−", tone: "minus", info: HELP.feeTiers },
            {
              label: "Net receivable",
              value: s.net === null ? "—" : money(s.net, cur),
              op: "=",
              info: HELP.netReceivable,
              sub: cur !== base && s.net_base ? `${money(s.net_base, base)} at the month's rate` : undefined,
            },
            {
              label: "Received",
              value: money(s.received, base),
              op: "−",
              tone: "minus",
              info: HELP.cashReceived,
              sub: Number(s.adjustments) ? `Adjustments ${money(s.adjustments, base)}` : undefined,
            },
            {
              label: "Outstanding",
              value: !hasCms ? "—" : rateMissing ? "Set rate" : money(s.outstanding, base),
              op: "=",
              tone: rateMissing || Number(s.outstanding ?? 0) > 0 ? "warn" : "result",
              info: HELP.outstanding,
            },
          ]}
        />
      </section>

      <Tabs
        value={tab}
        onChange={go}
        tabs={
          hasCms
            ? [
                { key: "channels", label: "Channels", count: cms?.channel_count },
                { key: "slabs", label: "Contract slabs", alert: cms !== null && !monthSlabs },
                { key: "gross", label: "Gross revenue" },
                { key: "allocation", label: "Commission allocation" },
                { key: "statements", label: "Statements", alert: s.statement_net === null },
                { key: "reconciliation", label: "Reconciliation", alert: differs },
                { key: "receipts", label: "Bank receipts", count: data.receipts.length },
                { key: "outstanding", label: "Outstanding", alert: !rateMissing && Number(s.outstanding ?? 0) > 0 },
                { key: "disputes", label: "Disputes", count: data.adjustments.length },
              ]
            : [
                { key: "channels", label: "Channels", count: data.channels.length },
                { key: "gross", label: "Gross revenue" },
              ]
        }
      />
      {error && <Notice kind="error">{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}

      {tab === "channels" && hasCms && <CmsChannels cmsId={cmsId} month={month} cmsName={s.cms_name} />}

      {tab === "slabs" && hasCms && (
        <CmsSlabsPanel
          cmsId={cmsId}
          cmsName={s.cms_name}
          channelCount={cms?.channel_count ?? s.channel_count}
          openNew={params.get("slabs") === "new"}
          onChanged={load}
        />
      )}

      {(tab === "gross" || (tab === "channels" && !hasCms)) && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Gross revenue · {formatMonth(month)}</h3>
            <p className="text-sm text-muted-foreground">What each channel earned before anything is taken off, biggest first.</p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No.</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Content deal</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="w-56">Share</TableHead>
                <TableHead className="text-right">Gross</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data.channels]
                .sort((a, b) => Number(b.gross) - Number(a.gross))
                .map((c, idx) => {
                  const pct = grossTotal ? (Number(c.gross) / grossTotal) * 100 : 0;
                  return (
                    <TableRow key={c.channel_id}>
                      <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell>
                        <Link href={`/channels/${c.channel_id}`} className="font-medium hover:text-primary">
                          {c.channel_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.deals.join(", ") || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{c.views?.toLocaleString("en-IN") ?? "—"}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{money(c.gross, cur)}</TableCell>
                    </TableRow>
                  );
                })}
              {data.channels.length === 0 && <EmptyRow colSpan={6}>No revenue for {formatMonth(month)} yet.</EmptyRow>}
            </TableBody>
            {data.channels.length > 0 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell>{data.channels.length} channel(s)</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right">{money(s.gross, cur)}</TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </section>
      )}

      {tab === "allocation" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Commission allocation</h3>
            <p className="text-sm text-muted-foreground">
              {s.fee === null
                ? "Add the contract slabs to work out the fee."
                : `The fee of ${money(s.fee, cur)} is worked out once on the total of all channels (${s.fee_rule ?? "contract slabs"}), then shared out by each channel's gross${hasTax ? " after tax" : ""}.`}
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">S.No.</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Content deal</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                {hasTax && <TableHead className="text-right">Tax</TableHead>}
                <TableHead className="text-right">Fee share</TableHead>
                <TableHead className="text-right">Net receivable</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((c, idx) => (
                <TableRow key={c.channel_id}>
                  <TableCell className="w-14 tabular-nums text-muted-foreground">{idx + 1}</TableCell>
                  <TableCell>
                    <Link href={`/channels/${c.channel_id}`} className="font-medium hover:text-primary">
                      {c.channel_name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.deals.join(", ") || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(c.gross, cur)}</TableCell>
                  {hasTax && <TableCell className="text-right tabular-nums">{money(c.tax, cur)}</TableCell>}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {c.fee_share === null ? "—" : money(c.fee_share, cur)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{c.net_share === null ? "—" : money(c.net_share, cur)}</TableCell>
                </TableRow>
              ))}
              {data.channels.length === 0 && <EmptyRow colSpan={hasTax ? 7 : 6}>No revenue for {formatMonth(month)} yet.</EmptyRow>}
            </TableBody>
            {data.channels.length > 0 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell />
                  <TableCell>Total</TableCell>
                  <TableCell>{data.channels.length} channel(s)</TableCell>
                  <TableCell className="text-right">{money(s.gross, cur)}</TableCell>
                  {hasTax && <TableCell className="text-right">{money(s.tax, cur)}</TableCell>}
                  <TableCell className="text-right">{s.fee === null ? "—" : money(s.fee, cur)}</TableCell>
                  <TableCell className="text-right">{s.net === null ? "—" : money(s.net, cur)}</TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </section>
      )}

      {(tab === "statements" || tab === "reconciliation") && hasCms && (
        <StatementTab
          part={tab === "statements" ? "statement" : "reconciliation"}
          cmsId={cmsId}
          month={month}
          summary={s}
          statement={data.statement}
          reconciliation={data.reconciliation}
          onSaved={(message) => {
            setNotice(message);
            setError(null);
            load();
          }}
        />
      )}

      {tab === "outstanding" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="p-6 pb-4">
            <h3 className="text-lg font-semibold">Outstanding</h3>
            <p className="text-sm text-muted-foreground">
              What {s.cms_name} still owes, month by month, up to {formatMonth(month)} — and how long it has been waiting since the month ended.
            </p>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Net receivable</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead>Waiting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data.outstanding_by_month ?? []).map((o) => {
                const owed = Number(o.outstanding ?? 0);
                return (
                  <TableRow key={o.month} className="cursor-pointer" onClick={() => router.push(`/finance/${cmsId}?month=${o.month}&tab=receipts`)}>
                    <TableCell className="font-medium">{formatMonth(o.month)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {o.net_base === null ? (
                        <span className="text-xs text-amber-700 dark:text-amber-400">Rate or slabs missing</span>
                      ) : (
                        money(o.net_base, base)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(o.received, base)}</TableCell>
                    <TableCell className={cn("text-right font-semibold tabular-nums", owed > 0 && o.days > 60 && "text-red-600 dark:text-red-400")}>
                      {o.outstanding === null ? "—" : money(o.outstanding, base)}
                    </TableCell>
                    <TableCell>
                      {owed > 0 ? (
                        <Pill tone={o.days > 60 ? DEAL_STATUS_TONES.terminated : o.days > 30 ? DEAL_STATUS_TONES.draft : DEAL_STATUS_TONES.expired}>
                          {age(o.days)}
                        </Pill>
                      ) : o.outstanding === null ? (
                        "—"
                      ) : (
                        <Pill tone={DEAL_STATUS_TONES.active}>Paid</Pill>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(data.outstanding_by_month ?? []).length === 0 && <EmptyRow colSpan={5}>Nothing owed.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {tab === "receipts" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">
                Bank receipts from {s.cms_name}
                <InfoTip text={HELP.receiptCurrency} />
              </h3>
              <p className="text-sm text-muted-foreground">
                For {formatMonth(month)}&apos;s earnings. Each payment clears the balance at the month&apos;s rate.
              </p>
            </div>
            <Button
              onClick={() => {
                setReceipt({ currency: "", amount: "", amount_base: "", received_on: todayISO(), reference: "" });
                setErrors({});
                setDialog("receipt");
              }}
            >
              <Plus />
              Record payment
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received on</TableHead>
                <TableHead className="text-right">They paid</TableHead>
                <TableHead className="text-right">Bank credited</TableHead>
                <TableHead className="text-right">Clears</TableHead>
                <TableHead className="text-right">
                  FX gain / loss
                  <InfoTip text={HELP.fxDifference} />
                </TableHead>
                <TableHead>Reference</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.receipts.map((r) => {
                const fx = r.valued_base !== null && r.currency !== base ? Number(r.amount_base) - Number(r.valued_base) : 0;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(r.received_on)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">{money(r.amount, r.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{money(r.amount_base, base)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right">{money(r.valued_base ?? r.amount_base, base)}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right", fx > 0 && "text-emerald-600", fx < 0 && "text-red-600")}>
                      {fx === 0 ? "—" : money(fx, base)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.reference ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete payment"
                        onClick={() => window.confirm("Delete this payment?") && remove(`/finance/receipts/${r.id}`, "Payment deleted.")}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {data.receipts.length === 0 && <EmptyRow colSpan={7}>Nothing received yet for {formatMonth(month)}.</EmptyRow>}
            </TableBody>
            {data.receipts.length > 0 && (
              <tfoot>
                <TableRow className="bg-muted/60 font-semibold hover:bg-muted/60">
                  <TableCell>Total</TableCell>
                  <TableCell />
                  <TableCell className="text-right">{money(s.received_credited, base)}</TableCell>
                  <TableCell className="text-right">{money(s.received, base)}</TableCell>
                  <TableCell className="text-right">{Number(s.fx_difference) ? money(s.fx_difference, base) : "—"}</TableCell>
                  <TableCell colSpan={2} className="font-normal text-muted-foreground">
                    Outstanding {money(s.outstanding, base)}
                  </TableCell>
                </TableRow>
              </tfoot>
            )}
          </Table>
        </section>
      )}

      {tab === "disputes" && hasCms && (
        <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 p-6 pb-4">
            <div>
              <h3 className="text-lg font-semibold">
                Disputes &amp; corrections
                <InfoTip text={HELP.adjustment} />
              </h3>
              <p className="text-sm text-muted-foreground">
                Tax withheld, chargebacks, disputes, late revisions — anything that changes what {s.cms_name} owes.
              </p>
            </div>
            <Button
              onClick={() => {
                setAdjustment({ direction: "-1", amount: "", reason: "" });
                setErrors({});
                setDialog("adjustment");
              }}
            >
              <Plus />
              Add dispute / correction
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Added</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Effect</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.adjustments.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                  <TableCell>{a.reason}</TableCell>
                  <TableCell>
                    <Pill tone={Number(a.amount) < 0 ? DEAL_STATUS_TONES.terminated : DEAL_STATUS_TONES.active}>
                      {Number(a.amount) < 0 ? "Reduces what they owe" : "Increases what they owe"}
                    </Pill>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-semibold">{money(a.amount, base)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete adjustment"
                      onClick={() => window.confirm("Delete this adjustment?") && remove(`/finance/adjustments/${a.id}`, "Adjustment deleted.")}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {data.adjustments.length === 0 && <EmptyRow colSpan={5}>No disputes or corrections for this month.</EmptyRow>}
            </TableBody>
          </Table>
        </section>
      )}

      {/* ---- Popups ---------------------------------------------------------------------- */}
      <Dialog
        open={dialog === "receipt"}
        onClose={() => setDialog(null)}
        title={`Record a payment from ${s.cms_name}`}
        description={`For ${formatMonth(month)}'s earnings. Check your bank statement for the amount credited.`}
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                api("/finance/receipts", {
                  method: "POST",
                  json: {
                    cms_partner_id: cmsId,
                    month,
                    currency: payCurrency,
                    amount: receipt.amount,
                    amount_base: payCurrency === base ? null : receipt.amount_base,
                    received_on: receipt.received_on,
                    reference: receipt.reference || null,
                  },
                }),
              "Payment recorded.",
              [
                ["credited", "amount_base"],
                ["future", "received_on"],
                ["date", "received_on"],
                ["amount", "amount"],
              ],
            );
          }}
        >
          <Field id="rc-currency" label="They paid in">
            <NativeSelect id="rc-currency" value={payCurrency} onChange={(e) => setReceipt({ ...receipt, currency: e.target.value })}>
              {payCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field id="rc-amount" label={`Amount (${payCurrency}) *`} error={errors.amount}>
            <Input
              id="rc-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={errors.amount ? INVALID : undefined}
              value={receipt.amount}
              onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })}
            />
          </Field>
          {payCurrency !== base && (
            <Field
              id="rc-base"
              label={`Bank credited (${base}) *`}
              error={errors.amount_base}
              hint="Exactly what reached your bank account."
              className="sm:col-span-2"
            >
              <Input
                id="rc-base"
                type="number"
                step="0.01"
                min="0.01"
                required
                className={errors.amount_base ? INVALID : undefined}
                value={receipt.amount_base}
                onChange={(e) => setReceipt({ ...receipt, amount_base: e.target.value })}
              />
            </Field>
          )}
          {preview !== null && (
            <div className="rounded-xl bg-muted/50 p-3 text-sm sm:col-span-2">
              At {formatMonth(month)}&apos;s rate (1 {cur} = {Number(s.fx_rate)} {base}) this clears{" "}
              <span className="font-semibold">{money(preview, base)}</span> of the balance.
              {fxGap !== null && fxGap !== 0 && (
                <span className={fxGap > 0 ? "block text-emerald-600" : "block text-red-600"}>
                  The bank paid {money(Math.abs(fxGap), base)} {fxGap > 0 ? "more" : "less"} — recorded as FX {fxGap > 0 ? "gain" : "loss"}.
                </span>
              )}
            </div>
          )}
          <Field id="rc-date" label="Received on *" error={errors.received_on}>
            <Input
              id="rc-date"
              type="date"
              max={todayISO()}
              required
              className={errors.received_on ? INVALID : undefined}
              value={receipt.received_on}
              onChange={(e) => setReceipt({ ...receipt, received_on: e.target.value })}
            />
          </Field>
          <Field id="rc-ref" label="Bank reference (UTR)">
            <Input
              id="rc-ref"
              placeholder="e.g. UTR 1234567890"
              value={receipt.reference}
              onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })}
            />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Record payment</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={dialog === "adjustment"}
        onClose={() => setDialog(null)}
        title="Add a dispute or correction"
        description={`Changes what ${s.cms_name} owes for ${formatMonth(month)}, in ${base}.`}
      >
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(
              () =>
                api("/finance/adjustments", {
                  method: "POST",
                  json: {
                    cms_partner_id: cmsId,
                    month,
                    amount: (Number(adjustment.direction) * Number(adjustment.amount)).toFixed(2),
                    reason: adjustment.reason,
                  },
                }),
              "Dispute / correction added.",
              [
                ["amount", "amount"],
                ["zero", "amount"],
                ["reason", "reason"],
              ],
            );
          }}
        >
          <Field id="adj-dir" label="Effect" className="sm:col-span-2">
            <NativeSelect id="adj-dir" value={adjustment.direction} onChange={(e) => setAdjustment({ ...adjustment, direction: e.target.value })}>
              <option value="-1">Reduces what they owe (tax withheld, chargeback, dispute)</option>
              <option value="1">Increases what they owe (late revenue, correction in our favour)</option>
            </NativeSelect>
          </Field>
          <Field id="adj-amount" label={`Amount (${base}) *`} error={errors.amount}>
            <Input
              id="adj-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={errors.amount ? INVALID : undefined}
              value={adjustment.amount}
              onChange={(e) => setAdjustment({ ...adjustment, amount: e.target.value })}
            />
          </Field>
          <Field id="adj-reason" label="Reason *" error={errors.reason}>
            <Input
              id="adj-reason"
              required
              maxLength={300}
              placeholder="e.g. TDS withheld"
              className={errors.reason ? INVALID : undefined}
              value={adjustment.reason}
              onChange={(e) => setAdjustment({ ...adjustment, reason: e.target.value })}
            />
          </Field>
          {errors.form && (
            <div className="sm:col-span-2">
              <Notice kind="error">{errors.form}</Notice>
            </div>
          )}
          <div className="sm:col-span-2">
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default function CmsMonthPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CmsMonthPage />
    </Suspense>
  );
}
