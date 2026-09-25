// Ikony współdzielone MIĘDZY paskiem powiadomień (icon-rail.tsx) i
// kafelkami siatki kalendarza (calendar-view.tsx) — CELOWO ten sam plik,
// żeby oba miejsca zawsze renderowały identyczny kształt. Kolor sterowany
// przez `currentColor` (ustaw przez CSS `color` na rodzicu), więc jeden
// komponent obsługuje zarówno stały ton (pasek) jak i dynamiczny (kafelek:
// czerwony/zielony status faktury).

// Schowek z listą, przekreślony na czerwono ("brak") — "brak raportu
// kierowcy". CELOWO nie paragon/kartka (ten kształt jest pod fakturę VAT,
// patrz InvoiceIcon niżej) — inny kontekst, inna ikona, żeby się nie myliły.
// Przekreślenie zawsze czerwone (nie currentColor), niezależnie od tonu.
export function ClipboardIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="4.5" width="14" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="9" y="3" width="6" height="3" rx="1" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8.5 11.7h7M8.5 15.2h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="4" y1="20.5" x2="20" y2="3.5" stroke="#D93025" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Koperta przekreślona na czerwono ("brak") — "kontrahent bez maila w
// HubSpot", ten sam wzorzec przekreślenia co ClipboardIcon wyżej (zawsze
// czerwone, nie currentColor).
export function MailMissingIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 6.7l7.5 5.8 7.5-5.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="3" y1="19.5" x2="21" y2="4.5" stroke="#D93025" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Paragon/kartka z napisem "FV" — status faktury VAT. Kolor (czerwony =
// brak faktury, zielony = wystawiona) ustawia wywołujący przez `currentColor`.
export function InvoiceIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3.5h12v16.3l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3V3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <text x="12" y="13.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor">
        FV
      </text>
    </svg>
  );
}
