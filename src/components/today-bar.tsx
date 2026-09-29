"use client";

import type { ReactNode } from "react";

// Granatowy pasek „Do zrobienia dziś” (Klienci) — wspólny komponent dla
// Klientów, Sygnałów (wniosek 26) i Kalendarza („Do dopięcia”). Jeden rząd
// kafli; klik rozwija / filtruje, treść pod kaflami podaje wywołujący.

export type TodayBarTile = { key: string; label: string; n: number; sub: string; highlight?: boolean };

const LABEL_WIDE = "text-[10.5px] uppercase tracking-[0.14em]";

export function TodayBar({
  title,
  dateLabel,
  tiles,
  active,
  onToggle,
  children,
  right,
  className = "mx-4 mt-4 md:mx-7",
  allowEmpty = false,
  compact = false,
}: {
  title: string;
  dateLabel?: string;
  tiles: TodayBarTile[];
  active: string | null;
  onToggle: (key: string | null) => void;
  // Treść pod kaflami (np. lista pozycji rozwiniętego kafla).
  children?: ReactNode;
  // Prawa część paska (np. postęp dnia i cel sezonu w Sygnałach).
  right?: ReactNode;
  className?: string;
  // Kafel z 0 pozycji też klikalny (filtr pokazuje pustą sekcję).
  allowEmpty?: boolean;
  // Wniosek 34 (tylko Kalendarz): ok. 20% niższy — mniejszy padding, liczba i
  // etykieta w jednej linii, mniejszy podpis.
  compact?: boolean;
}) {
  return (
    <div className={`bg-[#2B5B82] px-4 ${compact ? "py-1.5" : "py-2.5"} ${className}`}>
      <div className={`grid items-center gap-2 ${right ? "2xl:grid-cols-[minmax(0,1fr)_260px]" : ""}`}>
          <div className="grid items-center gap-2 md:grid-cols-[150px_repeat(var(--today-cols),minmax(0,1fr))]" style={{ ["--today-cols" as string]: String(tiles.length) }}>
            <div className="flex flex-col text-white">
              <span className={`${compact ? "text-[14px]" : "text-[15px]"} font-semibold leading-tight`}>{title}</span>
              {dateLabel && <span className={`${compact ? "text-[11px]" : "text-[12px]"} text-[#BFD6EA]`}>{dateLabel}</span>}
            </div>
            {tiles.map((t) => {
              const on = active === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-expanded={on}
                  disabled={t.n === 0 && !allowEmpty}
                  onClick={() => onToggle(on ? null : t.key)}
                  className={`flex ${compact ? "h-[42px] gap-2 px-2.5" : "h-[52px] gap-3 px-3"} items-center border text-left disabled:cursor-default ${on ? "border-white/70 bg-white/15" : t.highlight ? "border-[#E08A5C] hover:bg-white/10" : "border-white/20 hover:bg-white/10"}`}
                >
                  {compact ? (
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="text-[17px] font-semibold leading-none text-white">{t.n}</span>
                        <span className={`truncate ${LABEL_WIDE} text-[#BFD6EA]`} title={t.label}>
                          {t.label}
                        </span>
                      </span>
                      <span className="truncate text-[11px] leading-tight text-[#DCE8F2]">{t.sub}</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-[22px] font-semibold leading-none text-white">{t.n}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className={`line-clamp-2 leading-tight ${LABEL_WIDE} text-[#BFD6EA]`} title={t.label}>{t.label}</span>
                        <span className="truncate text-[12px] text-[#DCE8F2]">{t.sub}</span>
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          {right && <div className="text-white">{right}</div>}
      </div>
      {children}
    </div>
  );
}
