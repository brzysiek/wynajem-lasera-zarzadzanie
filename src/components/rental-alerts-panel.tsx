"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import {
  ALERT_FIELD_LABEL,
  ALERT_FIELD_ORDER,
  ALERT_FIELD_SHORT,
  ALERT_WINDOW_DAYS,
  pluralWynajem,
} from "@/lib/rental-alerts";
import { useRentalAlerts } from "@/components/rental-alerts-context";

const C = {
  text: "#202124",
  sub: "#5f6368",
  border: "#e8eaed",
  red: "#D93025",
  redSoft: "#FCE8E6",
};

// Karta ostrzeżeń kalendarza — następca banera nad siatką (dawne
// src/components/calendar-alerts.tsx, usunięte) i pierwszej wersji tego
// panelu (pełnowysokościowy aside jak TasksPanel — zbyt duży/nachalny jak
// na zwykłe powiadomienie). Dwa poziomy:
//  1) samo powiadomienie ("N wynajmów bez: ...") — to pokazuje auto-pop po
//     wejściu na /kalendarz (rental-alerts-context.tsx);
//  2) pełna lista, TYLKO po kliknięciu w powiadomienie (toggleExpanded).
// Wysokość: dopasowana do treści, capped na 40% wysokości okna — poza tym
// scroll wewnątrz listy, nie całej strony.
export function RentalAlertsPanel() {
  const { alerts, open, expanded, hide, toggleExpanded } = useRentalAlerts();
  const cardRef = useRef<HTMLDivElement>(null);

  // Klik poza kartą zamyka ją — to lekka, pływająca karta (nie pełnoekranowy
  // panel z przyciemnieniem tła jak TasksPanel), więc potrzebuje własnego
  // "kliknij obok, żeby zamknąć".
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) hide();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, hide]);

  if (!open) return null;

  const n = alerts.length;
  const presentGaps = ALERT_FIELD_ORDER.filter((f) => alerts.some((a) => a.missing.includes(f)))
    .map((f) => ALERT_FIELD_SHORT[f])
    .join(", ");

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white md:right-[72px]"
      style={{ border: `1px solid ${C.border}`, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", maxHeight: "40vh" }}
    >
      <button
        type="button"
        onClick={n > 0 ? toggleExpanded : hide}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        style={{ background: C.redSoft }}
      >
        <span className="text-[13px] font-semibold leading-snug" style={{ color: C.red }}>
          ⚠ {n} {pluralWynajem(n)} w ciągu {ALERT_WINDOW_DAYS} dni bez: {presentGaps}
        </span>
        <span className="flex flex-none items-center gap-1.5">
          {n > 0 && (
            <span
              className={`text-xs transition-transform ${expanded ? "rotate-90" : ""}`}
              style={{ color: C.red }}
              aria-hidden
            >
              ▸
            </span>
          )}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              hide();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                hide();
              }
            }}
            aria-label="Zamknij"
            className="flex h-5 w-5 items-center justify-center rounded-full text-xs hover:bg-black/5"
            style={{ color: C.red }}
          >
            ✕
          </span>
        </span>
      </button>

      {expanded && (
        <ul className="min-h-0 flex-1 overflow-y-auto" style={{ borderTop: `1px solid ${C.border}` }}>
          {alerts.map((a) => (
            <li key={a.id} style={{ borderBottom: `1px solid ${C.border}` }}>
              <Link
                href={`/kalendarz/wynajem/${a.id}?from=/kalendarz`}
                onClick={hide}
                className="flex flex-col gap-1 px-4 py-2.5 hover:bg-[#f8f9fa]"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: C.text }}>
                  <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: a.deviceColor }} />
                  {new Date(a.startsAt).toLocaleDateString("pl-PL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                  {" · "}
                  {a.deviceName}
                </span>
                <span className="truncate text-xs" style={{ color: C.sub }}>
                  {a.title}
                </span>
                <span className="flex flex-wrap gap-1">
                  {a.missing.map((m) => (
                    <span
                      key={m}
                      className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                      style={{ background: C.redSoft, color: C.red }}
                    >
                      {ALERT_FIELD_LABEL[m]}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
