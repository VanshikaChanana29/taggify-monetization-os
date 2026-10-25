import { DEAL_STATUS_TONES } from "@/lib/deals";
import type { YouTubeStatus } from "@/lib/types";

export const YT_STATUS: Record<YouTubeStatus, { label: string; tone: string }> = {
  ok: { label: "Connected", tone: DEAL_STATUS_TONES.active },
  expired: { label: "Permission expired", tone: DEAL_STATUS_TONES.terminated },
  error: { label: "Error", tone: DEAL_STATUS_TONES.terminated },
  not_connected: { label: "Not connected", tone: DEAL_STATUS_TONES.expired },
};

export function shortDate(d: string | null): string {
  return d
    ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(d))
    : "—";
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function yesterday(): string {
  return isoDay(new Date(Date.now() - 86_400_000));
}

export function firstOfMonth(): string {
  const d = new Date();
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1));
}
