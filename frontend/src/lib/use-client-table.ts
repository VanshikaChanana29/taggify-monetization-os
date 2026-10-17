"use client";

import { useEffect, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir };
export type SortValue = string | number | null | undefined;

function isEmpty(value: SortValue): boolean {
  return value === null || value === undefined || value === "";
}

function compare(a: SortValue, b: SortValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: "base", numeric: true });
}

/** Turns an ISO timestamp into a sortable number (null stays empty). */
export function timeValue(iso: string | null): number | null {
  return iso ? Date.parse(iso) : null;
}

/**
 * Sorting + pagination in the browser, for small bounded lists (users, companies).
 * Filter the rows yourself before passing them in; pass `resetKey` (e.g. the filter
 * values joined) so the table jumps back to page 1 when filters change.
 * Lists that grow without bound use server-side pagination instead (see Activity).
 */
export function useClientTable<T, S extends Record<string, (row: T) => SortValue>>({
  rows,
  sortBy,
  initialSort,
  initialPageSize = 10,
  resetKey = "",
}: {
  rows: T[];
  sortBy: S;
  initialSort: SortState<keyof S & string>;
  initialPageSize?: number;
  resetKey?: string;
}) {
  type K = keyof S & string;
  const [sort, setSort] = useState<SortState<K>>(initialSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  useEffect(() => setPage(1), [resetKey, pageSize, sort.key, sort.dir]);

  const sorted = useMemo(() => {
    const get = sortBy[sort.key];
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((x, y) => {
      const a = get(x);
      const b = get(y);
      // Empty values always go last, whichever way the column is sorted.
      if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b));
      return dir * compare(a, b);
    });
  }, [rows, sortBy, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount);

  function toggleSort(key: K) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return {
    pageRows: sorted.slice((current - 1) * pageSize, current * pageSize),
    total: sorted.length,
    sort,
    toggleSort,
    page: current,
    setPage,
    pageSize,
    setPageSize,
  };
}
