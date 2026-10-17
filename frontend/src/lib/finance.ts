/** Months are "YYYY-MM" strings everywhere in the finance screens. */

export function thisMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const monthName = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });

export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return monthName.format(new Date(y, m - 1, 1));
}

/** Money with 2 decimals for small amounts, none for large ones. */
export function money(amount: string | number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return "—";
  const n = Number(amount);
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2,
  }).format(n);
}

/** ₹42.5L / ₹1.25Cr style, as on PDF slides 10 and 15. */
export function compactInr(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = Number(amount);
  const sign = n < 0 ? "−" : "";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`;
  return `${sign}₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(abs)}`;
}
