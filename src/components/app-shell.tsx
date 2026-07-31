"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "@/components/top-nav";

// The calendar page wants to stretch edge-to-edge (Google Calendar-style
// sidebar + full-width grid), while every other page keeps the centered
// max-w-6xl reading column — so the width constraint lives here, keyed off
// the route, rather than duplicated per-page.
export function AppShell({ userName, children }: { userName: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isFullWidth = pathname === "/kalendarz";

  return (
    <div className="flex flex-1 flex-col">
      <TopNav userName={userName} />
      <main className={isFullWidth ? "flex w-full flex-1 flex-col" : "mx-auto w-full max-w-6xl flex-1 px-4 py-6"}>
        {children}
      </main>
    </div>
  );
}
