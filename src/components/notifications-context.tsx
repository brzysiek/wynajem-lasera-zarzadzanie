"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type { RentalAlert } from "@/lib/rental-alerts";
import type { UnpricedRental } from "@/lib/revenue/aggregate";

type NotificationsContextValue = {
  // Ostrzeżenia kalendarza — wynajmy bez kierowcy/kontaktu/telefonu (patrz
  // src/lib/rental-alerts.ts). `alertIds` używane też przez kafelki siatki
  // kalendarza (calendar-view.tsx, czerwona ramka + ⚠), niezależnie od tego
  // czy karta powiadomień jest otwarta.
  alerts: RentalAlert[];
  alertIds: Set<string>;
  // Ostrzeżenia przychodów — wynajmy/szkolenia bez wpisanej kwoty w bieżącym
  // + następnym miesiącu (patrz GET /api/rentals/revenue-alerts).
  unpriced: UnpricedRental[];
  // Jedna karta na obie sekcje: `open` = karta w ogóle widoczna; każda sekcja
  // rozwija swoją listę osobno (`calendarExpanded` / `revenueExpanded`).
  open: boolean;
  calendarExpanded: boolean;
  revenueExpanded: boolean;
  show: () => void;
  hide: () => void;
  toggleCalendarExpanded: () => void;
  toggleRevenueExpanded: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
const EMPTY_ALERTS: RentalAlert[] = [];
const EMPTY_UNPRICED: UnpricedRental[] = [];

// Centrum powiadomień admina — JEDNA ikonka + karta na prawym pasku (patrz
// icon-rail.tsx, notifications-panel.tsx), na razie dwa niezależne źródła:
// braki danych w kalendarzu (czerwone) i braki kwot wynajmu / preliminarz
// przychodu (żółte/amber — inna kolorystyka niż kalendarz, celowo, żeby nie
// mylić "brak kontaktu" z "brak pieniędzy"). Każde źródło ma swój fetch i
// swój stan rozwinięcia listy, ale współdzielą jedną widoczność karty i jeden
// auto-pop przy wejściu na /kalendarz — to jedyna strona, na którą i tak
// wchodzisz regularnie, więc to tu ważne rzeczy mają szansę zostać zauważone
// (dawniej osobny baner nad siatką kalendarza i osobny baner na
// /finanse/przychody — oba łatwo przeoczyć, bo trzeba było wiedzieć, że tam
// zajrzeć).
export function NotificationsProvider({
  enabled,
  children,
}: {
  enabled: boolean; // ADMIN i nie podgląd kierowcy — inaczej nie ma po co odpytywać.
  children: React.ReactNode;
}) {
  const [rawAlerts, setRawAlerts] = useState<RentalAlert[]>(EMPTY_ALERTS);
  const [rawUnpriced, setRawUnpriced] = useState<UnpricedRental[]>(EMPTY_UNPRICED);
  const [open, setOpen] = useState(false);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [revenueExpanded, setRevenueExpanded] = useState(false);
  const pathname = usePathname();

  // Każde świeże pokazanie karty (auto-pop albo klik w ikonę na pasku) startuje
  // z obiema sekcjami zwiniętymi — samo powiadomienie, bez list. Rozwinięcie
  // to osobny, świadomy klik na daną sekcję (notifications-panel.tsx).
  const show = useCallback(() => {
    setOpen(true);
    setCalendarExpanded(false);
    setRevenueExpanded(false);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const toggleCalendarExpanded = useCallback(() => setCalendarExpanded((v) => !v), []);
  const toggleRevenueExpanded = useCallback(() => setRevenueExpanded((v) => !v), []);

  const refresh = useCallback(() => {
    if (!enabled) return;
    fetch(`${BASE_PATH}/api/rentals/alerts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRawAlerts(Array.isArray(d?.alerts) ? d.alerts : EMPTY_ALERTS))
      .catch(() => {});
    fetch(`${BASE_PATH}/api/rentals/revenue-alerts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRawUnpriced(Array.isArray(d?.unpriced) ? d.unpriced : EMPTY_UNPRICED))
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
  const unpriced = enabled ? rawUnpriced : EMPTY_UNPRICED;

  // Auto-pop: raz na każde WEJŚCIE na /kalendarz (świeże ładowanie strony
  // albo nawigacja klientem z innej podstrony) karta sama się pokazuje, jeśli
  // jest COKOLWIEK do zgłoszenia (dowolne z dwóch źródeł) — nie czeka aż ktoś
  // kliknie ikonę. Jeśli dane jeszcze się ładują w momencie wejścia, efekt
  // poniżej doczeka ich (reaguje też na zmianę `alerts`/`unpriced`), ale
  // pokaże kartę tylko raz na wizytę — ręczne zamknięcie na tej samej
  // podstronie zostaje zamknięte.
  const autoOpenedPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (pathname !== "/kalendarz") {
      autoOpenedPathRef.current = null;
      return;
    }
    if (!enabled || (alerts.length === 0 && unpriced.length === 0)) return;
    if (autoOpenedPathRef.current === pathname) return;
    show();
    autoOpenedPathRef.current = pathname;
  }, [pathname, enabled, alerts, unpriced, show]);

  const alertIds = useMemo(() => new Set(alerts.map((a) => a.id)), [alerts]);

  const value = useMemo(
    () => ({
      alerts,
      alertIds,
      unpriced,
      open,
      calendarExpanded,
      revenueExpanded,
      show,
      hide,
      toggleCalendarExpanded,
      toggleRevenueExpanded,
    }),
    [alerts, alertIds, unpriced, open, calendarExpanded, revenueExpanded, show, hide, toggleCalendarExpanded, toggleRevenueExpanded],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
