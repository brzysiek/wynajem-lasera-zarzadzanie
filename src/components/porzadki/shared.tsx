"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { PRIORITY_LABEL, STATUS_LABEL, type PriorityKey, type ProposalStatusKey } from "@/lib/porzadki/labels";

// Wspólna rama modułu „Porządki”: nagłówek + zakładki Wnioski · Uwagi ·
// Dziennik · Reguły (styl jak moduł Klienci — zmienne --c-* z shell-tokens).

const TABS = [
  { href: "/wnioski", label: "Wnioski" },
  { href: "/uwagi", label: "Uwagi" },
  { href: "/dziennik", label: "Dziennik" },
  { href: "/reguly", label: "Reguły" },
  { href: "/archiwum", label: "Archiwum" },
];

export const INPUT =
  "h-9 w-full rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm text-[var(--c-text)] outline-none transition-colors focus:border-[var(--c-brand)] placeholder:text-[var(--c-faint)]";
export const TEXTAREA =
  "w-full resize-y rounded-lg border border-[var(--c-border)] bg-white px-3 py-2 text-sm text-[var(--c-text)] outline-none transition-colors focus:border-[var(--c-brand)] placeholder:text-[var(--c-faint)]";
export const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--c-muted)]";
export const BTN_PRIMARY =
  "h-9 rounded-lg bg-[var(--c-brand)] px-4 text-sm font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)] disabled:opacity-50";
export const BTN =
  "h-9 rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm font-medium text-[var(--c-text)] transition-colors hover:border-[var(--c-brand)] disabled:opacity-50";
export const BTN_GHOST =
  "h-9 rounded-lg px-3 text-sm font-medium text-[var(--c-muted)] transition-colors hover:bg-[var(--c-bg)] hover:text-[var(--c-text)]";
export const SELECT_PILL = (on: boolean) =>
  `h-8 cursor-pointer rounded-full border px-2.5 text-xs transition-colors hover:border-[var(--c-brand)] focus:outline-none ${
    on ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white text-[var(--c-text)]"
  }`;

export function PorzadkiLayout({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div style={APP_CSS_VARS} className="text-[var(--c-text)]">
      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[var(--c-border)]">
        {TABS.map((t) => {
          const active = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
                active ? "border-[var(--c-brand)] text-[var(--c-navy)]" : "border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-grow">
          <h1 className="m-0 text-[26px] font-semibold text-[var(--c-navy)]">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-[var(--c-muted)]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

const STATUS_TONE: Record<ProposalStatusKey, string> = {
  NOWY: "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]",
  DO_DECYZJI: "bg-[var(--c-gold-soft)] text-[var(--c-gold-deep)]",
  PRZYJETY: "bg-[var(--c-purple-soft)] text-[var(--c-purple-deep)]",
  W_REALIZACJI: "bg-[var(--c-navy-soft)] text-[var(--c-navy)]",
  ZROBIONY: "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]",
  ODRZUCONY: "bg-[var(--c-red-soft)] text-[var(--c-red)]",
  DUPLIKAT: "bg-[var(--c-bg)] text-[var(--c-muted)]",
};

export function StatusBadge({ status }: { status: ProposalStatusKey }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

const PRIORITY_TONE: Record<PriorityKey, string> = {
  HIGH: "text-[var(--c-red)]",
  MEDIUM: "text-[var(--c-gold-deep)]",
  LOW: "text-[var(--c-muted)]",
};

export function PriorityBadge({ priority }: { priority: PriorityKey }) {
  return <span className={`whitespace-nowrap text-xs font-semibold ${PRIORITY_TONE[priority]}`}>● {PRIORITY_LABEL[priority]}</span>;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-4 sm:px-5">
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h2 className="m-0 flex-grow text-[15px] font-semibold text-[var(--c-navy)]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">{message}</p>;
}
