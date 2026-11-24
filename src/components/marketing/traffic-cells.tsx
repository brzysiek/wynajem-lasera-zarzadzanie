import type { AdMetrics, TrafficMetricsDto } from "@/lib/traffic/ads";

// Wniosek 54: kolumny jakości ruchu z licznika (pod „+ Więcej kolumn”) w Kampaniach i Słowach kluczowych.
// Licznik nie łączy wizyt między stronami — wartości dotyczą strony wejścia z danym utm.

const INT = (n: number) => n.toLocaleString("pl-PL");
export const TRAFFIC_COLS = 5;

const HEAD = "px-2 py-2 text-right font-medium whitespace-nowrap";
export function TrafficHeads() {
  return (
    <>
      <th className={HEAD} title="Wejścia z anonimowego licznika ruchu (początki wizyt z tym utm). Licznik nie łączy wizyt między stronami — dane dotyczą strony wejścia.">Wejścia</th>
      <th className={HEAD} title="Odsetek wejść, w których osoba wyszła w mniej niż 10 s (liczony bez wejść bez podsumowania)">% wyszli od razu</th>
      <th className={HEAD} title="Odsetek wejść z przewinięciem strony co najmniej do połowy (liczony bez wejść bez podsumowania)">% przewinęło ≥ 50</th>
      <th className={HEAD} title="Kliknięcia w numer telefonu na stronie wejścia">Telefon</th>
      <th className={HEAD} title="Start formularza — tylko gdy formularz jest na stronie wejścia">Start formularza</th>
    </>
  );
}

const pctCell = (v: number | null) => (v == null ? "—" : `${v}%`);

// Wiersz bez wejść (albo bez danych licznika w okresie) → „—”. Mało danych (< 20 wejść) → szary znacznik.
export function TrafficCells({ m, hasData, className }: { m: AdMetrics | undefined; hasData: boolean; className: string }) {
  if (!hasData) {
    return (
      <>
        {Array.from({ length: TRAFFIC_COLS }, (_, i) => (
          <td key={i} className={className}>
            —
          </td>
        ))}
      </>
    );
  }
  const visits = m?.wejscia ?? 0;
  const few = visits > 0 && (m?.malo_danych ?? true);
  const grey = few ? " text-gray-400" : "";
  return (
    <>
      <td className={className}>
        {INT(visits)}
        {few && (
          <span className="ml-1 whitespace-nowrap rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500" title="Mniej niż 20 wejść — procenty niewiarygodne">
            mało danych
          </span>
        )}
      </td>
      <td className={className + grey} title={m && m.bez_podsumowania > 0 ? `Bez podsumowania (poza procentami): ${m.bez_podsumowania}` : undefined}>{pctCell(m?.wyszli_od_razu_proc ?? null)}</td>
      <td className={className + grey}>{pctCell(m?.przewiniecie_50_proc ?? null)}</td>
      <td className={className}>{INT(m?.klik_telefon ?? 0)}</td>
      <td className={className}>{INT(m?.form_start ?? 0)}</td>
    </>
  );
}

// Razem dla wszystkich kanałów: tylko liczby (procentów z różnych kanałów nie uśredniamy).
export function totalMetrics(t: TrafficMetricsDto | undefined): AdMetrics | undefined {
  if (!t) return undefined;
  const chs = Object.entries(t.byKey).filter(([k]) => k.startsWith("ch\u0001"));
  const sum = (f: (m: AdMetrics) => number) => chs.reduce((a, [, m]) => a + f(m), 0);
  return {
    wejscia: sum((m) => m.wejscia),
    bez_podsumowania: sum((m) => m.bez_podsumowania),
    z_podsumowaniem: sum((m) => m.z_podsumowaniem),
    wyszli_od_razu_proc: null,
    przewiniecie_50_proc: null,
    czas_30s_proc: null,
    sredni_czas_s: null,
    z_pomiarem_czasu: sum((m) => m.z_pomiarem_czasu),
    wejscia_gbraid_wbraid: sum((m) => m.wejscia_gbraid_wbraid),
    z_rodzajem_klikniecia: sum((m) => m.z_rodzajem_klikniecia),
    gbraid_wbraid_proc: null,
    klik_telefon: sum((m) => m.klik_telefon),
    form_start: sum((m) => m.form_start),
    form_wyslany: sum((m) => m.form_wyslany),
    form_porzucony: sum((m) => m.form_porzucony),
    pole_porzucenia: null,
    malo_danych: false,
  };
}
