"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/ustawienia/integracje/google", label: "Google Calendar" },
  { href: "/ustawienia/integracje/hubspot", label: "HubSpot" },
  { href: "/ustawienia/integracje/szybkisms", label: "SzybkiSMS" },
];

export function IntegrationsTabs() {
  const pathname = usePathname();

  return (
    <nav className="mb-6 flex gap-1 border-b border-gray-200">
      {TABS.map((tab) => {
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
