"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ALL_TABS = [
  { href: "/ustawienia/integracje", label: "Integracje", adminOnly: true },
  { href: "/ustawienia/szablony", label: "Szablony", adminOnly: false },
  { href: "/ustawienia/przypomnienia-sms", label: "Przypomnienia SMS", adminOnly: false },
  { href: "/ustawienia/bramka", label: "Bramka", adminOnly: true },
  { href: "/ustawienia/uzytkownicy", label: "Użytkownicy", adminOnly: true },
];

export function SettingsTabs({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const tabs = ALL_TABS.filter((tab) => !tab.adminOnly || isAdmin);

  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-200">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              isActive
                ? "border-gray-900 text-gray-900"
                : "border-transparent text-gray-500 hover:text-gray-900"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
