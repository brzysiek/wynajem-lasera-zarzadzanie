"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
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

export function TopNav({ userName, role }: { userName: string; role?: "ADMIN" | "STAFF" | "KIEROWCA" }) {
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

        <div className="hidden items-center gap-3 md:flex">
          <span className="text-sm text-gray-600">{userName}</span>
          <LogoutButton />
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
