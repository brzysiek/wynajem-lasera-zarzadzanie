// Wspólne klocki modułu Sygnały — wygląd wg docs/crm/mockup-sygnaly.html,
// kolory wyłącznie z shell-tokens.ts (APP, LEAD_STAGE_COLORS).
import { LEAD_STAGE_COLORS } from "@/components/shell-tokens";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey, type LeadTypeKey } from "@/lib/leads/parse-deal";
import { URGENT_AFTER_WORK_HOURS, waitingLabel, workHoursBetween } from "@/lib/leads/work-time";
import type { DeviceInterestKey } from "@/lib/clients/labels";
import { initials } from "@/lib/clients/labels";

export function StageChip({ stage, suffix, className = "" }: { stage: LeadStageKey; suffix?: string; className?: string }) {
  const c = LEAD_STAGE_COLORS[stage];
  return (
    <span className={`inline-block whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11px] font-semibold ${className}`} style={{ background: c.bg, color: c.fg }}>
      {STAGE_LABEL[stage]}
      {suffix && ` ${suffix}`}
    </span>
  );
}

export function TypeTag({ type }: { type: LeadTypeKey }) {
  return <span className="whitespace-nowrap rounded-md bg-[var(--c-bg)] px-[7px] py-0.5 text-[11px] text-[var(--c-sidebar-text)]">{TYPE_LABEL[type]}</span>;
}

export function DevicePill({ devices, from, days }: { devices: DeviceInterestKey[]; from?: string | null; days?: number | null }) {
  const names = devices.map((d) => LEAD_DEVICE_LABEL[d]).filter(Boolean);
  const when = from ? fmtRange(from, days ?? null) : null;
  if (names.length === 0 && !when) return null;
  return (
    <span className="whitespace-nowrap rounded-md bg-[var(--c-brand-soft)] px-[7px] py-0.5 text-[11px] text-[var(--c-brand-deep)]">
      {[names.join(", "), when].filter(Boolean).join(" · ")}
    </span>
  );
}

// „10–11.10” / „28.09” — termin z formularza.
export function fmtRange(fromIso: string, days: number | null): string {
  const a = new Date(fromIso);
  const dd = (d: Date) => String(d.getDate()).padStart(2, "0");
  const mm = (d: Date) => String(d.getMonth() + 1).padStart(2, "0");
  if (!days || days <= 1) return `${dd(a)}.${mm(a)}`;
  const b = new Date(a.getFullYear(), a.getMonth(), a.getDate() + days - 1);
  return a.getMonth() === b.getMonth() ? `${dd(a)}–${dd(b)}.${mm(b)}` : `${dd(a)}.${mm(a)}–${dd(b)}.${mm(b)}`;
}

export function fmtWhen(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay) return `dziś, ${time}`;
  if (d.toDateString() === y.toDateString()) return `wczoraj, ${time}`;
  return `${d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}, ${time}`;
}

// „czeka 26 h” liczone w godzinach roboczych; czerwone po 24 h.
export function Waiting({ since, now }: { since: string; now: Date }) {
  const h = workHoursBetween(new Date(since), now);
  const urgent = h >= URGENT_AFTER_WORK_HOURS;
  return (
    <div className="whitespace-nowrap text-right text-xs font-semibold" style={{ color: urgent ? "var(--c-red)" : "var(--c-brand-deep)" }}>
      {waitingLabel(h)}
      <div className="font-normal text-[var(--c-muted)]">{fmtWhen(since, now)}</div>
    </div>
  );
}

export function isUrgent(since: string, now: Date) {
  return workHoursBetween(new Date(since), now) >= URGENT_AFTER_WORK_HOURS;
}

export function OwnerAvatar({ name }: { name: string | null }) {
  if (!name) return null;
  return (
    <span
      title={`Prowadzi: ${name}`}
      className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[var(--c-navy-soft)] text-[10px] font-bold text-[var(--c-brand-deep)]"
    >
      {initials(name)}
    </span>
  );
}

type IconProps = { size?: number; className?: string };

export function PulseIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3 10h3l2-5 4 10 2-5h3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TaskIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3.5" y="3.5" width="13" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7 10 2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function XCircleIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7.5 7.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function RefreshIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3.2h-3.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
