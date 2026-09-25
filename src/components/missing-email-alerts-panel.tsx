"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { pluralWynajem } from "@/lib/missing-email-alerts";
import { useNotifications } from "@/components/notifications-context";
import { MailMissingIcon } from "@/components/status-icons";

const ROSE = { text: "#9F1239", soft: "#FFE4EC" };
const NEUTRAL = { text: "#202124", sub: "#5f6368", border: "#e8eaed" };

// Karta "brak maila kontrahenta" — ten sam wzorzec co invoice-alerts-panel.tsx
// / report-alerts-panel.tsx: własna ikonka na pasku (icon-rail.tsx, tone
// "mail"), bez auto-popu przy wejściu na /kalendarz. Bez zapisanego maila w
// HubSpot nie da się utworzyć ani szkicu faktury, ani przypomnienia o
// płatności (patrz src/lib/invoicing/contact-email.ts) — kliknięcie w
// wynajem prowadzi do jego karty, gdzie widać kontakt i można go odświeżyć
// z HubSpota.
export function MissingEmailAlertsPanel() {
  const { missingEmailAlerts, missingEmailOpen, hideMissingEmail } = useNotifications();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!missingEmailOpen) return;
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) hideMissingEmail();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [missingEmailOpen, hideMissingEmail]);

  if (!missingEmailOpen) return null;
  const n = missingEmailAlerts.length;
  if (n === 0) return null;

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white md:right-[72px]"
      style={{ border: `1px solid ${NEUTRAL.border}`, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", maxHeight: "40vh" }}
    >
      <button
        type="button"
        onClick={hideMissingEmail}
        aria-label="Zamknij powiadomienia"
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-sm font-bold shadow-sm hover:bg-white"
        style={{ color: NEUTRAL.sub }}
      >
        ✕
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 py-3 pl-4 pr-9" style={{ background: ROSE.soft }}>
          <span className="flex-none" style={{ color: ROSE.text }}>
            <MailMissingIcon />
          </span>
          <span className="text-[13px] font-semibold leading-snug" style={{ color: ROSE.text }}>
            {n} {pluralWynajem(n)} bez maila kontrahenta w HubSpot
          </span>
        </div>
        <ul>
          {missingEmailAlerts.map((r) => (
            <li key={r.id} style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Link
                href={`/kalendarz/wynajem/${r.id}?from=/kalendarz`}
                onClick={hideMissingEmail}
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
                  {r.contactName ? r.contactName : r.title}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
