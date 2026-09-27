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
export const LABEL = "text-[12px] uppercase tracking-[0.12em] text-[#5C6166]";
export const LABEL_WIDE = "text-[12px] uppercase tracking-[0.16em] text-[#5C6166]";
export const H2 = "card-display m-0 self-start border-b-2 border-[#E08A5C] pb-1.5 text-[24px] font-medium leading-tight text-[#0C3450]";

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
}: {
  title: string;
  action?: ReactNode;
  sub?: ReactNode; // podtytuł pod nagłówkiem (np. „Dla kierowcy i instalatora.”)
  children: ReactNode;
  gap?: string;
}) {
  return (
    <section className={`flex flex-col ${gap}`}>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading>{title}</Heading>
        {action && <div className="flex items-baseline gap-4">{action}</div>}
      </div>
      {sub && <div className="-mt-1.5 mb-1.5 text-[15px] text-[#5C6166]">{sub}</div>}
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
export function Row({ label, children, src, labelWidth = 150, valueClass = "text-[#333333]" }: { label: string; children: ReactNode; src?: string[]; labelWidth?: number; valueClass?: string }) {
  return (
    <div className="grid items-baseline gap-3 border-b border-[#E4E7EA] py-3" style={{ gridTemplateColumns: `${labelWidth}px minmax(0, 1fr)` }}>
      <div className={LABEL}>{label}</div>
      {src ? (
        <div className="flex min-w-0 items-baseline justify-between gap-2.5">
          <span className={`min-w-0 break-words text-[16px] ${valueClass}`}>{children}</span>
          {src.length > 0 && <span className="whitespace-nowrap text-[12px] text-[#767C82]">{src.map(sourceLabel).join(" · ")}</span>}
        </div>
      ) : (
        <div className={`min-w-0 break-words text-[16px] ${valueClass}`}>{children}</div>
      )}
    </div>
  );
}

// Plakietka (tagi statusów w tabelach i na osi) — bez tła, wersaliki jak w projekcie.
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "ok" | "warn" | "neutral" | "info" }) {
  const cls = tone === "ok" ? "text-[#2F7A68] font-semibold" : tone === "warn" ? "text-[#B8612F]" : tone === "info" ? "text-[#1B6FA8]" : "text-[#767C82]";
  return <span className={`whitespace-nowrap text-[14px] ${cls}`}>{children}</span>;
}

export const BTN = "inline-flex h-[46px] items-center justify-center whitespace-nowrap text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-40";
export const BTN_OUTLINE = `${BTN} border border-[#A9D2EC] bg-white px-[18px] text-[#1B6FA8] hover:border-[#1B6FA8]`;
export const BTN_PRIMARY = `${BTN} border border-[#1B6FA8] bg-[#1B6FA8] px-[22px] font-medium text-white hover:border-[#0C3450] hover:bg-[#0C3450]`;
export const BTN_TERRA = `${BTN} border-0 bg-[#E08A5C] px-[22px] font-medium text-white hover:brightness-95`;
export const LINK = "text-[15px] text-[#1B6FA8] hover:text-[#0C3450]";

// Filtry osi zdarzeń — linki tekstowe, aktywny z podkreśleniem terakota.
export function FilterLink({ on, children, onClick }: { on: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`pb-0.5 text-[15px] ${on ? "border-b-2 border-[#E08A5C] font-medium text-[#1B6FA8]" : "border-b-2 border-transparent text-[#5C6166] hover:text-[#1B6FA8]"}`}
    >
      {children}
    </button>
  );
}

// Cytat / adnotacja z lewą kreską (powiązania, podsumowanie faktur).
export function Quote({ children, tone = "blue" }: { children: ReactNode; tone?: "blue" | "terra" }) {
  return (
    <div className={`border-l-2 py-1 pl-[18px] text-[16px] italic ${tone === "blue" ? "border-[#82B7DA] text-[#1B6FA8]" : "border-[#E08A5C] text-[#4A4A4A]"}`}>{children}</div>
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
