import type { Platform, Role } from "@/lib/types";


export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
};

export const PLATFORM_TONES: Record<Platform, string> = {
  youtube:
    "border-red-200 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400",
  facebook:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400",
};

export const EXTERNAL_ID_HINT: Record<Platform, string> = {
  youtube: "Channel ID, e.g. UCxxxxxxxxxxxxxxxxxxxxxx",
  facebook: "Page ID, e.g. 1234567890",
};

/** Which roles may manage a channel on this platform (founders set this under Settings → Roles). */
export function canManage(role: Role, platform: Platform): boolean {
  return platform === "youtube" ? role.can_manage_youtube : role.can_manage_facebook;
}

/** Short summary of what a role may do, e.g. "YouTube · Facebook · Leads a team". */
export function roleAbilities(role: Role): string {
  const parts = [
    role.can_manage_youtube && "YouTube",
    role.can_manage_facebook && "Facebook",
    role.can_lead_team && "Leads a team",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No channel duties";
}
