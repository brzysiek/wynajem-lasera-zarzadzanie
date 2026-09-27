"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ClientListRow } from "@/lib/clients/list-load";
import type { StripCell } from "@/lib/clients/list-rules";
import { STATUS_BADGE } from "./format";

// Widok „Rytm (plan obłożenia)” na /klienci: klientki × miesiące (12 wstecz
// + 3 w przód — ten sam pasek co w kolumnie „Rytm” i na karcie), a pod
// spodem obłożenie: ile wynajmów / rezerwacji i ile „okazji” (wg rytmu bez
// rezerwacji) w każdym miesiącu, łącznie i wg głównego urządzenia klientki.
// Działa na tej samej, przefiltrowanej liście co widok „Lista”.

const CELL: Record<StripCell, string> = {
  R: "bg-[#1B6FA8]",
  P: "border-2 border-[#1B6FA8] bg-white",
  F: "border-2 border-dashed border-[#E08A5C] bg-white",
  E: "bg-[#EEF0F2]",
};
const CELL_TITLE: Record<StripCell, string> = { R: "był wynajem", P: "jest rezerwacja", F: "wg rytmu bez rezerwacji", E: "brak" };

const GRID = "grid grid-cols-[minmax(180px,240px)_110px_repeat(15,minmax(34px,1fr))] gap-x-[3px]";

const family = (r: ClientListRow) => r.deviceChips[0]?.split(/\s+/)[0] ?? "bez urządzenia";

export function RhythmView({ rows, monthLabels, currentMonth }: { rows: ClientListRow[]; monthLabels: string[]; currentMonth: number }) {
  // Obłożenie: miesiąc → liczba klientek z wynajmem / rezerwacją / okazją.
  const totals = useMemo(() => {
    const t = Array.from({ length: 15 }, () => ({ R: 0, P: 0, F: 0 }));
    for (const r of rows) r.rhythm.cells.forEach((c, i) => c !== "E" && t[i][c]++);
    return t;
  }, [rows]);
  const byDevice = useMemo(() => {
    const m = new Map<string, { R: number; P: number; F: number }[]>();
    for (const r of rows) {
      const f = family(r);
      if (!m.has(f)) m.set(f, Array.from({ length: 15 }, () => ({ R: 0, P: 0, F: 0 })));
      const t = m.get(f)!;
      r.rhythm.cells.forEach((c, i) => c !== "E" && t[i][c]++);
    }
    return [...m.entries()].sort((a, b) => b[1].reduce((s, x) => s + x.R + x.P, 0) - a[1].reduce((s, x) => s + x.R + x.P, 0));
  }, [rows]);

  const head = (i: number) => {
    const [roman, year] = monthLabels[i].split(".");
    return (
      <span
        key={i}
        className={`flex flex-col items-center leading-tight ${i === currentMonth ? "font-semibold text-[#0C3450]" : i > currentMonth ? "text-[#1B6FA8]" : "text-[#5C6166]"} ${i === 12 ? "border-l border-[#9AA1A8]" : ""}`}
      >
        {roman}
        <span className="text-[9px] text-[#9AA1A8]">{year.slice(2)}</span>
      </span>
    );
  };

  const sumCell = (x: { R: number; P: number; F: number }, i: number) => (
    <span key={i} className={`text-center tabular-nums ${i === 12 ? "border-l border-[#9AA1A8]" : ""}`} title={`${x.R ? `${x.R} wynajmów · ` : ""}${x.P ? `${x.P} rezerwacji · ` : ""}${x.F ? `${x.F} wg rytmu bez rezerwacji` : ""}`}>
      {x.R + x.P > 0 ? <span className={i > currentMonth ? "font-semibold text-[#1B6FA8]" : "text-[#0C3450]"}>{x.R + x.P}</span> : <span className="text-[#C3C4C7]">·</span>}
      {x.F > 0 && <span className="text-[#B8612F]"> +{x.F}</span>}
    </span>
  );

  return (
    <div className="mx-4 mt-3 overflow-x-auto border border-[#E4E7EA] bg-white md:mx-7">
      <div className="min-w-[980px]">
        <div className={`${GRID} items-end border-b border-[#E4E7EA] px-3.5 pb-2 pt-2.5 text-[10.5px] uppercase tracking-[0.1em] text-[#5C6166]`}>
          <span>Klientka · status</span>
          <span>Urządzenie</span>
          {monthLabels.map((_, i) => head(i))}
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-[13px] text-[#5C6166]">Nikt nie pasuje do tych filtrów.</div>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/klienci/${r.id}`} className={`${GRID} items-center border-b border-[#EEF0F2] px-3.5 py-1.5 hover:bg-[#FAFBFC]`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className={`flex-none px-[5px] py-px text-[9.5px] font-medium uppercase tracking-[0.12em] ${STATUS_BADGE[r.status].cls}`}>{STATUS_BADGE[r.status].label}</span>
                <span className="truncate text-[13px] font-semibold text-[#0C3450]" title={r.name}>
                  {r.shortName ?? r.name}
                </span>
              </span>
              <span className="truncate text-[12px] text-[#1B6FA8]" title={r.deviceChips.join(", ")}>
                {r.deviceChips.join(", ") || "—"}
              </span>
              {r.rhythm.cells.map((c, i) => (
                <span key={i} className={`flex justify-center ${i === 12 ? "border-l border-[#9AA1A8] pl-[3px]" : ""}`}>
                  <span title={`${monthLabels[i]} · ${CELL_TITLE[c]}`} className={`box-border block h-4 w-full max-w-[30px] ${CELL[c]}`} />
                </span>
              ))}
            </Link>
          ))
        )}

        {rows.length > 0 && (
          <div className="bg-[#F7F9FB] text-[12px]">
            <div className={`${GRID} items-center border-b border-t border-[#E4E7EA] px-3.5 py-1.5`}>
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[#0C3450]">Obłożenie · {rows.length} klientek</span>
              <span className="text-[11px] text-[#5C6166]">wynajmy + rezerwacje</span>
              {totals.map(sumCell)}
            </div>
            {byDevice.map(([name, t]) => (
              <div key={name} className={`${GRID} items-center border-b border-[#EEF0F2] px-3.5 py-1`}>
                <span className="truncate pl-3 text-[12px] text-[#3A3A3A]">{name}</span>
                <span className="text-[11px] text-[#767C82]">główne urządzenie</span>
                {t.map(sumCell)}
              </div>
            ))}
            <div className="px-3.5 py-2 text-[11.5px] text-[#5C6166]">
              Liczba = klientki z wynajmem albo rezerwacją w miesiącu; <span className="text-[#B8612F]">+N</span> = wg rytmu powinny wynająć, a nie mają rezerwacji (okazje do telefonu).
              Urządzenie wg głównego urządzenia klientki. Filtry i wyszukiwarka nad tabelą działają także tutaj.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
