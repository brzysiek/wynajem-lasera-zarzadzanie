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
import { useNotifications } from "@/components/notifications-context";

// Dwie kolorystyki, celowo różne — kalendarz (czerwień, "brakuje danych o
// wynajmie") i przychody (bursztyn, "brakuje pieniędzy w prognozie") to różne
// rodzaje pilności, więc nie powinny wyglądać tak samo mimo wspólnej karty.
// ("Brak raportu kierowcy" ma teraz własną ikonę i kartę — report-alerts-panel.tsx.)
const RED = { text: "#D93025", soft: "#FCE8E6" };
const AMBER = { text: "#B06000", soft: "#FEF7E0" };
const NEUTRAL = { text: "#202124", sub: "#5f6368", border: "#e8eaed" };

function wynajmy(n: number): string {
  if (n === 1) return "wynajem";
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14) ? "wynajmy" : "wynajmów";
}

// Chevron w górę — karta jest zadokowana od dołu (bottom-4), więc rozwinięcie
// listy rośnie w górę ekranu; po rozwinięciu obraca się o 180° (w dół =
// "zwiń z powrotem"). 1.5× większy niż zwykły tekst sekcji (text-lg vs text-xs).
function Chevron({ expanded, color }: { expanded: boolean; color: string }) {
  return (
    <span
      className={`text-lg leading-none transition-transform ${expanded ? "rotate-180" : ""}`}
      style={{ color }}
      aria-hidden
    >
      ▲
    </span>
  );
}

// Karta powiadomień admina — następca banera nad siatką kalendarza (dawne
// src/components/calendar-alerts.tsx) i baneru na /finanse/przychody
// (RevenueNotice w revenue-dashboard.tsx — ten zostaje bez zmian, to
// powiadomienie jest dodatkowe, nie zamiast niego). Jedna ikonka na pasku,
// jedna pływająca karta, dwie niezależnie rozwijalne sekcje. Wysokość karty:
// dopasowana do treści, capped na 40% wysokości okna, scroll wewnątrz.
export function NotificationsPanel() {
  const { alerts, unpriced, open, calendarExpanded, revenueExpanded, hide, toggleCalendarExpanded, toggleRevenueExpanded } =
    useNotifications();
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
  const nCal = alerts.length;
  const nRev = unpriced.length;
  if (nCal === 0 && nRev === 0) return null;

  const presentGaps = ALERT_FIELD_ORDER.filter((f) => alerts.some((a) => a.missing.includes(f)))
    .map((f) => ALERT_FIELD_SHORT[f])
    .join(", ");

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white md:right-[72px]"
      style={{ border: `1px solid ${NEUTRAL.border}`, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", maxHeight: "40vh" }}
    >
      {/* Zamknięcie całej karty — dawniej tylko klik obok, ale to za mało
          oczywiste (nie widać krzyżyka). Pływa nad treścią, żeby działało
          niezależnie od tego, która sekcja (czerwona/bursztynowa) jest na
          górze. */}
      <button
        type="button"
        onClick={hide}
        aria-label="Zamknij powiadomienia"
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-sm font-bold shadow-sm hover:bg-white"
        style={{ color: NEUTRAL.sub }}
      >
        ✕
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {nCal > 0 && (
          <div style={{ borderBottom: nRev > 0 ? `1px solid ${NEUTRAL.border}` : undefined }}>
            <button
              type="button"
              onClick={toggleCalendarExpanded}
              aria-expanded={calendarExpanded}
              className="flex w-full items-center justify-between gap-2 py-3 pl-4 pr-9 text-left"
              style={{ background: RED.soft }}
            >
              <span className="text-[13px] font-semibold leading-snug" style={{ color: RED.text }}>
                ⚠ {nCal} {pluralWynajem(nCal)} w ciągu {ALERT_WINDOW_DAYS} dni bez: {presentGaps}
              </span>
              <Chevron expanded={calendarExpanded} color={RED.text} />
            </button>
            {calendarExpanded && (
              <ul>
                {alerts.map((a) => (
                  <li key={a.id} style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
                    <Link
                      href={`/kalendarz/wynajem/${a.id}?from=/kalendarz`}
                      onClick={hide}
                      className="flex flex-col gap-1 px-4 py-2.5 hover:bg-[#f8f9fa]"
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: NEUTRAL.text }}>
                        <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: a.deviceColor }} />
                        {new Date(a.startsAt).toLocaleDateString("pl-PL", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {" · "}
                        {a.deviceName}
                      </span>
                      <span className="truncate text-xs" style={{ color: NEUTRAL.sub }}>
                        {a.title}
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {a.missing.map((m) => (
                          <span
                            key={m}
                            className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                            style={{ background: RED.soft, color: RED.text }}
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
        )}

        {nRev > 0 && (
          <div>
            <button
              type="button"
              onClick={toggleRevenueExpanded}
              aria-expanded={revenueExpanded}
              className="flex w-full items-center justify-between gap-2 py-3 pl-4 pr-9 text-left"
              style={{ background: AMBER.soft }}
            >
              <span className="text-[13px] font-semibold leading-snug" style={{ color: AMBER.text }}>
                💰 {nRev} {wynajmy(nRev)} w tym i przyszłym miesiącu bez wpisanej kwoty
              </span>
              <Chevron expanded={revenueExpanded} color={AMBER.text} />
            </button>
            {revenueExpanded && (
              <ul>
                {unpriced.map((r) => (
                  <li key={r.id} style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
                    <Link
                      href={`/kalendarz/wynajem/${r.id}?from=/kalendarz`}
                      onClick={hide}
                      className="flex flex-col gap-1 px-4 py-2.5 hover:bg-[#f8f9fa]"
                    >
                      <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: NEUTRAL.text }}>
                        {new Date(r.startsAt).toLocaleDateString("pl-PL", {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                        })}
                        {" · "}
                        {r.deviceName}
                      </span>
                      <span className="truncate text-xs" style={{ color: NEUTRAL.sub }}>
                        {r.title}
                      </span>
                      <span
                        className="w-fit rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: AMBER.soft, color: AMBER.text }}
                      >
                        {r.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
