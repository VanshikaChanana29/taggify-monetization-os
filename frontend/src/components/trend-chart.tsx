"use client";

import { useEffect, useRef, useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { compactInr, formatMonth, money } from "@/lib/finance";
import type { Totals } from "@/lib/types";

type Point = Totals & { month: string };

const SERIES = [
  { key: "gross", label: "Gross earned", color: "var(--series-1)" },
  { key: "net", label: "Net after CMS", color: "var(--series-2)" },
  { key: "received", label: "Cash received", color: "var(--series-3)" },
] as const;

const HEIGHT = 240;
const PAD = { top: 16, right: 112, bottom: 28, left: 56 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((m) => m >= v) ?? v;
}

const shortMonth = (m: string) => formatMonth(m).split(" ")[0].slice(0, 3);

/** Gross, net and cash for the last six months — one axis, three lines (PDF slide 15). */
export function TrendChart({ points, currency }: { points: Point[]; currency: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fmt = (v: string | number) => (currency === "INR" ? compactInr(v) : money(v, currency));
  const max = niceMax(Math.max(...points.flatMap((p) => SERIES.map((s) => Number(p[s.key])))));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length > 1 ? (i / (points.length - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  // End labels: keep at least 14px apart so they never overlap.
  const last = points.length - 1;
  const ends = SERIES.map((s) => ({ ...s, y: y(Number(points[last]?.[s.key] ?? 0)) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const i = Math.round((px / box.width) * (points.length - 1));
    setHover(Math.min(last, Math.max(0, i)));
  }

  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Last six months</h3>
          <p className="text-sm text-muted-foreground">In {currency}, converted at each month&apos;s FX rate.</p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="flex flex-wrap gap-4 text-sm text-muted-foreground" aria-label="Legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
                {s.label}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="text-sm font-medium text-primary hover:underline"
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? "Show chart" : "Show table"}
          </button>
        </div>
      </div>

      {asTable ? (
        <div className="mt-4 overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                {SERIES.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((p) => (
                <TableRow key={p.month}>
                  <TableCell>{formatMonth(p.month)}</TableCell>
                  {SERIES.map((s) => (
                    <TableCell key={s.key} className="text-right">
                      {money(p[s.key], currency)}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div ref={ref} className="relative mt-4">
          <svg width={width} height={HEIGHT} role="img" aria-label="Gross, net and cash received over the last six months">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px]">
                  {fmt(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => (
              <text key={p.month} x={x(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {shortMonth(p.month)}
              </text>
            ))}
            {hover !== null && (
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} className="stroke-muted-foreground/50" strokeWidth={1} />
            )}
            {SERIES.map((s) => (
              <g key={s.key}>
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  points={points.map((p, i) => `${x(i)},${y(Number(p[s.key]))}`).join(" ")}
                />
                {(hover === null ? [last] : [hover]).map((i) => (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(Number(points[i][s.key]))}
                    r={4}
                    fill={s.color}
                    className="stroke-card"
                    strokeWidth={2}
                  />
                ))}
              </g>
            ))}
            {ends.map((s) => (
              <text key={s.key} x={x(last) + 10} y={s.y} dy="0.32em" className="fill-foreground text-[11px] font-medium">
                {s.label.split(" ")[0]} {fmt(points[last][s.key])}
              </text>
            ))}
            <rect
              x={PAD.left - 16}
              y={PAD.top}
              width={plotW + 32}
              height={plotH}
              fill="transparent"
              onMouseMove={onMove}
              onMouseLeave={() => setHover(null)}
            />
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-60 whitespace-nowrap rounded-xl border bg-popover p-3 text-sm shadow-lg"
              style={{ left: x(hover) + 252 > width ? x(hover) - 252 : x(hover) + 12 }}
            >
              <p className="mb-1 font-semibold">{formatMonth(points[hover].month)}</p>
              {SERIES.map((s) => (
                <p key={s.key} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                    {s.label}
                  </span>
                  <span className="font-medium">{money(points[hover][s.key], currency)}</span>
                </p>
              ))}
              {!points[hover].complete && <p className="mt-1 text-xs text-amber-600">Some numbers missing (fee tiers / FX)</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
