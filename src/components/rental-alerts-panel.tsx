"use client";

import Link from "next/link";
import { ALERT_FIELD_LABEL, ALERT_WINDOW_DAYS } from "@/lib/rental-alerts";
import { useRentalAlerts } from "@/components/rental-alerts-context";

const C = {
  text: "#202124",
  sub: "#5f6368",
  border: "#e8eaed",
  red: "#D93025",
  redSoft: "#FCE8E6",
};

// Wysuwany panel ostrzeżeń kalendarza — następca banera nad siatką
// (dawne src/components/calendar-alerts.tsx, usunięte). Ta sama treść, inne
// miejsce: ikona na prawym pasku (icon-rail.tsx) + auto-pop po wejściu na
// /kalendarz (src/components/rental-alerts-context.tsx), żeby ważne
// ostrzeżenie nie czekało, aż ktoś zajrzy do paska.
export function RentalAlertsPanel() {
  const { alerts, open, setOpen } = useRentalAlerts();

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/10 md:hidden" onClick={() => setOpen(false)} aria-hidden />
      )}
      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white transition-transform duration-200 sm:w-[380px] md:inset-y-auto md:top-14 md:bottom-0 md:right-14 md:w-[360px] ${
          open ? "translate-x-0" : "translate-x-full md:translate-x-[calc(100%_+_3.5rem)]"
        }`}
        style={{ borderLeft: `1px solid ${C.border}`, boxShadow: open ? "0 0 16px rgba(0,0,0,0.12)" : "none" }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between px-[18px] py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <h2 className="text-[17px] font-semibold" style={{ color: C.text }}>
            ⚠ Ostrzeżenia ({alerts.length})
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <p className="px-[18px] pb-1 pt-3 text-[13px]" style={{ color: C.sub }}>
            Wynajmy w ciągu {ALERT_WINDOW_DAYS} dni bez kompletu danych.
          </p>

          {alerts.length === 0 ? (
            <p className="px-[18px] py-8 text-center text-sm" style={{ color: C.sub }}>
              Brak ostrzeżeń.
            </p>
          ) : (
            <ul>
              {alerts.map((a) => (
                <li key={a.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <Link
                    href={`/kalendarz/wynajem/${a.id}?from=/kalendarz`}
                    onClick={() => setOpen(false)}
                    className="flex flex-col gap-1 px-[18px] py-3 hover:bg-[#f8f9fa]"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium" style={{ color: C.text }}>
                      <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: a.deviceColor }} />
                      {new Date(a.startsAt).toLocaleDateString("pl-PL", {
                        weekday: "short",
                        day: "numeric",
                        month: "short",
                      })}
                      {" · "}
                      {a.deviceName}
                    </span>
                    <span className="text-[13px]" style={{ color: C.sub }}>
                      {a.title}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {a.missing.map((m) => (
                        <span
                          key={m}
                          className="rounded-full px-2 py-0.5 text-xs font-semibold"
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
      </aside>
    </>
  );
}
