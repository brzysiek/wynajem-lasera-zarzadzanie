"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BASE_PATH } from "@/lib/base-path";

// Współdzielony stan "które urządzenia są widoczne na kalendarzu" —
// czytany zarówno przez widok kalendarza (src/components/calendar-view.tsx)
// jak i przez flyout "Kalendarze" pod pozycją "Kalendarz" w lewym pasku
// nawigacji (src/components/sidebar-nav.tsx). Provider mieszka w AppShell
// (poza konkretną stroną), więc oba miejsca widzą to samo — bez tego
// zaznaczenie w sidebarze i filtr siatki kalendarza rozjechałyby się.
//
// Provider sam pobiera listę urządzeń (GET /api/devices, dostępne dla
// każdej zalogowanej roli) — nie zależy od tego, czy /kalendarz jest akurat
// zamontowany, więc flyout działa też zanim użytkownik tam wejdzie.
export type CalendarFilterDevice = { id: string; name: string; color: string; active: boolean };

type Ctx = {
  devices: CalendarFilterDevice[];
  loading: boolean;
  checkedIds: Set<string>;
  toggleDevice: (id: string) => void;
};

const CalendarDeviceFilterContext = createContext<Ctx | null>(null);

export function CalendarDeviceFilterProvider({ children }: { children: ReactNode }) {
  const [devices, setDevices] = useState<CalendarFilterDevice[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE_PATH}/api/devices`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: CalendarFilterDevice[] = Array.isArray(d?.devices)
          ? d.devices.map((dev: { id: string; name: string; color: string; active: boolean }) => ({
              id: dev.id,
              name: dev.name,
              color: dev.color,
              active: dev.active,
            }))
          : [];
        setDevices(list);
        // Domyślnie wszystkie widoczne (jak dotychczasowe zachowanie
        // calendar-view.tsx przed wydzieleniem tego stanu).
        setCheckedIds(new Set(list.map((dev) => dev.id)));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleDevice = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ devices, loading, checkedIds, toggleDevice }), [devices, loading, checkedIds, toggleDevice]);

  return <CalendarDeviceFilterContext.Provider value={value}>{children}</CalendarDeviceFilterContext.Provider>;
}

export function useCalendarDeviceFilter(): Ctx {
  const ctx = useContext(CalendarDeviceFilterContext);
  if (!ctx) throw new Error("useCalendarDeviceFilter musi być użyty wewnątrz CalendarDeviceFilterProvider.");
  return ctx;
}
