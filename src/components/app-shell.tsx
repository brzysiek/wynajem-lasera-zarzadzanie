"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";
import { TasksPanel } from "@/components/tasks-panel";

// The calendar page wants to stretch edge-to-edge AND fill the viewport
// height (Google Calendar-style: fixed chrome, the grid scrolls inside),
// while every other page keeps the centered max-w-6xl reading column and
// scrolls the page normally. Both constraints live here, keyed off the
// route, rather than duplicated per-page. `min-h-0` lets the calendar's
// inner overflow container actually bound itself instead of growing the
// page.
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
  const [tasksOpen, setTasksOpen] = useState(false);
  const [openTaskCount, setOpenTaskCount] = useState<number | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TopNav
        userName={userName}
        role={role}
        canActAsDriver={canActAsDriver}
        driverPreview={driverPreview}
        showTasks={showTasks}
        openTaskCount={openTaskCount}
        onToggleTasks={() => setTasksOpen((v) => !v)}
      />
      <main
        className={
          isFullWidth
            ? "flex min-h-0 w-full flex-1 flex-col"
            : "mx-auto w-full max-w-6xl flex-1 px-4 py-6"
        }
      >
        {children}
      </main>
      {showTasks && (
        <TasksPanel
          open={tasksOpen}
          onClose={() => setTasksOpen(false)}
          currentUserId={userId}
          onCountChange={setOpenTaskCount}
        />
      )}
    </div>
  );
}
