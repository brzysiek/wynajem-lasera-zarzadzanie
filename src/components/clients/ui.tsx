// Wspólne klocki modułu Klienci (lista + karta) — wygląd wg
// docs/crm/mockup-klienci.html, kolory wyłącznie z shell-tokens.ts.
import { APP, APP_DEEP, CLIENT_STATUS_COLORS } from "@/components/shell-tokens";
import { DEVICE_INTEREST_LABEL, STATUS_LABEL, initials, type DeviceInterestKey } from "@/lib/clients/labels";
import type { ClientStatus } from "@/lib/clients/status";

export function StatusChip({ status, className = "" }: { status: ClientStatus; className?: string }) {
  const c = CLIENT_STATUS_COLORS[status];
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold ${className}`}
      style={{ background: c.bg, color: c.fg, textDecoration: c.strike ? "line-through" : "none" }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

// Kolor awatara stały dla danego klienta (hash nazwy), z miękkich par APP —
// jak w makiecie (niebieski / złoty / fiolet / zieleń / akcent).
const AVATAR_TONES = [
  { bg: APP.navySoft, fg: APP.brandDeep },
  { bg: APP.goldSoft, fg: APP_DEEP.gold },
  { bg: APP.purpleSoft, fg: APP_DEEP.purple },
  { bg: APP.greenSoft, fg: APP_DEEP.green },
  { bg: APP.accentSoft, fg: APP_DEEP.accent },
] as const;

function toneFor(key: string) {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

export function Avatar({ name, id, size = 36 }: { name: string; id: string; size?: number }) {
  const t = toneFor(id);
  return (
    <div
      aria-hidden="true"
      className="flex flex-none items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        borderRadius: size >= 48 ? 12 : 10,
        background: t.bg,
        color: t.fg,
        fontSize: size >= 48 ? 18 : 14,
      }}
    >
      {initials(name)}
    </div>
  );
}

export function DeviceTags({ devices, max = 3 }: { devices: DeviceInterestKey[]; max?: number }) {
  if (devices.length === 0) return <span className="text-[13px] text-[var(--c-faint)]">—</span>;
  const shown = devices.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((d) => (
        <span key={d} className="rounded-md bg-[var(--c-brand-soft)] px-[7px] py-0.5 text-[11px] text-[var(--c-brand-deep)]">
          {DEVICE_INTEREST_LABEL[d]}
        </span>
      ))}
      {devices.length > max && (
        <span className="rounded-md bg-[var(--c-bg)] px-[7px] py-0.5 text-[11px] text-[var(--c-muted)]">+{devices.length - max}</span>
      )}
    </div>
  );
}

// pl-PL domyślnie NIE grupuje liczb 4-cyfrowych („1500”), a makieta pokazuje
// „11 400 zł” — stąd useGrouping: "always" (jak w reszcie panelu).
export function fmtMoney(n: number): string {
  return `${new Intl.NumberFormat("pl-PL", { useGrouping: "always", maximumFractionDigits: 0 }).format(Math.round(n))} zł`;
}

export function fmtDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// „dziś”, „wczoraj”, „7 dni temu”, „6 mies. temu”, „15 mies. temu”.
export function fmtAgo(iso: string, now = new Date()): string {
  const a = new Date(iso);
  const days = Math.round(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000,
  );
  if (days < 0) return days === -1 ? "jutro" : `za ${-days} dni`;
  if (days === 0) return "dziś";
  if (days === 1) return "wczoraj";
  if (days < 31) return `${days} dni temu`;
  return `${Math.max(1, Math.floor(days / 30.44))} mies. temu`;
}

type IconProps = { size?: number; className?: string };

export function PhoneIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M6 3h3l1 4-2 1.5a9 9 0 0 0 3.5 3.5L13 10l4 1v3c0 1-1 2-2 2A12 12 0 0 1 4 5c0-1 1-2 2-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function SmsIcon({ size = 15, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M3 5.5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H8l-3.5 3v-3H5c-1.1 0-2-.9-2-2v-6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarPlusIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14M10 10.5v4M8 12.5h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function PencilIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M4 16h3l8.5-8.5-3-3L4 13v3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function DownloadIcon({ size = 14, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 3v10m0 0-4-4m4 4 4-4M4 16h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StarIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <path d="M10 2.5 12 7l5 .5-3.8 3.3 1.1 4.9L10 13.2l-4.3 2.5 1.1-4.9L3 7.5 8 7l2-4.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m14 14 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function UsersIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true" className={className}>
      <circle cx="7.5" cy="7" r="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 17c.6-3 2.8-4.5 5.5-4.5S12.4 14 13 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="14" cy="7.5" r="2.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M14.5 12.3c1.9.3 3.1 1.8 3.5 4.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
