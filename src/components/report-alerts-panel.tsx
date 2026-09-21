"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { REPORT_FIELD_LABEL, REPORT_FIELD_ORDER } from "@/lib/report-alerts";
import { pluralWynajem } from "@/lib/rental-alerts";
import { useNotifications } from "@/components/notifications-context";

const VIOLET = { text: "#6B46C1", soft: "#F3EEFC" };
const NEUTRAL = { text: "#202124", sub: "#5f6368", border: "#e8eaed" };

// Karta "brak raportu kierowcy" — CELOWO osobna od NotificationsPanel: własna
// ikonka na pasku (icon-rail.tsx, tone "report"), bez auto-popu przy wejściu
// na /kalendarz. Użytkownik świadomie nie chciał, żeby to wyskakiwało samo
// jak alerts/unpriced — to informacja "na żądanie", jeden klik dalej.
export function ReportAlertsPanel() {
  const { reportAlerts, reportOpen, hideReport } = useNotifications();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!reportOpen) return;
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) hideReport();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [reportOpen, hideReport]);

  if (!reportOpen) return null;
  const n = reportAlerts.length;
  if (n === 0) return null;

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white md:right-[72px]"
      style={{ border: `1px solid ${NEUTRAL.border}`, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", maxHeight: "40vh" }}
    >
      <button
        type="button"
        onClick={hideReport}
        aria-label="Zamknij powiadomienia"
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-sm font-bold shadow-sm hover:bg-white"
        style={{ color: NEUTRAL.sub }}
      >
        ✕
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-3 pl-4 pr-9" style={{ background: VIOLET.soft }}>
          <span className="text-[13px] font-semibold leading-snug" style={{ color: VIOLET.text }}>
            📋 {n} {pluralWynajem(n)} zakończonych bez raportu kierowcy
          </span>
        </div>
        <ul>
          {reportAlerts.map((r) => (
            <li key={r.id} style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Link
                href={`/kalendarz/wynajem/${r.id}?from=/kalendarz`}
                onClick={hideReport}
                className="flex flex-col gap-1 px-4 py-2.5 hover:bg-[#f8f9fa]"
              >
                <span className="flex items-center gap-2 text-[13px] font-medium" style={{ color: NEUTRAL.text }}>
                  <span className="h-2 w-2 flex-none rounded-full" style={{ backgroundColor: r.deviceColor }} />
                  {new Date(r.endsAt).toLocaleDateString("pl-PL", {
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
                <span className="flex flex-wrap gap-1">
                  {REPORT_FIELD_ORDER.filter((f) => r.missing.includes(f)).map((m) => (
                    <span
                      key={m}
                      className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                      style={{ background: VIOLET.soft, color: VIOLET.text }}
                    >
                      {REPORT_FIELD_LABEL[m]}
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
