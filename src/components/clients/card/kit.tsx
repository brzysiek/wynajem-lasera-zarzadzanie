// Klocki karty klienta — wartości 1:1 z projektu „Karta klienta – Studio Urody
// MiWiNi (docelowy układ)” (Main.dc.html, 1440 px): otwarte sekcje bez ramek,
// nagłówki Jost 24 px granat z podkreśleniem terakota, etykiety 12 px
// wersalikami, wartości Open Sans 16 px, linie #E4E7EA, kwadratowe narożniki.
// Niebieski #1B6FA8 = wartości / linki / przyciski, terakota = tylko „uwaga /
// do zrobienia”, zieleń #2F7A68 = tylko „w porządku”.
import type { ReactNode } from "react";
import { sourceLabel } from "@/lib/clients/card-quality";

export const C = {
  navy: "#0C3450",
  blue: "#1B6FA8",
  text: "#3A3A3A",
  value: "#333333",
  body: "#4A4A4A",
  muted: "#5C6166",
  faint: "#767C82",
  line: "#E4E7EA",
  sep: "#C3C4C7",
  terra: "#E08A5C",
  terraText: "#B8612F",
  green: "#2F7A68",
  greenDeep: "#1F5E4F",
} as const;

// Etykieta: 12 px, wersaliki, rozstrzelenie 0.12em (na pasku wskaźników 0.16em).
export const LABEL = "text-[10.5px] uppercase tracking-[0.12em] text-[#5C6166]";
export const LABEL_WIDE = "text-[10.5px] uppercase tracking-[0.14em] text-[#5C6166]";
export const H2 = "m-0 self-start border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold leading-tight text-[#0C3450]";

export function Heading({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <h2 className={`${H2} ${className}`}>{children}</h2>;
}

// Sekcja: nagłówek (z opcjonalną akcją po prawej, wyrównanie do linii bazowej) + treść.
export function Section({
  title,
  action,
  sub,
  children,
  gap = "gap-1",
  id,
  headless = false,
}: {
  id?: string; // kotwica (np. „rytm” — link z listy klientów)
  headless?: boolean; // tytuł rysuje kafel zwijany (lewa kolumna karty)
  title: string;
  action?: ReactNode;
  sub?: ReactNode; // podtytuł pod nagłówkiem (np. „Dla kierowcy i instalatora.”)
  children: ReactNode;
  gap?: string;
}) {
  return (
    <section id={id} className={`flex scroll-mt-6 flex-col ${gap}`}>
      {headless ? (
        action && <div className="mb-1 flex items-baseline justify-end gap-4">{action}</div>
      ) : (
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Heading>{title}</Heading>
          {action && <div className="flex items-baseline gap-4">{action}</div>}
        </div>
      )}
      {sub && <div className="-mt-1.5 mb-1.5 text-[13px] text-[#5C6166]">{sub}</div>}
      {children}
    </section>
  );
}

// Brakująca wartość — do uzupełnienia (terakota, bez pogrubienia).
export function Missing({ children }: { children: ReactNode }) {
  return <span className="font-normal text-[#B8612F]">[{children}]</span>;
}

// Wiersz „etykieta | wartość” (padding 12 px, linia #E4E7EA pod spodem).
// `src` = źródło wyrównane do prawej (Dane firmy): 12 px #767C82.
export function Row({ label, children, src, labelWidth = 118, valueClass = "text-[#333333]" }: { label: string; children: ReactNode; src?: string[]; labelWidth?: number; valueClass?: string }) {
  return (
    <div className="grid items-baseline gap-2.5 border-b border-[#F0F1F2] py-[5px] last:border-0" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      <div className={LABEL}>{label}</div>
      {src ? (
        <SourcedValue src={src.map(sourceLabel).join(" · ")} valueClass={valueClass}>
          {children}
        </SourcedValue>
      ) : (
        <div className={`min-w-0 break-words text-[13px] ${valueClass}`}>{children}</div>
      )}
    </div>
  );
}

// Krótkie źródło (np. „CEIDG”) — po prawej w tej samej linii; długie (opis od
// agenta) — pod wartością, zawijane, żeby nie ściskało wartości do zera.
function SourcedValue({ src, valueClass, children }: { src: string; valueClass: string; children: ReactNode }) {
  if (!src) return <div className={`min-w-0 break-words text-[13px] ${valueClass}`}>{children}</div>;
  if (src.length <= 22)
    return (
      <div className="flex min-w-0 items-baseline justify-between gap-2.5">
        <span className={`min-w-0 break-words text-[13px] ${valueClass}`}>{children}</span>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-[#767C82]">{src}</span>
      </div>
    );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={`break-words text-[13px] ${valueClass}`}>{children}</span>
      <span className="break-words text-[11px] text-[#767C82]" title={src}>
        {src.length > 90 ? `${src.slice(0, 90)}…` : src}
      </span>
    </div>
  );
}

// Plakietka (tagi statusów w tabelach i na osi) — bez tła, wersaliki jak w projekcie.
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "ok" | "warn" | "neutral" | "info" }) {
  const cls = tone === "ok" ? "text-[#2F7A68] font-semibold" : tone === "warn" ? "text-[#B8612F]" : tone === "info" ? "text-[#1B6FA8]" : "text-[#767C82]";
  return <span className={`whitespace-nowrap text-[12.5px] ${cls}`}>{children}</span>;
}

export const BTN = "inline-flex h-[34px] items-center justify-center whitespace-nowrap rounded-[6px] text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_OUTLINE = `${BTN} border border-[#A9D2EC] bg-white px-3 text-[#1B6FA8] hover:border-[#1B6FA8]`;
export const BTN_PRIMARY = `${BTN} border border-[#1B6FA8] bg-[#1B6FA8] px-3.5 font-medium text-white hover:border-[#0C3450] hover:bg-[#0C3450]`;
export const BTN_TERRA = `${BTN} border-0 bg-[#E08A5C] px-3.5 font-medium text-white hover:brightness-95`;
export const LINK = "text-[13px] text-[#1B6FA8] hover:text-[#0C3450]";

// Filtry osi zdarzeń — linki tekstowe, aktywny z podkreśleniem terakota.
export function FilterLink({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`pb-0.5 text-[13px] ${on ? "border-b-2 border-[#E08A5C] font-medium text-[#1B6FA8]" : "border-b-2 border-transparent text-[#5C6166] hover:text-[#1B6FA8]"}`}
    >
      {children}
    </button>
  );
}

// Cytat / adnotacja z lewą kreską (powiązania, podsumowanie faktur).
export function Quote({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "terra" }) {
  return (
    <div className={`border-l-2 py-0.5 pl-3 text-[13px] italic ${tone === "blue" ? "border-[#82B7DA] text-[#1B6FA8]" : "border-[#E08A5C] text-[#4A4A4A]"}`}>{children}</div>
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
