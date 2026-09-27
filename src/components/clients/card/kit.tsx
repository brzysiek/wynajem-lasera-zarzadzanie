// Klocki karty klienta wg karta-klienta-wzor.html (prompt-code-karta-klienta.md,
// sekcje 1–2): sekcja z nagłówkiem 13 px / 700 / wersaliki, wiersz
// „etykieta 130 px | wartość + źródło”, chipy, przyciski 44 px, pigułki
// filtrów. Kolory ze zmiennych APP_CSS_VARS (shell-tokens.ts).
import type { ReactNode } from "react";
import { sourceLabel } from "@/lib/clients/card-quality";

export const H2 = "m-0 text-[13px] font-bold uppercase tracking-[0.06em] text-[var(--c-text-2)]";

export function Section({
  title,
  meta,
  action,
  children,
  gap = "gap-3",
  wide = false,
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  gap?: string;
  wide?: boolean;
}) {
  return (
    <section className={`flex flex-col rounded-lg border border-[var(--c-border)] bg-white ${wide ? "px-[22px] py-5" : "p-5"} ${gap}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={`${H2} whitespace-nowrap`}>{title}</h2>
        <div className="flex items-baseline gap-3 text-right">
          {meta && <span className="text-xs text-[var(--c-muted)]">{meta}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

// Brakująca wartość — pomarańczowy tekst w nawiasach (wzór: „[uzupełnia kierowca]”).
export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-[var(--c-warn-text-2)]">[{children}]</span>;
}

export function SourceTag({ sources }: { sources: string[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex gap-1.5">
      <span className="rounded bg-[var(--c-divider)] px-1.5 py-px text-[11px] text-[var(--c-text-2)]">{sources.map(sourceLabel).join(" · ")}</span>
    </div>
  );
}

export function Row({ label, children, sources, labelWidth = 130 }: { label: string; children: ReactNode; sources?: string[]; labelWidth?: number }) {
  return (
    <div className="grid gap-2.5 border-t border-[var(--c-divider)] pt-2.5" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      <div className="text-[13px] text-[var(--c-muted)]">{label}</div>
      {sources ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="break-words text-[14px]">{children}</div>
          <SourceTag sources={sources} />
        </div>
      ) : (
        <div className="min-w-0 break-words text-[14px]">{children}</div>
      )}
    </div>
  );
}

export function Chip({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded-md border px-2.5 py-1 text-[13px] ${
        accent ? "border-[var(--c-brand-soft-border)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white"
      }`}
    >
      {children}
    </span>
  );
}

export function Tag({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "warn" | "neutral" }) {
  const cls =
    tone === "accent"
      ? "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]"
      : tone === "warn"
        ? "bg-[var(--c-warn-bg)] text-[var(--c-warn-text)]"
        : "bg-[var(--c-divider)] text-[var(--c-text-2)]";
  return <span className={`whitespace-nowrap rounded px-[7px] py-0.5 text-[11px] ${cls}`}>{children}</span>;
}

export const BTN = "inline-flex h-11 items-center justify-center whitespace-nowrap rounded-lg px-4 text-[14px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_OUTLINE = `${BTN} border border-[var(--c-btn-border)] bg-white font-medium text-[var(--c-text)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)]`;
export const BTN_PRIMARY = `${BTN} border border-[var(--c-brand)] bg-[var(--c-brand)] px-[18px] font-semibold text-white hover:border-[var(--c-brand-deep)] hover:bg-[var(--c-brand-deep)]`;
export const LINK = "text-[13px] text-[var(--c-brand)] hover:text-[var(--c-brand-deep)] hover:underline";

export function Pill({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${
        on ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white" : "border-[var(--c-btn-border)] bg-white text-[var(--c-text)] hover:border-[var(--c-brand)]"
      }`}
    >
      {children}
    </button>
  );
}

// Daty i kwoty w formacie wzoru.
export const dmy = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
export const dm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }) : "");
// Grupowanie zawsze („1 180 zł”) — pl-PL domyślnie nie grupuje liczb 4-cyfrowych.
export const num = (n: number, frac = 0) => new Intl.NumberFormat("pl-PL", { minimumFractionDigits: frac, maximumFractionDigits: frac, useGrouping: "always" }).format(n);
export const money = (n: number, frac = 0) => `${num(n, frac)} zł`;
const WEEKDAY_SHORT = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
const WEEKDAY_LONG = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];
export const weekdayShort = (iso: string) => WEEKDAY_SHORT[warsawWeekday(iso)];
export const weekdayLong = (day: number) => WEEKDAY_LONG[day];
export const WEEKDAY_IN = ["w niedzielę", "w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę"];
function warsawWeekday(iso: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", weekday: "short" }).format(new Date(iso));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
export const hm = (iso: string) => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
