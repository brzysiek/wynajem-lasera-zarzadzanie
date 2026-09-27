// Klocki karty klienta — styl wynajemlasera.pl (wiadomość 27.09: „Wygląd —
// ostateczna wersja”): Jost na nagłówki i duże liczby, Open Sans na dane,
// kwadratowe narożniki, linie #E4E7EA, nagłówki sekcji Jost 24 px granat
// z kreską terakota. Niebieski = wartości / linki / przyciski, terakota =
// tylko „uwaga / do zrobienia”, zieleń = tylko „w porządku”. Kolory ze
// zmiennych CARD_CSS_VARS (shell-tokens.ts) — tylko w widoku karty.
import type { ReactNode } from "react";
import { sourceLabel } from "@/lib/clients/card-quality";

export const H2 = "card-display m-0 text-[24px] font-medium leading-tight text-[var(--c-navy)]";

export function Heading({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className={`${H2} whitespace-nowrap`}>{children}</h2>
      <span className="block h-[3px] w-10 bg-[var(--c-terra)]" aria-hidden />
    </div>
  );
}

export function Section({
  title,
  meta,
  action,
  children,
  gap = "gap-3",
  wide = false,
  tone = "white",
}: {
  title: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  gap?: string;
  wide?: boolean;
  tone?: "white" | "invoices";
}) {
  return (
    <section
      className={`flex flex-col border border-[var(--c-border)] ${tone === "invoices" ? "bg-[var(--c-card-invoices)]" : "bg-white"} ${wide ? "px-6 py-6" : "p-6"} ${gap}`}
    >
      <div className="mb-1 flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <Heading>{title}</Heading>
        <div className="flex items-baseline gap-3 pt-1.5 text-right">
          {meta && <span className="whitespace-nowrap text-[14px] text-[var(--c-muted)]">{meta}</span>}
          {action}
        </div>
      </div>
      {children}
    </section>
  );
}

// Brakująca wartość — do uzupełnienia (terakota).
export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-[var(--c-warn-text)]">[{children}]</span>;
}

// Źródła rejestrowe / dokumentowe = dane potwierdzone (zielone ✓);
// wpis z panelu lub od agenta bez dowodu — neutralny.
const CONFIRMING = /^(ceidg|bialalista|biała lista|fakturownia|krs|gus|faktury)$/i;
export const isConfirmingSource = (s: string) => s.split(/\s*[·,+;]\s*/).some((p) => CONFIRMING.test(p.trim()));

export function SourceTag({ sources }: { sources: string[] }) {
  if (!sources.length) return null;
  const ok = sources.some(isConfirmingSource);
  return (
    <div className={`text-[14px] ${ok ? "text-[var(--c-ok)]" : "text-[var(--c-muted)]"}`}>
      {ok ? "✓ " : "źródło: "}
      {sources.map(sourceLabel).join(" · ")}
    </div>
  );
}

export function Row({ label, children, sources, labelWidth = 140 }: { label: string; children: ReactNode; sources?: string[]; labelWidth?: number }) {
  return (
    <div className="grid gap-3 border-t border-[var(--c-divider)] pt-3" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      <div className="text-[14px] text-[var(--c-muted)]">{label}</div>
      {sources ? (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="break-words text-[15px]">{children}</div>
          <SourceTag sources={sources} />
        </div>
      ) : (
        <div className="min-w-0 break-words text-[15px]">{children}</div>
      )}
    </div>
  );
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="border border-[var(--c-border)] bg-white px-2.5 py-1 text-[14px]">{children}</span>;
}

export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "ok" | "warn" | "neutral" | "info" }) {
  const cls =
    tone === "ok"
      ? "bg-[var(--c-ok-bg-2)] text-[var(--c-ok)]"
      : tone === "warn"
        ? "bg-[var(--c-warn-bg)] text-[var(--c-warn-text)]"
        : tone === "info"
          ? "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]"
          : "bg-[var(--c-card-neutral)] text-[var(--c-text-2)]";
  return <span className={`whitespace-nowrap px-2 py-0.5 text-[14px] ${cls}`}>{children}</span>;
}

export const BTN = "inline-flex h-11 items-center justify-center whitespace-nowrap px-4 text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_OUTLINE = `${BTN} border border-[var(--c-brand)] bg-white font-medium text-[var(--c-brand)] hover:bg-[var(--c-brand-soft)]`;
export const BTN_PRIMARY = `${BTN} border border-[var(--c-brand)] bg-[var(--c-brand)] px-5 font-semibold text-white hover:border-[var(--c-brand-deep)] hover:bg-[var(--c-brand-deep)]`;
export const LINK = "text-[14px] text-[var(--c-brand)] hover:text-[var(--c-brand-deep)] hover:underline";

export function Pill({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-9 whitespace-nowrap border px-3 text-[14px] transition-colors ${
        on ? "border-[var(--c-brand)] bg-[var(--c-brand)] text-white" : "border-[var(--c-border)] bg-white text-[var(--c-text)] hover:border-[var(--c-brand)] hover:text-[var(--c-brand)]"
      }`}
    >
      {children}
    </button>
  );
}

// Daty i kwoty.
export const dmy = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
export const dm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" }) : "");
// Grupowanie zawsze („1 180 zł”) — pl-PL domyślnie nie grupuje liczb 4-cyfrowych.
export const num = (n: number, frac = 0) => new Intl.NumberFormat("pl-PL", { minimumFractionDigits: frac, maximumFractionDigits: frac, useGrouping: "always" }).format(n);
export const money = (n: number, frac = 0) => `${num(n, frac)} zł`;
const WEEKDAY_SHORT = ["nd", "pn", "wt", "śr", "cz", "pt", "sb"];
export const weekdayShort = (iso: string) => WEEKDAY_SHORT[warsawWeekday(iso)];
export const WEEKDAY_IN = ["w niedzielę", "w poniedziałek", "we wtorek", "w środę", "w czwartek", "w piątek", "w sobotę"];
function warsawWeekday(iso: string): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Warsaw", weekday: "short" }).format(new Date(iso));
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}
