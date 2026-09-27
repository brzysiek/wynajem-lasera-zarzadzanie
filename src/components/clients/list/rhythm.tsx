"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientListRow } from "@/lib/clients/list-load";
import type { StripCell } from "@/lib/clients/list-rules";

// Pasek rytmu listy klientów: 12 miesięcy wstecz + kreska + 3 w przód
// (wartości 1:1 z lista-klientow-wzor.html) i okno „Jak czytać pasek rytmu”.

const CELL: Record<StripCell, string> = {
  R: "bg-[#1B6FA8]",
  P: "border-2 border-[#1B6FA8] bg-white",
  F: "border-2 border-dashed border-[#E08A5C] bg-white",
  E: "bg-[#EEF0F2]",
};
const CELL_TITLE: Record<StripCell, string> = { R: "był wynajem", P: "jest rezerwacja", F: "wg rytmu bez rezerwacji", E: "brak wynajmu" };

export function StripCellBox({ kind, title }: { kind: StripCell; title?: string }) {
  return <span title={title} className={`box-border block h-3 w-3 flex-none ${CELL[kind]}`} />;
}

export function Strip({ cells, labels }: { cells: StripCell[]; labels: string[] }) {
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={cells.map((c, i) => `${labels[i]}: ${CELL_TITLE[c]}`).join(", ")}>
      {cells.slice(0, 12).map((c, i) => (
        <StripCellBox key={i} kind={c} title={`${labels[i]} · ${CELL_TITLE[c]}`} />
      ))}
      <span className="mx-[3px] h-4 w-px flex-none bg-[#9AA1A8]" />
      {cells.slice(12).map((c, i) => (
        <StripCellBox key={i + 12} kind={c} title={`${labels[i + 12]} · ${CELL_TITLE[c]}`} />
      ))}
    </div>
  );
}

// Kropka ryzyka: zieleń = w rytmie, obrys terakota = spóźnia się (1,2–2×),
// pełna terakota = ryzyko (> 2×), szara = za mało danych.
export function RiskDot({ risk }: { risk: ClientListRow["rhythm"]["risk"] }) {
  const cls =
    risk === "niskie" ? "bg-[#2F7A68]" : risk === "średnie" ? "box-border border-2 border-[#E08A5C]" : risk === "wysokie" ? "bg-[#E08A5C]" : "bg-[#C3C4C7]";
  return <span className={`h-[7px] w-[7px] flex-none rounded-full ${cls}`} />;
}

const WEEKDAY_PLURAL: Record<string, string> = { pn: "w poniedziałki", wt: "we wtorki", śr: "w środy", czw: "w czwartki", pt: "w piątki", sob: "w soboty", nd: "w niedziele" };
const MONTH_IN = ["w styczniu", "w lutym", "w marcu", "w kwietniu", "w maju", "w czerwcu", "w lipcu", "w sierpniu", "we wrześniu", "w październiku", "w listopadzie", "w grudniu"];
const dm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} i ${xs[xs.length - 1]}`);

// Przykład do okna ⓘ — z pierwszej klientki na liście, która ma rytm.
function exampleFor(rows: ClientListRow[]): { row: ClientListRow; text: string } | null {
  const row = rows.find((r) => r.rhythm.days && r.rhythm.suggestion) ?? rows.find((r) => r.rhythm.days);
  if (!row || !row.rhythm.days) return null;
  const r = row.rhythm;
  const who = [`wynajmuje co ${r.days} dni`, r.weekday ? WEEKDAY_PLURAL[r.weekday] : null, r.breakLabel ? `bez ${r.breakLabel}` : null].filter(Boolean).join(", ");
  const dates = [row.nextRental?.at, ...row.moreReservations.dates].filter((x): x is string => !!x).map(dm);
  const has = dates.length ? `Ma ${dates.length === 1 ? "rezerwację" : "rezerwacje"} ${list(dates)}` : "Nie ma rezerwacji";
  const s = r.suggestion ? new Date(r.suggestion) : null;
  const tail = s ? `, a ${MONTH_IN[s.getMonth()]} nic – rytm podpowiada ok. ${dm(r.suggestion!)} i ten termin warto zaproponować${dates.length ? " przy dostawie" : ""}.` : ".";
  return { row, text: `${who}. ${has}${tail}` };
}

export function RhythmHelp({ rows, pastLabel, futureLabel }: { rows: ClientListRow[]; pastLabel: string; futureLabel: string }) {
  const [open, setOpen] = useState(false);
  const [arrow, setArrow] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pop.current?.contains(t) || btn.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const ex = open ? exampleFor(rows) : null;

  return (
    <span className="relative flex items-center gap-2">
      Rytm · {pastLabel} <span className="text-[#1B6FA8]">| {futureLabel}</span>
      <button
        ref={btn}
        type="button"
        aria-label="Jak czytać rytm"
        aria-expanded={open}
        aria-controls="rhythm-help"
        onClick={() => {
          if (btn.current) setArrow(btn.current.offsetLeft + 4);
          setOpen((v) => !v);
        }}
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full border-[1.5px] border-[#1B6FA8] bg-[#1B6FA8] p-0 text-[11px] font-semibold normal-case leading-none tracking-normal text-white outline-offset-2 hover:bg-[#0C3450]"
      >
        i
      </button>
      {open && (
        <div
          ref={pop}
          id="rhythm-help"
          role="dialog"
          aria-label="Jak czytać pasek rytmu"
          className="absolute left-[-12px] top-[calc(100%+16px)] z-30 flex w-[460px] max-w-[calc(100vw-32px)] flex-col border border-[#C9D6E0] bg-white text-left normal-case tracking-normal shadow-[0_12px_32px_rgba(12,52,80,0.18)]"
        >
          <span className="absolute -top-2 h-3.5 w-3.5 rotate-45 bg-[#0C3450]" style={{ left: arrow + 12 }} />
          <div className="relative flex items-center justify-between bg-[#0C3450] px-4 py-2.5">
            <span className="text-[15px] font-semibold text-white">Jak czytać pasek rytmu</span>
            <button
              type="button"
              aria-label="Zamknij"
              onClick={() => {
                setOpen(false);
                btn.current?.focus();
              }}
              className="h-[26px] w-[26px] rounded-[4px] border border-white/40 bg-transparent p-0 text-[13px] text-white hover:bg-white/10"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-col gap-3 px-4 pb-4 pt-3 text-[13px] leading-[1.5] text-[#3A3A3A]">
            <div>
              Każdy kwadrat to <b>jeden miesiąc</b>. 12 po lewej to ostatni rok ({pastLabel.replace(/\.(\d\d)/g, ".20$1")}), 3 za kreską to najbliższe miesiące ({futureLabel}).
            </div>
            <div className="grid grid-cols-[22px_1fr] items-center gap-x-2.5 gap-y-2">
              <StripCellBox kind="R" />
              <span>był wynajem</span>
              <StripCellBox kind="P" />
              <span>jest rezerwacja</span>
              <StripCellBox kind="F" />
              <span>
                <b className="text-[#B8612F]">wg rytmu powinna wynająć, a nie ma rezerwacji</b> – okazja do telefonu
              </span>
              <StripCellBox kind="E" />
              <span>brak wynajmu</span>
            </div>
            <div className="flex flex-col gap-1.5 border-t border-[#EEF0F2] pt-3">
              <div>
                <b>„co 28 dni”</b> – typowy odstęp między wynajmami (bez wakacyjnych przerw)
              </div>
              <div>
                <b>„pt”</b> – dzień, w który najczęściej wynajmuje
              </div>
              <div>
                <b>„przerwa VII–VIII”</b> – miesiące, w których co roku nie wynajmuje; tam nie proponujemy terminów
              </div>
            </div>
            <div className="grid grid-cols-[22px_1fr] items-center gap-x-2.5 gap-y-1.5">
              <RiskDot risk="niskie" />
              <span>wynajmuje w swoim rytmie</span>
              <RiskDot risk="średnie" />
              <span>spóźnia się (1,2–2× rytm od ostatniego terminu)</span>
              <RiskDot risk="wysokie" />
              <span>ryzyko odejścia (ponad 2× rytm)</span>
              <RiskDot risk={null} />
              <span>za mało wynajmów, żeby policzyć rytm</span>
            </div>
            {ex && (
              <div className="bg-[#EAF4FB] px-3 py-2 text-[12.5px] leading-[1.5] text-[#0C3450]">
                <b>Przykład – {ex.row.shortName ?? ex.row.name}:</b> {ex.text}
              </div>
            )}
            <Link href={ex ? `/klienci/${ex.row.id}#rytm` : "/klienci"} className="text-[12.5px] text-[#1B6FA8] hover:text-[#0C3450]">
              Szczegóły na karcie klienta, sekcja „Rytm współpracy” →
            </Link>
          </div>
        </div>
      )}
    </span>
  );
}
