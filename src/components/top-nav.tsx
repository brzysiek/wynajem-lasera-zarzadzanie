"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { LogoutButton } from "@/components/logout-button";

const NAV_ITEMS = [
  { href: "/kalendarz", label: "Kalendarz" },
  { href: "/nadchodzace", label: "Nadchodzące" },
  { href: "/urzadzenia", label: "Urządzenia" },
  { href: "/wysylka-sms", label: "Wysyłka SMS" },
  { href: "/ustawienia/przypomnienia-sms", label: "Ustawienia", match: "/ustawienia" },
];

// A driver only ever has the read-only calendar.
const DRIVER_NAV_ITEMS = NAV_ITEMS.filter((item) => item.href === "/kalendarz");

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
      {open ? (
        <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L8.94 10l-4.72 4.72a.75.75 0 1 0 1.06 1.06L10 11.06l4.72 4.72a.75.75 0 1 0 1.06-1.06L11.06 10l4.72-4.72a.75.75 0 0 0-1.06-1.06L10 8.94 5.28 4.22Z" />
      ) : (
        <path
          fillRule="evenodd"
          d="M3 5.75A.75.75 0 0 1 3.75 5h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 5.75Zm0 4.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75A.75.75 0 0 1 3 10Zm0 4.25a.75.75 0 0 1 .75-.75h12.5a.75.75 0 0 1 0 1.5H3.75a.75.75 0 0 1-.75-.75Z"
          clipRule="evenodd"
        />
      )}
    </svg>
  );
}

function SteeringWheelIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="1" />
      <path d="M12 13v8" />
      <path d="M12.87 12.4l7.13 2.6" />
      <path d="M11.13 12.4 4 15" />
    </svg>
  );
}

// Suwak Panel ↔ Kierowca w prawym górnym rogu (widoczny w obu trybach) —
// zastępuje w całości baner „podgląd kierowcy" i przycisk powrotu.
function ViewToggle({ driverActive }: { driverActive: boolean }) {
  const [busy, setBusy] = useState(false);
  function toggle() {
    if (busy) return;
    setBusy(true);
    void fetch(`${BASE_PATH}/api/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: driverActive ? "panel" : "driver" }),
    })
      .catch(() => {})
      // Pełne przeładowanie — middleware musi przeliczyć rolę efektywną.
      .finally(() => window.location.assign(`${BASE_PATH}/kalendarz`));
  }
  return (
    <div className="flex items-center gap-2">
      <span
        className={`text-xs font-medium ${driverActive ? "text-gray-400" : "font-semibold text-[#8a5a2b]"}`}
      >
        Panel
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={driverActive}
        aria-label="Przełącz między widokiem panelu a widokiem kierowcy"
        onClick={toggle}
        disabled={busy}
        className={`relative inline-flex h-6 w-11 flex-none items-center rounded-full transition-colors disabled:opacity-50 ${
          driverActive ? "bg-blue-600" : "bg-[#8a5a2b]"
        }`}
      >
        <span
          className={`inline-flex h-5 w-5 transform items-center justify-center rounded-full bg-white shadow transition-transform ${
            driverActive ? "translate-x-[22px] text-blue-600" : "translate-x-0.5 text-[#8a5a2b]"
          }`}
        >
          <SteeringWheelIcon className="h-3 w-3" />
        </span>
      </button>
      <span
        className={`inline-flex items-center gap-1 text-xs font-medium ${
          driverActive ? "font-semibold text-blue-700" : "text-gray-400"
        }`}
      >
        <SteeringWheelIcon className="h-3.5 w-3.5" />
        Kierowca
      </span>
    </div>
  );
}

function TasksButton({ count, onClick }: { count: number | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Zadania"
      className="relative rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
        <path d="M7 3a2 2 0 0 0-2 2H4.5A1.5 1.5 0 0 0 3 6.5v9A1.5 1.5 0 0 0 4.5 17h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 15.5 5H15a2 2 0 0 0-2-2H7Zm0 1.5h6a.5.5 0 0 1 .5.5v.5a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5V5a.5.5 0 0 1 .5-.5Zm-.28 5.03a.75.75 0 0 0-1.06 1.06l1.5 1.5a.75.75 0 0 0 1.06 0l3-3a.75.75 0 1 0-1.06-1.06L7.69 10.5l-.97-.97Z" />
      </svg>
      {count != null && count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 min-w-[1.1rem] rounded-full bg-red-600 px-1 text-center text-[11px] font-bold leading-[1.1rem] text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

export function TopNav({
  userName,
  role,
  canActAsDriver = false,
  driverPreview = false,
  showTasks = false,
  openTaskCount = null,
  onToggleTasks,
}: {
  userName: string;
  role?: "ADMIN" | "STAFF" | "KIEROWCA";
  canActAsDriver?: boolean;
  driverPreview?: boolean;
  showTasks?: boolean;
  openTaskCount?: number | null;
  onToggleTasks?: () => void;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = role === "KIEROWCA" ? DRIVER_NAV_ITEMS : NAV_ITEMS;

  // Route changes (including a nav-link click) should close the mobile
  // menu — adjusted during render (React's recommended pattern) rather
  // than an effect, so it takes effect in the same commit as navigation.
  const [trackedPathname, setTrackedPathname] = useState(pathname);
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname);
    setMenuOpen(false);
  }

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? "Zamknij menu" : "Otwórz menu"}
            aria-expanded={menuOpen}
            className="mr-1 flex-none rounded-md p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          >
            <HamburgerIcon open={menuOpen} />
          </button>
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.match ?? item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {canActAsDriver && <ViewToggle driverActive={driverPreview} />}
          {showTasks && onToggleTasks && <TasksButton count={openTaskCount} onClick={onToggleTasks} />}
          <div className="hidden items-center gap-3 md:flex">
            <span className="text-sm text-gray-600">{userName}</span>
            <LogoutButton />
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="border-t border-gray-200 px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = pathname.startsWith(item.match ?? item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    isActive
                      ? "bg-gray-900 text-white"
                      : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-3">
            <span className="text-sm text-gray-600">{userName}</span>
            <LogoutButton />
          </div>
        </div>
      )}
    </header>
  );
}
