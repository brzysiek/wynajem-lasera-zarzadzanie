"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { pluralWynajem } from "@/lib/invoice-alerts";
import { useNotifications } from "@/components/notifications-context";
import { InvoiceIcon } from "@/components/status-icons";

const RUST = { text: "#C2410C", soft: "#FFF1E8" };
const NEUTRAL = { text: "#202124", sub: "#5f6368", border: "#e8eaed" };

// Karta "brak faktury" — ten sam wzorzec co report-alerts-panel.tsx: własna
// ikonka na pasku (icon-rail.tsx, tone "invoice"), bez auto-popu przy
// wejściu na /kalendarz. Lista pokazuje tylko wynajmy BEZ wystawionej
// faktury (needed) — to lista "do zrobienia", nie log wszystkich
// zafakturowanych rozliczeń (te widać jako zielona plakietka na kafelku).
export function InvoiceAlertsPanel() {
  const { invoiceAlerts, invoiceOpen, hideInvoice } = useNotifications();
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!invoiceOpen) return;
    function onDoc(e: MouseEvent) {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) hideInvoice();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [invoiceOpen, hideInvoice]);

  if (!invoiceOpen) return null;
  const n = invoiceAlerts.length;
  if (n === 0) return null;

  return (
    <div
      ref={cardRef}
      className="fixed bottom-4 right-4 z-50 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl bg-white md:right-[72px]"
      style={{ border: `1px solid ${NEUTRAL.border}`, boxShadow: "0 8px 28px rgba(0,0,0,0.18)", maxHeight: "40vh" }}
    >
      <button
        type="button"
        onClick={hideInvoice}
        aria-label="Zamknij powiadomienia"
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-sm font-bold shadow-sm hover:bg-white"
        style={{ color: NEUTRAL.sub }}
      >
        ✕
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 py-3 pl-4 pr-9" style={{ background: RUST.soft }}>
          <span className="flex-none" style={{ color: RUST.text }}>
            <InvoiceIcon />
          </span>
          <span className="text-[13px] font-semibold leading-snug" style={{ color: RUST.text }}>
            {n} {pluralWynajem(n)} zakończonych z VAT bez wystawionej faktury
          </span>
        </div>
        <ul>
          {invoiceAlerts.map((r) => (
            <li key={r.id} style={{ borderBottom: `1px solid ${NEUTRAL.border}` }}>
              <Link
                href={`/kalendarz/wynajem/${r.id}?from=/kalendarz`}
                onClick={hideInvoice}
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
                <span
                  className="w-fit rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                  style={{ background: RUST.soft, color: RUST.text }}
                >
                  {r.amount}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
