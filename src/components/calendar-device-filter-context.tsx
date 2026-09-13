"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BASE_PATH } from "@/lib/base-path";

// Współdzielony stan "co jest widoczne na kalendarzu" — czytany zarówno przez
// widok kalendarza (src/components/calendar-view.tsx) jak i przez flyout
// "Kalendarze" pod pozycją "Kalendarz" w lewym pasku nawigacji
// (src/components/sidebar-nav.tsx). Provider mieszka w AppShell (poza
// konkretną stroną), więc oba miejsca widzą to samo — bez tego zaznaczenie w
// sidebarze i filtr siatki kalendarza rozjechałyby się.
//
// Dwa niezależne wymiary filtra:
//  - devices/checkedIds: multi-select checkboxa "które urządzenia widać"
//    (GET /api/devices, dostępne dla każdej zalogowanej roli).
//  - drivers/driverViewId: "Widok kierowcy X" — ADMIN-only (GET /api/users
//    jest requireAdminSession, więc nie odpytujemy go dla innych ról), jeden
//    wybrany kierowca naraz. Gdy aktywny, PRZESŁANIA filtr urządzeń —
//    kalendarz pokazuje WSZYSTKIE wynajmy tego kierowcy, niezależnie od
//    zaznaczonych urządzeń (patrz calendar-view.tsx: visibleRentals).
export type CalendarFilterDevice = { id: string; name: string; color: string; active: boolean };
export type CalendarFilterDriver = { id: string; name: string };

type Ctx = {
  devices: CalendarFilterDevice[];
  loading: boolean;
  checkedIds: Set<string>;
  toggleDevice: (id: string) => void;
  drivers: CalendarFilterDriver[];
  driverViewId: string | null;
  setDriverView: (id: string | null) => void;
};

const CalendarDeviceFilterContext = createContext<Ctx | null>(null);
const EMPTY_DRIVERS: CalendarFilterDriver[] = [];

export function CalendarDeviceFilterProvider({
  role,
  children,
}: {
  role?: "ADMIN" | "STAFF" | "KIEROWCA";
  children: ReactNode;
}) {
  const [devices, setDevices] = useState<CalendarFilterDevice[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [rawDrivers, setRawDrivers] = useState<CalendarFilterDriver[]>(EMPTY_DRIVERS);
  const [driverViewId, setDriverViewId] = useState<string | null>(null);

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

  useEffect(() => {
    if (role !== "ADMIN") return;
    let cancelled = false;
    fetch(`${BASE_PATH}/api/users`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list: CalendarFilterDriver[] = Array.isArray(d?.users)
          ? d.users
              .filter((u: { role?: string }) => u.role === "KIEROWCA")
              .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))
          : [];
        setRawDrivers(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [role]);

  // Nie tylko nie pobieramy listy dla nie-ADMINA (GET /api/users jest
  // admin-only) — jeśli rola zmieni się w locie (np. wyjście z podglądu
  // kierowcy), lista i tak nie przecieka: liczy się TA linia, nie stan z
  // ewentualnego wcześniejszego fetcha.
  const drivers = role === "ADMIN" ? rawDrivers : EMPTY_DRIVERS;

  const toggleDevice = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setDriverView = useCallback((id: string | null) => {
    setDriverViewId(id);
  }, []);

  const value = useMemo(
    () => ({ devices, loading, checkedIds, toggleDevice, drivers, driverViewId, setDriverView }),
    [devices, loading, checkedIds, toggleDevice, drivers, driverViewId, setDriverView],
  );

  return <CalendarDeviceFilterContext.Provider value={value}>{children}</CalendarDeviceFilterContext.Provider>;
}

export function useCalendarDeviceFilter(): Ctx {
  const ctx = useContext(CalendarDeviceFilterContext);
  if (!ctx) throw new Error("useCalendarDeviceFilter musi być użyty wewnątrz CalendarDeviceFilterProvider.");
  return ctx;
}
