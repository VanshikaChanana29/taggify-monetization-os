"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight, CirclePlay, Clock, Eye, IndianRupee, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { DEFAULT_PAGE_SIZE, EmptyRow, SearchInput, SortableHead, TablePagination } from "@/components/data-table";
import { InlineLoader, LoadingOverlay } from "@/components/loader";
import { InfoTip } from "@/components/ui/info-tip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { formatMonth, money } from "@/lib/finance";
import { formatDateTime } from "@/lib/format";
import type { ChannelRankRow, DashboardChannels, RankedChannel } from "@/lib/types";
import { useClientTable } from "@/lib/use-client-table";
import { cn } from "@/lib/utils";

const SLICE_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];
const OTHER = "var(--series-other)";

const usd = (v: string | number) => money(v, "USD");
const compact = (n: number) => new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const shortDay = (d: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(d));

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * step).find((m) => m >= v) ?? v;
}

// Width and height of a box that is sized by its card (the chart fills whatever room the row gives it).
function useBox(fallback: [number, number]) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox([Math.max(260, e.contentRect.width), Math.max(fallback[1], e.contentRect.height)]));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el]);
  return [setEl, box[0], box[1]] as const;
}

function Toggle<K extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: K;
  options: [K, string][];
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs font-medium" role="group" aria-label={label}>
      {options.map(([k, text]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "rounded-md px-2.5 py-1 transition-colors",
            value === k ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function Change({ pct, className }: { pct: string | null; className?: string }) {
  if (pct === null) return <span className={cn("text-muted-foreground", className)}>—</span>;
  const n = Number(pct);
  const Icon = n >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-semibold tabular-nums",
        n >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {Math.abs(n)}%
    </span>
  );
}

// ---- Daily line ------------------------------------------------------------------------------

const LINE_H = 220;
const LPAD = { top: 18, right: 64, bottom: 26, left: 52 };

function DailyChart({ data }: { data: DashboardChannels }) {
  const router = useRouter();
  const [measure, setMeasure] = useState<"revenue" | "views">("revenue");
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width, height] = useBox([640, LINE_H]);
  const points = data.daily.map((d) => ({ day: d.day, v: measure === "revenue" ? Number(d.revenue) : d.views }));
  const fmt = (v: number) => (measure === "revenue" ? (v >= 1000 ? `$${compact(v)}` : usd(v)) : compact(v));
  const tick = (v: number) => (measure === "revenue" ? `$${compact(Math.round(v))}` : compact(v));
  const max = niceMax(Math.max(0, ...points.map((p) => p.v)));
  const plotW = width - LPAD.left - LPAD.right;
  const plotH = height - LPAD.top - LPAD.bottom;
  const last = points.length - 1;
  const x = (i: number) => LPAD.left + (points.length > 1 ? (i / last) * plotW : plotW / 2);
  const y = (v: number) => LPAD.top + plotH - (v / max) * plotH;
  const line = points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  const area = points.length ? `${x(0)},${y(0)} ${line} ${x(last)},${y(0)}` : "";
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 70))));
  const best = points.reduce((b, p, i) => (p.v > (points[b]?.v ?? -1) ? i : b), 0);

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">{measure === "revenue" ? "Revenue each day" : "Views each day"}</h3>
          <p className="text-sm text-muted-foreground">
            All connected YouTube channels · {measure === "revenue" ? "YouTube estimate, USD" : "views"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Toggle
            label="Measure"
            value={measure}
            onChange={setMeasure}
            options={[
              ["revenue", "Revenue"],
              ["views", "Views"],
            ]}
          />
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setAsTable((v) => !v)}>
            {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </div>
      {points.length === 0 ? (
        <p className="mt-10 mb-6 text-center text-sm text-muted-foreground">No daily YouTube data for this month yet.</p>
      ) : asTable ? (
        <div className="mt-4 max-h-80 min-h-0 flex-1 overflow-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Views</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.daily.map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{shortDay(d.day)}</TableCell>
                  <TableCell className="text-right tabular-nums">{usd(d.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.views.toLocaleString("en-IN")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div ref={ref} className="relative mt-4 min-h-[220px] flex-1">
          <svg width={width} height={height} className="absolute inset-0" role="img" aria-label={`${measure} each day, ${periodLabel(data.start, data.end)}`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={LPAD.left} x2={LPAD.left + plotW} y1={y(f * max)} y2={y(f * max)} className="stroke-border" strokeWidth={1} />
                <text x={LPAD.left - 8} y={y(f * max)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
                  {tick(f * max)}
                </text>
              </g>
            ))}
            {points.map((p, i) =>
              (i % labelEvery === 0 && last - i >= labelEvery / 2) || i === last ? (
                <text key={p.day} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                  {shortDay(p.day)}
                </text>
              ) : null,
            )}
            <polygon points={area} fill="var(--series-1)" fillOpacity={0.1} />
            <polyline points={line} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={LPAD.top} y2={LPAD.top + plotH} className="stroke-muted-foreground/40" strokeWidth={1} />
            )}
            {[best, last].map((i, k) =>
              k === 1 && i === best ? null : (
                <g key={`${k}-${i}`}>
                  <circle cx={x(i)} cy={y(points[i].v)} r={4.5} fill="var(--series-1)" className="stroke-card" strokeWidth={2} />
                  <text
                    x={x(i) + (i === last ? 8 : 0)}
                    y={y(points[i].v) - 10}
                    textAnchor={i === last ? "start" : "middle"}
                    className="fill-foreground text-[11px] font-semibold"
                  >
                    {fmt(points[i].v)}
                  </text>
                </g>
              ),
            )}
            {hover !== null && <circle cx={x(hover)} cy={y(points[hover].v)} r={5} fill="var(--series-1)" className="stroke-card" strokeWidth={2} />}
            <rect
              x={LPAD.left}
              y={LPAD.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              className="cursor-pointer"
              onClick={() => {
                if (hover === null) return;
                const day = data.daily[hover].day;
                router.push(`/channels?start=${day}&end=${day}&sort=${measure === "views" ? "views" : "revenue"}`);
              }}
              onMouseMove={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                const i = Math.round(((e.clientX - box.left) / box.width) * last);
                setHover(Math.min(last, Math.max(0, i)));
              }}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
              style={{ left: Math.min(Math.max(x(hover) - 70, 0), width - 150) }}
            >
              <p className="font-semibold">{shortDay(data.daily[hover].day)}</p>
              <p className="tabular-nums">Revenue {usd(data.daily[hover].revenue)}</p>
              <p className="tabular-nums text-muted-foreground">{data.daily[hover].views.toLocaleString("en-IN")} views</p>
              <p className="mt-1 font-medium text-primary">Click to see that day&apos;s channels</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---- Donut: who earns what ----------------------------------------------------------------------

function polar(cx: number, cy: number, r: number, a: number) {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

function arc(cx: number, cy: number, r: number, inner: number, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const [x2, y2] = polar(cx, cy, inner, a1);
  const [x3, y3] = polar(cx, cy, inner, a0);
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${inner},${inner} 0 ${large} 0 ${x3},${y3} Z`;
}

function ShareDonut({ data }: { data: DashboardChannels }) {
  const router = useRouter();
  const [by, setBy] = useState<"cms" | "team" | "deal">("cms");
  const [hover, setHover] = useState<number | null>(null);
  const slices = data.share_by[by];
  const total = slices.reduce((s, x) => s + Number(x.revenue), 0);
  const size = 168;
  const c = size / 2;
  let angle = 0;
  const gap = slices.length > 1 ? 0.025 : 0;
  // Open the channel list for this slice, over the same dates (team uses ?team=, deal ?deal=…).
  const drill = (key: string | null) => `/channels?start=${data.start}&end=${data.end}&sort=revenue${key ? `&${by}=${key}` : ""}`;
  const color = (label: string, i: number) => (label.startsWith("Other") ? OTHER : SLICE_COLORS[i % SLICE_COLORS.length]);

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Who earns what</h3>
          <p className="text-sm text-muted-foreground">Share of revenue, {periodLabel(data.start, data.end)}</p>
        </div>
        <Toggle
          label="Group by"
          value={by}
          onChange={setBy}
          options={[
            ["cms", "CMS"],
            ["team", "Team"],
            ["deal", "Deal"],
          ]}
        />
      </div>
      {total === 0 ? (
        <p className="mt-10 mb-6 text-center text-sm text-muted-foreground">No revenue this month yet.</p>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-5">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Revenue by ${by}`} className="shrink-0">
            {slices.map((s, i) => {
              const part = (Number(s.revenue) / total) * Math.PI * 2;
              const a0 = angle + gap / 2;
              const a1 = angle + Math.max(part - gap / 2, a0 + 0.001);
              angle += part;
              return (
                <path
                  key={s.label}
                  d={arc(c, c, hover === i ? c : c - 4, c - 34, a0, a1 >= a0 + Math.PI * 2 - 0.01 ? a0 + Math.PI * 2 - 0.01 : a1)}
                  fill={color(s.label, i)}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => router.push(drill(s.key))}
                  className="cursor-pointer"
                />
              );
            })}
            <text x={c} y={c - 4} textAnchor="middle" className="fill-foreground text-[15px] font-bold">
              {hover === null ? usd(total) : `${Math.round((Number(slices[hover].revenue) / total) * 100)}%`}
            </text>
            <text x={c} y={c + 14} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {hover === null ? "total" : slices[hover].label.slice(0, 16)}
            </text>
          </svg>
          <ul className="w-full min-w-0 space-y-2 text-sm">
            {slices.map((s, i) => {
              const share = Math.round((Number(s.revenue) / total) * 100);
              return (
                <li
                  key={s.label}
                  role="link"
                  tabIndex={0}
                  onClick={() => router.push(drill(s.key))}
                  onKeyDown={(e) => e.key === "Enter" && router.push(drill(s.key))}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1", hover === i && "bg-muted/60")}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(s.label, i) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={s.label}>
                    {s.label}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{share}%</span>
                  <span className="w-20 text-right font-semibold tabular-nums">{usd(s.revenue)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// ---- Top 10 bars --------------------------------------------------------------------------------

export function TopChannels({ rows, scope }: { rows: RankedChannel[]; scope: string }) {
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue)));
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Trophy className="h-5 w-5 text-amber-500" />
            Top 5 channels
          </h3>
          <p className="text-sm text-muted-foreground">Highest revenue in the period</p>
        </div>
        <Link href={`/channels?${scope}&sort=revenue`} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          All <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="mt-10 mb-6 text-center text-sm text-muted-foreground">No channel revenue this month yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {rows.slice(0, 5).map((r, i) => (
            <li key={r.channel_id}>
              <Link href={`/channels/${r.channel_id}`} className="group block">
                <span className="flex items-center gap-3 text-sm">
                  <span className="w-4 text-right tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-medium group-hover:text-primary" title={r.name}>
                    {r.name}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{usd(r.revenue)}</span>
                </span>
                <span className="ml-7 mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full transition-opacity group-hover:opacity-80"
                    style={{ width: `${Math.max(3, (Number(r.revenue) / max) * 100)}%`, background: "var(--series-1)" }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Movers({ title, rows, falling }: { title: string; rows: RankedChannel[]; falling?: boolean }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        {falling ? (
          <ArrowDownRight className="h-5 w-5 text-red-600 dark:text-red-400" />
        ) : (
          <ArrowUpRight className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        )}
        {title}
      </h3>
      <p className="text-sm text-muted-foreground">{falling ? "Biggest drops vs the days before" : "Biggest gains vs the days before"}</p>
      <ul className="mt-4 space-y-[1.15rem]">
        {rows.map((r) => (
          <li key={r.channel_id}>
            <Link href={`/channels/${r.channel_id}`} className="flex min-w-0 items-center gap-3 text-sm hover:text-primary">
              <span className="min-w-0 flex-1 truncate font-medium" title={r.name}>
                {r.name}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="tabular-nums text-muted-foreground">{usd(r.revenue)}</span>
                <Change pct={r.revenue_change_pct} className="w-16 justify-end" />
              </span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-muted-foreground">{falling ? "No channel is down by more than a little." : "Nothing to show yet."}</li>
        )}
      </ul>
    </section>
  );
}

// ---- Period label -------------------------------------------------------------------------------

export function periodLabel(start: string, end: string): string {
  const s0 = new Date(start);
  const e0 = new Date(end);
  const wholeMonth = s0.getDate() === 1 && s0.getMonth() === e0.getMonth() && s0.getFullYear() === e0.getFullYear();
  if (wholeMonth) return formatMonth(start.slice(0, 7));
  const fmt = (d: Date, year: boolean) =>
    new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}) }).format(d);
  return `${fmt(s0, s0.getFullYear() !== e0.getFullYear())} – ${fmt(e0, true)}`;
}

// ---- Colourful tiles ------------------------------------------------------------------------------

const TILE_TONES = {
  orange: "border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 dark:border-orange-500/30 dark:from-orange-500/15 dark:to-amber-500/5",
  sky: "border-sky-200 bg-gradient-to-br from-sky-50 to-cyan-50 dark:border-sky-500/30 dark:from-sky-500/15 dark:to-cyan-500/5",
  violet: "border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:border-violet-500/30 dark:from-violet-500/15 dark:to-fuchsia-500/5",
  emerald: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 dark:border-emerald-500/30 dark:from-emerald-500/15 dark:to-teal-500/5",
  pink: "border-pink-200 bg-gradient-to-br from-pink-50 to-rose-50 dark:border-pink-500/30 dark:from-pink-500/15 dark:to-rose-500/5",
  teal: "border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 dark:border-teal-500/30 dark:from-teal-500/15 dark:to-emerald-500/5",
} as const;
const ICON_TONES = {
  orange: "bg-orange-500 text-white",
  sky: "bg-sky-500 text-white",
  violet: "bg-violet-500 text-white",
  emerald: "bg-emerald-600 text-white",
  pink: "bg-pink-500 text-white",
  teal: "bg-teal-600 text-white",
} as const;

export function Tile({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
  info,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof TILE_TONES;
  href?: string;
  /** Short explanation shown from an (i) next to the label. */
  info?: string;
}) {
  const body = (
    <div className={cn("h-full rounded-2xl border p-5 shadow-sm transition-shadow", TILE_TONES[tone], href && "hover:shadow-md")}>
      <div className="flex items-start justify-between gap-3">
        <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
          {info && <InfoTip text={info} />}
        </p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl shadow-sm", ICON_TONES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

// ---- Full ranking -----------------------------------------------------------------------------------

const MEDALS = [
  "bg-gradient-to-br from-amber-300 to-yellow-500 text-amber-950",
  "bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900",
  "bg-gradient-to-br from-orange-300 to-amber-700 text-white",
];

const RANK_SORT = {
  name: (r: ChannelRankRow) => r.name,
  revenue: (r: ChannelRankRow) => Number(r.revenue),
  share: (r: ChannelRankRow) => Number(r.share_pct),
  change: (r: ChannelRankRow) => (r.revenue_change_pct === null ? null : Number(r.revenue_change_pct)),
  views: (r: ChannelRankRow) => r.views,
  rpm: (r: ChannelRankRow) => (r.rpm === null ? null : Number(r.rpm)),
  watch: (r: ChannelRankRow) => (r.watch_hours === null ? null : Number(r.watch_hours)),
  subs: (r: ChannelRankRow) => r.subscribers_net,
};

function ChannelRanking({ rows, label }: { rows: DashboardChannels["rows"]; label: string }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = rows.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || (r.cms_name ?? "").toLowerCase().includes(q) || (r.team ?? "").toLowerCase().includes(q),
  );
  const rank = new Map(rows.map((r, i) => [r.channel_id, i + 1]));
  const table = useClientTable({
    rows: filtered,
    sortBy: RANK_SORT,
    initialSort: { key: "revenue", dir: "desc" },
    initialPageSize: DEFAULT_PAGE_SIZE,
    resetKey: q,
  });
  const router = useRouter();
  const maxShare = Math.max(1, ...rows.map((r) => Number(r.share_pct)));

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-gradient-to-r from-primary/10 via-transparent to-transparent px-6 py-5">
        <div>
          <h3 className="text-lg font-semibold">Every channel, ranked</h3>
          <p className="text-sm text-muted-foreground">
            {rows.length} channels with revenue · {label} · click a column to sort
          </p>
        </div>
        <div className="w-full max-w-xs">
          <SearchInput value={query} onChange={setQuery} placeholder="Find a channel, CMS or team…" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Rank</TableHead>
              <SortableHead label="Channel" sortKey="name" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="Revenue" sortKey="revenue" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Share" sortKey="share" sort={table.sort} onSort={table.toggleSort} />
              <SortableHead label="vs before" sortKey="change" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Views" sortKey="views" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="RPM" sortKey="rpm" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Watch hrs" sortKey="watch" sort={table.sort} onSort={table.toggleSort} className="text-right" />
              <SortableHead label="Subs +/−" sortKey="subs" sort={table.sort} onSort={table.toggleSort} className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.pageRows.map((r) => {
              const n = rank.get(r.channel_id) ?? 0;
              return (
                <TableRow key={r.channel_id} className="cursor-pointer" onClick={() => router.push(`/channels/${r.channel_id}`)}>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold tabular-nums",
                        n <= 3 ? MEDALS[n - 1] : "bg-muted text-muted-foreground",
                      )}
                    >
                      {n}
                    </span>
                  </TableCell>
                  <TableCell className="min-w-52">
                    <Link href={`/channels/${r.channel_id}`} className="font-semibold hover:text-primary">
                      {r.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">{[r.cms_name, r.team ?? r.manager].filter(Boolean).join(" · ") || "—"}</p>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{usd(r.revenue)}</TableCell>
                  <TableCell className="min-w-40">
                    <div className="flex items-center gap-2">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${(Number(r.share_pct) / maxShare) * 100}%`,
                            background: "linear-gradient(90deg, var(--series-1), var(--series-3))",
                          }}
                        />
                      </span>
                      <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{Number(r.share_pct)}%</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {r.revenue_change_pct === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                          Number(r.revenue_change_pct) >= 0
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400",
                        )}
                      >
                        {Number(r.revenue_change_pct) >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {Math.abs(Number(r.revenue_change_pct))}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{compact(r.views)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.rpm ? usd(r.rpm) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.watch_hours ? compact(Number(r.watch_hours)) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.subscribers_net === null ? "—" : `${r.subscribers_net > 0 ? "+" : ""}${compact(r.subscribers_net)}`}
                  </TableCell>
                </TableRow>
              );
            })}
            {table.total === 0 && (
              <EmptyRow colSpan={9}>{rows.length ? "No channel matches the search." : "No channel revenue in this period."}</EmptyRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TablePagination
        page={table.page}
        pageSize={table.pageSize}
        total={table.total}
        onPageChange={table.setPage}
        onPageSizeChange={table.setPageSize}
        noun="channels"
      />
    </section>
  );
}

// ---- Section ----------------------------------------------------------------------------------------

/** The dashboard's Channels tab: tiles, the daily line, who earns what, best/moving channels and the full ranking. */
export function DashboardChannelsSection({ month, start, end }: { month?: string | null; start?: string; end?: string }) {
  const [data, setData] = useState<DashboardChannels | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = start && end ? `start=${start}&end=${end}` : month ? `month=${month}` : "";
    setLoading(true);
    api<DashboardChannels>(`/dashboard/channels${q ? `?${q}` : ""}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [month, start, end]);

  if (!data) return loading ? <InlineLoader /> : null;
  const nothing = data.channels_with_revenue === 0 && data.daily.length === 0;
  const days = Math.round((Date.parse(data.end) - Date.parse(data.start)) / 86_400_000) + 1;
  const label = periodLabel(data.start, data.end);
  const scope = `start=${data.start}&end=${data.end}`;

  return (
    <section className="relative space-y-8">
      <LoadingOverlay show={loading} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Channels · {label}</h2>
          <p className="text-sm text-muted-foreground">
            Revenue in USD. YouTube figures are estimates until the CMS sheet arrives
            {data.last_sync && <> · last YouTube sync {formatDateTime(data.last_sync)}</>}.
          </p>
        </div>
        <Link href="/channels" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Manage channels <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <Tile
          label="Revenue"
          value={usd(data.revenue)}
          icon={IndianRupee}
          tone="orange"
          href={`/channels?${scope}&sort=revenue`}
          hint={
            <span className="flex flex-wrap items-center gap-1">
              <Change pct={data.revenue_change_pct} /> vs previous {days} days
            </span>
          }
        />
        <Tile
          label="Views"
          value={compact(data.views)}
          icon={Eye}
          tone="sky"
          href={`/channels?${scope}&sort=views`}
          hint={`${data.channels_with_revenue} channels earning`}
        />
        <Tile
          label="RPM"
          value={data.rpm ? usd(data.rpm) : "—"}
          icon={Trophy}
          tone="violet"
          href={`/channels?${scope}&sort=rpm`}
          hint="Revenue per 1,000 views"
        />
        <Tile
          label="Watch hours"
          value={data.watch_hours ? compact(Number(data.watch_hours)) : "—"}
          icon={Clock}
          tone="emerald"
          href={`/channels?${scope}&sort=views`}
          hint="From YouTube"
        />
        <Tile
          label="New subscribers"
          value={data.subscribers_net === null ? "—" : `${data.subscribers_net > 0 ? "+" : ""}${compact(data.subscribers_net)}`}
          icon={Users}
          tone="pink"
          href={`/channels?${scope}&sort=subs`}
          hint="Gained minus lost"
        />
        <Tile
          label="YouTube connected"
          value={`${data.connected} / ${data.youtube_channels}`}
          icon={CirclePlay}
          tone="teal"
          hint={data.expired ? `${data.expired} need a new permission` : "All connections working"}
          href={data.expired ? "/channels?youtube=expired" : "/channels?youtube=connected"}
        />
      </div>

      {nothing ? (
        <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
          <p className="font-semibold">No channel data for {label} yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect YouTube channels from{" "}
            <Link href="/channels" className="font-medium text-primary hover:underline">
              Channels → YouTube data
            </Link>
            , or upload the CMS sheet.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-8 xl:grid-cols-3">
            <DailyChart data={data} />
            <ShareDonut data={data} />
          </div>
          <div className="grid gap-8 lg:grid-cols-3">
            <TopChannels rows={data.top} scope={scope} />
            <Movers title="Rising" rows={data.rising} />
            <Movers title="Falling" rows={data.falling} falling />
          </div>
          <ChannelRanking rows={data.rows} label={label} />
        </>
      )}
    </section>
  );
}
