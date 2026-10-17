"use client";

import { Check, Copy, LogIn } from "lucide-react";
import { useState } from "react";

type DevLogin = { label: string; email: string; password: string };

// Inlined at build time. The NODE_ENV check means a production build never shows
// this panel, even if NEXT_PUBLIC_DEV_LOGINS is set by mistake.
function devLogins(): DevLogin[] {
  if (process.env.NODE_ENV !== "development") return [];
  return (process.env.NEXT_PUBLIC_DEV_LOGINS ?? "")
    .split(";")
    .map((entry) => entry.split("|").map((part) => part.trim()))
    .filter((parts) => parts.length === 3 && parts.every(Boolean))
    .map(([label, email, password]) => ({ label, email, password }));
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        if (await copyText(value)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Local-dev helper under the login form: demo accounts with copy and one-click fill. */
export function DevLogins({ onUse }: { onUse: (email: string, password: string) => void }) {
  const logins = devLogins();
  if (logins.length === 0) return null;

  return (
    <div className="mt-6 rounded-2xl border border-dashed border-orange-300 bg-orange-50/60 p-4 dark:border-orange-500/30 dark:bg-orange-500/5">
      <p className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
        Dev logins · local only
      </p>
      <ul className="mt-3 space-y-3">
        {logins.map((login) => (
          <li key={login.email} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="font-semibold">{login.label}</p>
              <p className="flex items-center gap-1 text-muted-foreground">
                <span className="truncate">{login.email}</span>
                <CopyButton value={login.email} label="email" />
              </p>
              <p className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                {login.password}
                <CopyButton value={login.password} label="password" />
              </p>
            </div>
            <button
              type="button"
              onClick={() => onUse(login.email, login.password)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:border-primary hover:text-primary"
            >
              <LogIn className="h-3.5 w-3.5" />
              Use
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
