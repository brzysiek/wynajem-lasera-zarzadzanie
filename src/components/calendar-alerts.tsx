"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ALERT_FIELD_LABEL,
  ALERT_FIELD_ORDER,
  ALERT_FIELD_SHORT,
  ALERT_WINDOW_DAYS,
  pluralWynajem,
  type RentalAlert,
} from "@/lib/rental-alerts";

// Czerwone powiadomienie nad siatką kalendarza (tylko admin): wynajmy z
// najbliższych dni bez kierowcy / kontaktu / telefonu. Zwinięte domyślnie —
// nagłówek z liczbą jest zawsze widoczny; lista rozwija się po kliknięciu.
export function CalendarAlerts({ alerts }: { alerts: RentalAlert[] }) {
  const [open, setOpen] = useState(false);
  if (alerts.length === 0) return null;

  const n = alerts.length;
  // Tylko te kategorie braków, które faktycznie występują wśród wynajmów.
  const presentGaps = ALERT_FIELD_ORDER.filter((f) => alerts.some((a) => a.missing.includes(f)))
    .map((f) => ALERT_FIELD_SHORT[f])
    .join(", ");

  return (
    <div className="mb-2 rounded-md border border-red-300 bg-red-50 text-red-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold"
      >
        <span>
          ⚠ {n} {pluralWynajem(n)} w ciągu {ALERT_WINDOW_DAYS} dni bez: {presentGaps}
        </span>
        <span className={`flex-none text-xs transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <ul className="border-t border-red-200 px-3 py-1 text-sm">
          {alerts.map((a) => (
            <li key={a.id} className="border-b border-red-100 last:border-b-0">
              <Link
                href={`/kalendarz/wynajem/${a.id}?from=/kalendarz`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 hover:underline"
              >
                <span className="font-medium tabular-nums text-red-900">
                  {new Date(a.startsAt).toLocaleDateString("pl-PL", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <span className="inline-flex items-center gap-1 text-red-900">
                  <span
                    className="h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: a.deviceColor }}
                  />
                  {a.deviceName}
                </span>
                <span className="text-red-700">{a.title}</span>
                <span className="flex flex-wrap gap-1">
                  {a.missing.map((m) => (
                    <span
                      key={m}
                      className="rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold text-red-800"
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
