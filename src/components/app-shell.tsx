"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";
import { SidebarNav } from "@/components/sidebar-nav";
import { IconRail } from "@/components/icon-rail";
import { TasksPanel } from "@/components/tasks-panel";
import { SHELL } from "@/components/shell-tokens";
import { CalendarDeviceFilterProvider } from "@/components/calendar-device-filter-context";
import { NotificationsProvider } from "@/components/notifications-context";
import { NotificationsPanel } from "@/components/notifications-panel";
import { FuelPriceReminder } from "@/components/fuel-price-reminder";

// Kosmetyczny stan UI (nie dane biznesowe) — przetrwa odświeżenie strony,
// docs/prompt-claude-code-powloka-aplikacji.md, sekcja 1.2.
const SIDEBAR_COLLAPSED_KEY = "wl_sidebar_collapsed";

// The calendar page wants to stretch edge-to-edge AND fill the viewport
// height (Google Calendar-style: fixed chrome, the grid scrolls inside),
// while every other page keeps the centered max-w-6xl reading column and
// scrolls the page normally. Both constraints live here, keyed off the
// route, rather than duplicated per-page. `min-h-0` lets the calendar's
// inner overflow container actually bound itself instead of growing the
// page.
//
// Powłoka (docs/prompt-claude-code-powloka-aplikacji.md): topbar na całą
// szerokość + trzy kolumny poniżej (lewy panel / treść / prawy pasek ikon).
// Treść stron (w tym paleta/kolory) zostaje bez zmian — zmienia się tylko
// rama wokół niej. Na wąskim ekranie (< md) rama sprzed tej zmiany zostaje
// 1:1 (hamburger + rozwijane menu w TopNav) — sidebar/pasek ikon są
// widoczne tylko od `md:` w górę, świadomie (mockup dotyczy desktopu).
export function AppShell({
  userName,
  userId,
  role,
  canActAsDriver = false,
  driverPreview = false,
  children,
}: {
  userName: string;
  userId: string;
  role?: "ADMIN" | "STAFF" | "KIEROWCA";
  canActAsDriver?: boolean;
  driverPreview?: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isFullWidth = pathname === "/kalendarz";
  // Lista zadań: ADMIN i STAFF (biuro). Kierowca i podgląd kierowcy — nie.
  const showTasks = role === "ADMIN" || role === "STAFF";
  // Centrum powiadomień (ostrzeżenia kalendarza + przychodów): tylko
  // prawdziwy ADMIN, nie podgląd kierowcy — patrz notifications-context.tsx.
  const showNotifications = role === "ADMIN" && !driverPreview;
  const [tasksOpen, setTasksOpen] = useState(false);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);

  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      // localStorage niedostępny (tryb prywatny itp.) — zostań rozwinięty.
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // best-effort — brak zapisu nie blokuje samego zwijania w tej sesji.
      }
      return next;
    });
  }

  return (
    <CalendarDeviceFilterProvider>
      <NotificationsProvider enabled={showNotifications}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TopNav
            userName={userName}
            role={role}
            canActAsDriver={canActAsDriver}
            driverPreview={driverPreview}
            showTasks={showTasks}
            openTaskCount={openTaskCount}
            onToggleTasks={() => setTasksOpen((v) => !v)}
            onToggleSidebarCollapse={toggleCollapsed}
          />
          {/* min-w-0 tutaj i na `main` poniżej: bez tego wąski viewport pozwala
              contentowi strony (np. siatce kalendarza z min-w-[640px]) rozepchnąć
              CAŁY wiersz i wypchnąć pasek ikon po prawej poza ekran, zamiast
              przewinąć się wewnątrz własnego kontenera (calendar-view.tsx ma już
              na to overflow-auto — potrzebuje tylko żeby przodkowie pozwolili mu
              się skurczyć). */}
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <SidebarNav role={role} collapsed={collapsed} />

            <main
              className={
                isFullWidth
                  ? "flex min-h-0 min-w-0 w-full flex-1 flex-col"
                  : "w-full min-w-0 flex-1 overflow-y-auto"
              }
              style={isFullWidth ? undefined : { background: SHELL.bg }}
            >
              <div className={isFullWidth ? undefined : "mx-auto max-w-6xl px-4 py-6 md:px-[30px] md:py-[26px]"}>
                {children}
              </div>
            </main>

            <IconRail
              showTasks={showTasks}
              tasksOpen={tasksOpen}
              openTaskCount={openTaskCount}
              onToggleTasks={() => setTasksOpen((v) => !v)}
              showNotifications={showNotifications}
            />

            {showTasks && (
              <TasksPanel
                open={tasksOpen}
                onClose={() => setTasksOpen(false)}
                currentUserId={userId}
                onCountChange={setOpenTaskCount}
              />
            )}
            {showNotifications && <NotificationsPanel />}
          </div>
        </div>
        <FuelPriceReminder role={role} />
      </NotificationsProvider>
    </CalendarDeviceFilterProvider>
  );
}
