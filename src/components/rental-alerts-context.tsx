"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type { RentalAlert } from "@/lib/rental-alerts";

type RentalAlertsContextValue = {
  alerts: RentalAlert[];
  alertIds: Set<string>;
  // `open` = widoczna karta powiadomienia w ogóle; `expanded` = rozwinięta na
  // pełną listę (drugi poziom, patrz `show`/`toggleExpanded` niżej).
  open: boolean;
  expanded: boolean;
  show: () => void;
  hide: () => void;
  toggleExpanded: () => void;
};

const RentalAlertsContext = createContext<RentalAlertsContextValue | null>(null);
const EMPTY_ALERTS: RentalAlert[] = [];

// Ostrzeżenia kalendarza (wynajmy bez kierowcy/kontaktu/telefonu, patrz
// src/lib/rental-alerts.ts) — jeden fetch dla całej apki, współdzielony przez
// kafelki siatki kalendarza (calendar-view.tsx, czerwona ramka + ⚠) i ikonę +
// panel na prawym pasku (icon-rail.tsx, rental-alerts-panel.tsx). Dawniej to
// był tylko baner nad siatką (calendar-alerts.tsx, usunięty) — ważny, ale
// można było go przeoczyć. Teraz panel WYSUWA SIĘ SAM przy każdym wejściu na
// /kalendarz (poniższy efekt), zamiast czekać aż ktoś kliknie ikonę.
export function RentalAlertsProvider({
  enabled,
  children,
}: {
  enabled: boolean; // ADMIN i nie podgląd kierowcy — inaczej nie ma po co odpytywać.
  children: React.ReactNode;
}) {
  // Surowy wynik ostatniego fetcha — niezależny od `enabled`, żeby wyłączenie
  // (np. wejście w podgląd kierowcy) nie wymagało zerowania stanu w efekcie;
  // widoczne na zewnątrz `alerts` niżej i tak jest pustą tablicą, gdy `enabled`
  // jest false.
  const [rawAlerts, setRawAlerts] = useState<RentalAlert[]>(EMPTY_ALERTS);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pathname = usePathname();

  // Każde świeże pokazanie karty (auto-pop albo klik w ikonę na pasku) startuje
  // zwinięte — samo powiadomienie "czegoś brakuje", bez listy. Rozwinięcie to
  // osobny, świadomy klik (toggleExpanded), patrz rental-alerts-panel.tsx.
  const show = useCallback(() => {
    setOpen(true);
    setExpanded(false);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

  const refresh = useCallback(() => {
    if (!enabled) return;
    fetch(`${BASE_PATH}/api/rentals/alerts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRawAlerts(Array.isArray(d?.alerts) ? d.alerts : EMPTY_ALERTS))
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Odśwież przy każdym wejściu na kalendarz, żeby dane nie były stare po
  // dłuższej sesji (fetch startowy wyżej odpala się tylko raz na cały panel).
  useEffect(() => {
    if (enabled && pathname === "/kalendarz") refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, enabled]);

  const alerts = enabled ? rawAlerts : EMPTY_ALERTS;

  // Auto-pop: raz na każde WEJŚCIE na /kalendarz (świeże ładowanie strony
  // albo nawigacja klientem z innej podstrony) panel sam się wysuwa, jeśli
  // są jakieś ostrzeżenia — nie czeka aż ktoś kliknie ikonę na pasku. Jeśli
  // dane jeszcze się ładują w momencie wejścia, efekt poniżej doczeka ich
  // (reaguje też na zmianę `alerts`), ale wysunie panel tylko raz na wizytę —
  // ręczne zamknięcie na tej samej podstronie zostaje zamknięte.
  const autoOpenedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (pathname !== "/kalendarz") {
      autoOpenedPathRef.current = null;
      return;
    }
    if (!enabled || alerts.length === 0) return;
    if (autoOpenedPathRef.current === pathname) return;
    show();
    autoOpenedPathRef.current = pathname;
  }, [pathname, enabled, alerts, show]);

  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);

  const value = useMemo(
    () => ({ alerts, alertIds, open, expanded, show, hide, toggleExpanded }),
    [alerts, alertIds, open, expanded, show, hide, toggleExpanded],
  );

  return <RentalAlertsContext.Provider value={value}>{children}</RentalAlertsContext.Provider>;
}

export function useRentalAlerts() {
  const ctx = useContext(RentalAlertsContext);
  if (!ctx) throw new Error("useRentalAlerts must be used within RentalAlertsProvider");
  return ctx;
}
