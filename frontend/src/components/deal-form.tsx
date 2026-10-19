"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { InfoTip } from "@/components/ui/info-tip";
import { HELP } from "@/lib/help";
import { api } from "@/lib/api";
import { COUNTRIES, DEAL_TYPE_LABELS, SCOPE_LABELS } from "@/lib/deals";
import type { ContentOwner, Deal, DealType, EpisodeScope, Exclusivity, StoredDealStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

type RangeRow = { season: string; from: string; to: string };

type Form = {
  owner_id: string;
  title: string;
  deal_type: DealType;
  status: StoredDealStatus;
  fee_amount: string;
  currency: string;
  revenue_share_pct: string;
  term_start: string;
  term_end: string;
  episode_scope: EpisodeScope;
  ranges: RangeRow[];
  is_worldwide: boolean;
  territories: string[];
  yt_slot_limit: string;
  fb_slot_limit: string;
  contract_url: string;
  notes: string;
  languages: string;
  exclusivity: Exclusivity | "";
  renewal_terms: string;
  notice_period_days: string;
  clip_restrictions: string;
  agreement_version: string;
};

const PAYS_FEE: DealType[] = ["fixed_fee", "hybrid"];
const SHARES: DealType[] = ["revenue_share", "hybrid", "partnership"];

const EMPTY_RANGE: RangeRow = { season: "", from: "", to: "" };

function fromDeal(deal: Deal | null): Form {
  if (!deal) {
    return {
      owner_id: "",
      title: "",
      deal_type: "fixed_fee",
      status: "active",
      fee_amount: "",
      currency: "INR",
      revenue_share_pct: "",
      term_start: "",
      term_end: "",
      episode_scope: "ranges",
      ranges: [EMPTY_RANGE],
      is_worldwide: true,
      territories: [],
      yt_slot_limit: "0",
      fb_slot_limit: "0",
      contract_url: "",
      notes: "",
      languages: "",
      exclusivity: "",
      renewal_terms: "",
      notice_period_days: "",
      clip_restrictions: "",
      agreement_version: "",
    };
  }
  return {
    owner_id: deal.owner_id,
    title: deal.title,
    deal_type: deal.deal_type,
    status: deal.stored_status,
    fee_amount: deal.fee_amount ? String(Number(deal.fee_amount)) : "",
    currency: deal.currency ?? "INR",
    revenue_share_pct: deal.revenue_share_pct ? String(Number(deal.revenue_share_pct)) : "",
    term_start: deal.term_start,
    term_end: deal.term_end,
    episode_scope: deal.episode_scope,
    ranges: deal.episode_ranges.length
      ? deal.episode_ranges.map((r) => ({
          season: r.season ? String(r.season) : "",
          from: String(r.from_episode),
          to: String(r.to_episode),
        }))
      : [EMPTY_RANGE],
    is_worldwide: deal.is_worldwide,
    territories: deal.territories,
    yt_slot_limit: String(deal.yt_slot_limit),
    fb_slot_limit: String(deal.fb_slot_limit),
    contract_url: deal.contract_url ?? "",
    notes: deal.notes ?? "",
    languages: deal.languages.join(", "),
    exclusivity: deal.exclusivity ?? "",
    renewal_terms: deal.renewal_terms ?? "",
    notice_period_days: deal.notice_period_days === null ? "" : String(deal.notice_period_days),
    clip_restrictions: deal.clip_restrictions ?? "",
    agreement_version: deal.agreement_version ?? "",
  };
}

function toPayload(f: Form) {
  return {
    owner_id: f.owner_id,
    title: f.title,
    deal_type: f.deal_type,
    status: f.status,
    fee_amount: PAYS_FEE.includes(f.deal_type) ? f.fee_amount || null : null,
    currency: PAYS_FEE.includes(f.deal_type) ? f.currency : null,
    revenue_share_pct: SHARES.includes(f.deal_type) ? f.revenue_share_pct || null : null,
    term_start: f.term_start,
    term_end: f.term_end,
    episode_scope: f.episode_scope,
    episode_ranges:
      f.episode_scope === "all"
        ? []
        : f.ranges.map((r) => ({
            season: f.episode_scope === "seasons" ? Number(r.season) : null,
            from_episode: Number(r.from),
            to_episode: Number(r.to),
          })),
    is_worldwide: f.is_worldwide,
    territories: f.is_worldwide ? [] : f.territories,
    yt_slot_limit: Number(f.yt_slot_limit || 0),
    fb_slot_limit: Number(f.fb_slot_limit || 0),
    contract_url: f.contract_url || null,
    notes: f.notes || null,
    languages: f.languages
      .split(",")
      .map((l) => l.trim())
      .filter(Boolean),
    exclusivity: f.exclusivity || null,
    renewal_terms: f.renewal_terms || null,
    notice_period_days: f.notice_period_days === "" ? null : Number(f.notice_period_days),
    clip_restrictions: f.clip_restrictions || null,
    agreement_version: f.agreement_version || null,
  };
}

type FieldKey =
  | "owner_id"
  | "title"
  | "fee_amount"
  | "revenue_share_pct"
  | "term_end"
  | "episodes"
  | "territories"
  | "slots"
  | "contract_url"
  | "notice_period_days"
  | "form";

type Errors = { fields: Partial<Record<FieldKey, string>>; ranges: Record<number, string> };
const NO_ERRORS: Errors = { fields: {}, ranges: {} };

/** Problems the browser can catch before calling the API (which re-checks everything). */
function clientErrors(f: Form): Errors {
  const fields: Errors["fields"] = {};
  const ranges: Errors["ranges"] = {};
  if (f.term_start && f.term_end && f.term_end <= f.term_start) {
    fields.term_end = "Term end must be after term start.";
  }
  if (Number(f.yt_slot_limit || 0) + Number(f.fb_slot_limit || 0) === 0) {
    fields.slots = "Allow at least one YouTube or Facebook slot.";
  }
  const notice = f.notice_period_days === "" ? null : Number(f.notice_period_days);
  if (notice !== null && f.term_start && f.term_end) {
    const days = (Date.parse(f.term_end) - Date.parse(f.term_start)) / 86_400_000;
    if (notice > days) fields.notice_period_days = "Notice period is longer than the whole licence term.";
  }
  if (!f.is_worldwide && f.territories.length === 0) {
    fields.territories = "Choose at least one territory, or tick Worldwide.";
  }
  if (f.episode_scope !== "all") {
    f.ranges.forEach((r, i) => {
      if (r.from && r.to && Number(r.to) < Number(r.from)) {
        ranges[i] = "\u201cTo\u201d must be the same as or higher than \u201cFrom\u201d.";
      }
    });
  }
  return { fields, ranges };
}

/** Server messages -> the field they belong to (anything unmatched shows at the bottom). */
const SERVER_FIELDS: [string, FieldKey][] = [
  ["term end", "term_end"],
  ["licence fee", "fee_amount"],
  ["minimum guarantee", "fee_amount"],
  ["share percentage", "revenue_share_pct"],
  ["revenue share", "revenue_share_pct"],
  ["notice", "notice_period_days"],
  ["episode", "episodes"],
  ["season", "episodes"],
  ["territor", "territories"],
  ["slot", "slots"],
  ["contract link", "contract_url"],
  ["title", "title"],
  ["owner", "owner_id"],
];

function serverErrors(message: string): Errors {
  const fields: Errors["fields"] = {};
  for (const raw of message.split(/,\s*(?=Value error)/)) {
    const text = raw.replace(/^Value error,\s*/, "").trim();
    const key = SERVER_FIELDS.find(([fragment]) => text.toLowerCase().includes(fragment))?.[1] ?? "form";
    fields[key] = fields[key] ? `${fields[key]} ${text}` : text;
  }
  return { fields, ranges: {} };
}

function hasErrors(e: Errors): boolean {
  return Object.keys(e.fields).length > 0 || Object.keys(e.ranges).length > 0;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p data-field-error className="text-sm font-medium text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

const INVALID = "border-red-400 focus-visible:ring-red-400 dark:border-red-500/60";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-6 shadow-sm">
      <h3 className="text-lg font-semibold">{title}</h3>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Record<T, string>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 md:col-span-2">
      {(Object.keys(options) as T[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={cn(
            "rounded-xl border px-4 py-2 text-sm font-semibold transition-colors",
            value === key ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary",
          )}
        >
          {options[key]}
        </button>
      ))}
    </div>
  );
}

export function DealForm({ deal }: { deal: Deal | null }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(() => fromDeal(deal));
  const [owners, setOwners] = useState<ContentOwner[]>([]);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [submitted, setSubmitted] = useState(false);
  const err = errors.fields;
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<ContentOwner[]>("/content-owners").then(setOwners).catch(() => {});
  }, []);

  // After the first submit, re-check as the founder edits so fixed fields clear right away.
  useEffect(() => {
    if (submitted) setErrors(clientErrors(form));
  }, [form, submitted]);

  const set = (change: Partial<Form>) => setForm((f) => ({ ...f, ...change }));
  const setRange = (i: number, change: Partial<RangeRow>) =>
    set({ ranges: form.ranges.map((r, j) => (j === i ? { ...r, ...change } : r)) });

  const selectable = owners.filter((o) => o.is_active || o.id === deal?.owner_id);

  function showErrors(next: Errors) {
    setErrors(next);
    // Bring the first problem into view once it has rendered.
    requestAnimationFrame(() =>
      document.querySelector("[data-field-error]")?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    const problems = clientErrors(form);
    if (hasErrors(problems)) return showErrors(problems);
    setErrors(NO_ERRORS);
    setSaving(true);
    try {
      const saved = await api<Deal>(deal ? `/deals/${deal.id}` : "/deals", {
        method: deal ? "PUT" : "POST",
        json: toPayload(form),
      });
      router.push(`/deals/${saved.id}`);
    } catch (err) {
      showErrors(serverErrors(err instanceof Error ? err.message : "Could not save the deal"));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Section title="Deal" hint="Fields marked * are required.">
        <div className="space-y-2">
          <Label htmlFor="owner">Content owner * <InfoTip text={HELP.owner} /></Label>
          <NativeSelect
            id="owner"
            required
            className={err.owner_id ? INVALID : undefined}
            value={form.owner_id}
            onChange={(e) => set({ owner_id: e.target.value })}
          >
            <option value="">Select an owner…</option>
            {selectable.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
          {owners.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No owners yet —{" "}
              <Link href="/content-owners" className="text-primary hover:underline">
                add one first
              </Link>
              .
            </p>
          )}
          <FieldError message={err.owner_id} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="title">Show / title *</Label>
          <Input
            id="title"
            required
            maxLength={200}
            className={err.title ? INVALID : undefined}
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
          />
          <FieldError message={err.title} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label>Deal type * <InfoTip text={HELP.dealType} /></Label>
          <Choice value={form.deal_type} options={DEAL_TYPE_LABELS} onChange={(deal_type) =>
              set({
                deal_type,
                ...(deal_type === "partnership" && !form.revenue_share_pct ? { revenue_share_pct: "50" } : {}),
              })
            }
          />
        </div>
        {form.deal_type === "hybrid" && (
          <p className="text-sm text-muted-foreground md:col-span-2">
            Taggify pays the owner a minimum guarantee up front; the owner&apos;s revenue share is recouped against it, and only
            the share above the guarantee is paid extra.
          </p>
        )}
        {form.deal_type === "partnership" && (
          <p className="text-sm text-muted-foreground md:col-span-2">
            No fee is paid. Each month, what the content earns minus the CMS fee is split with the partner — e.g. 50/50.
            Our team&apos;s incentives and expenses come out of our part.
          </p>
        )}
        {PAYS_FEE.includes(form.deal_type) && (
          <>
            <div className="space-y-2">
              <Label htmlFor="fee">{form.deal_type === "hybrid" ? "Minimum guarantee *" : "Licence fee *"} <InfoTip text={form.deal_type === "hybrid" ? HELP.minimumGuarantee : HELP.licenceFee} /></Label>
              <Input
                id="fee"
                type="number"
                min="0.01"
                step="0.01"
                required
                className={err.fee_amount ? INVALID : undefined}
                value={form.fee_amount}
                onChange={(e) => set({ fee_amount: e.target.value })}
              />
              <FieldError message={err.fee_amount} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency *</Label>
              <NativeSelect id="currency" value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
                <option value="INR">INR — Indian Rupee</option>
                <option value="USD">USD — US Dollar</option>
                <option value="AED">AED — UAE Dirham</option>
              </NativeSelect>
            </div>
          </>
        )}
        {SHARES.includes(form.deal_type) && (
          <div className="space-y-2">
            <Label htmlFor="share">
              {form.deal_type === "partnership" ? "Partner's share after CMS fee (%) *" : "Owner's revenue share (%) *"}{" "}
              <InfoTip text={form.deal_type === "partnership" ? HELP.partnerShare : HELP.revenueShare} />
            </Label>
            <Input
              id="share"
              type="number"
              min="0.01"
              max="100"
              step="0.01"
              required
              className={err.revenue_share_pct ? INVALID : undefined}
              value={form.revenue_share_pct}
              onChange={(e) => set({ revenue_share_pct: e.target.value })}
            />
            <FieldError message={err.revenue_share_pct} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="status">Status <InfoTip text={HELP.dealStatus} /></Label>
          <NativeSelect
            id="status"
            value={form.status}
            onChange={(e) => set({ status: e.target.value as StoredDealStatus })}
          >
            <option value="active">Active</option>
            <option value="draft">Draft (not yet signed)</option>
            <option value="terminated">Terminated</option>
          </NativeSelect>
        </div>
      </Section>

      <Section title="Rights" hint="What may be published, until when, and where.">
        <div className="space-y-2">
          <Label htmlFor="start">Term start * <InfoTip text={HELP.term} /></Label>
          <Input id="start" type="date" required value={form.term_start} onChange={(e) => set({ term_start: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="end">Term end *</Label>
          <Input
            id="end"
            type="date"
            required
            className={err.term_end ? INVALID : undefined}
            value={form.term_end}
            onChange={(e) => set({ term_end: e.target.value })}
          />
          <FieldError message={err.term_end} />
        </div>

        <div className="space-y-3 md:col-span-2">
          <Label>Episodes * <InfoTip text={HELP.episodeScope} /></Label>
          <Choice value={form.episode_scope} options={SCOPE_LABELS} onChange={(episode_scope) => set({ episode_scope })} />
          {form.episode_scope !== "all" && (
            <div className="space-y-2">
              {form.ranges.map((r, i) => (
                <div key={i} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {form.episode_scope === "seasons" && (
                    <Input
                      aria-label="Season"
                      className="w-28"
                      type="number"
                      min="1"
                      required
                      placeholder="Season"
                      value={r.season}
                      onChange={(e) => setRange(i, { season: e.target.value })}
                    />
                  )}
                  <Input
                    aria-label="From episode"
                    className="w-32"
                    type="number"
                    min="1"
                    required
                    placeholder="From ep."
                    value={r.from}
                    onChange={(e) => setRange(i, { from: e.target.value })}
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    aria-label="To episode"
                    className={errors.ranges[i] ? `w-32 ${INVALID}` : "w-32"}
                    type="number"
                    min="1"
                    required
                    placeholder="To ep."
                    value={r.to}
                    onChange={(e) => setRange(i, { to: e.target.value })}
                  />
                  {form.ranges.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove range"
                      onClick={() => set({ ranges: form.ranges.filter((_, j) => j !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <FieldError message={errors.ranges[i]} />
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => set({ ranges: [...form.ranges, EMPTY_RANGE] })}>
                <Plus />
                Add range
              </Button>
            </div>
          )}
          <FieldError message={err.episodes} />
        </div>

        <div className="space-y-3 md:col-span-2">
          <Label>Territory * <InfoTip text={HELP.territory} /></Label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[hsl(var(--primary))]"
              checked={form.is_worldwide}
              onChange={(e) => set({ is_worldwide: e.target.checked })}
            />
            Worldwide
          </label>
          {!form.is_worldwide && (
            <div className="grid grid-cols-2 gap-2 rounded-xl border p-4 sm:grid-cols-3 lg:grid-cols-4">
              {COUNTRIES.map(([code, name]) => (
                <label key={code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={form.territories.includes(code)}
                    onChange={(e) =>
                      set({
                        territories: e.target.checked
                          ? [...form.territories, code]
                          : form.territories.filter((t) => t !== code),
                      })
                    }
                  />
                  {name} <span className="text-xs text-muted-foreground">{code}</span>
                </label>
              ))}
            </div>
          )}
          <FieldError message={err.territories} />
        </div>
      </Section>

      <Section title="Slots" hint="How many channels/pages the deal allows. At least one is required; slots are created automatically.">
        <div className="space-y-2">
          <Label htmlFor="yt">YouTube channels <InfoTip text={HELP.slots} /></Label>
          <Input id="yt" type="number" min="0" max="100" required value={form.yt_slot_limit} onChange={(e) => set({ yt_slot_limit: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fb">Facebook pages</Label>
          <Input id="fb" type="number" min="0" max="100" required value={form.fb_slot_limit} onChange={(e) => set({ fb_slot_limit: e.target.value })} />
        </div>
        <div className="md:col-span-2">
          <FieldError message={err.slots} />
        </div>
      </Section>

      <Section title="Contract terms" hint="From the signed agreement. Optional, but recorded per deal (working document §1).">
        <div className="space-y-2">
          <Label htmlFor="languages">Languages</Label>
          <Input
            id="languages"
            placeholder="Hindi, English"
            value={form.languages}
            onChange={(e) => set({ languages: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Separate with commas.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="exclusivity">Exclusivity <InfoTip text={HELP.exclusivity} /></Label>
          <NativeSelect
            id="exclusivity"
            value={form.exclusivity}
            onChange={(e) => set({ exclusivity: e.target.value as Exclusivity | "" })}
          >
            <option value="">Not recorded</option>
            <option value="exclusive">Exclusive</option>
            <option value="non_exclusive">Non-exclusive</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="notice">Notice period (days) <InfoTip text={HELP.noticePeriod} /></Label>
          <Input
            id="notice"
            type="number"
            min="0"
            max="3650"
            placeholder="e.g. 90"
            className={err.notice_period_days ? INVALID : undefined}
            value={form.notice_period_days}
            onChange={(e) => set({ notice_period_days: e.target.value })}
          />
          <p className="text-xs text-muted-foreground">Days before the term ends to tell the owner about renewal.</p>
          <FieldError message={err.notice_period_days} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="version">Agreement version</Label>
          <Input
            id="version"
            maxLength={60}
            placeholder="e.g. v2 signed 12 Jan 2026"
            value={form.agreement_version}
            onChange={(e) => set({ agreement_version: e.target.value })}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="renewal">Renewal terms</Label>
          <textarea
            id="renewal"
            rows={2}
            className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. Renews for 2 years at the same fee unless either side gives notice"
            value={form.renewal_terms}
            onChange={(e) => set({ renewal_terms: e.target.value })}
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="clips">Clip restrictions</Label>
          <textarea
            id="clips"
            rows={2}
            className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="e.g. Max 10 minutes per clip; no full episodes"
            value={form.clip_restrictions}
            onChange={(e) => set({ clip_restrictions: e.target.value })}
          />
        </div>
      </Section>

      <Section title="Documents & notes" hint="Optional. Upload the signed contract and annexures on the deal page after saving.">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="contract">Contract link (Google Drive)</Label>
          <Input
            id="contract"
            type="url"
            placeholder="https://drive.google.com/…"
            className={err.contract_url ? INVALID : undefined}
            value={form.contract_url}
            onChange={(e) => set({ contract_url: e.target.value })}
          />
          <FieldError message={err.contract_url} />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Notes</Label>
          <textarea
            id="notes"
            rows={3}
            className="w-full rounded-xl border border-input bg-card px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>
      </Section>

      {err.form && <Notice kind="error">{err.form}</Notice>}
      {hasErrors(errors) && !err.form && (
        <p className="text-sm text-red-600 dark:text-red-400">Please fix the highlighted fields above.</p>
      )}

      <div className="flex gap-3">
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "Saving…" : deal ? "Save changes" : "Create deal"}
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
