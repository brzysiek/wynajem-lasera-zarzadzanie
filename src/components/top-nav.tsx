"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/logout-button";

const NAV_ITEMS = [
  { href: "/kalendarz", label: "Kalendarz" },
  { href: "/nadchodzace", label: "Nadchodzące" },
  { href: "/urzadzenia", label: "Urządzenia" },
  { href: "/ustawienia/konto", label: "Ustawienia", match: "/ustawienia" },
];

export function TopNav({ userName }: { userName: string }) {
  const pathname = usePathname();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map((item) => {
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

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">{userName}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
