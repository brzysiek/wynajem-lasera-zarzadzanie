"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { SHELL, SHELL_FONT_STYLE } from "@/components/shell-tokens";

// Ostatnio odwiedzona podstrona Finansów — fallback nawigacyjny, gdy panel
// jest zwinięty i nie da się pokazać podmenu (docs/prompt-claude-code-powloka-aplikacji.md, sekcja 2.1).
const LAST_FINANCE_PATH_KEY = "wl_last_finance_path";
const DEFAULT_FINANCE_PATH = "/finanse/przychody";

const FINANCE_SUB_ITEMS = [
  { href: "/finanse/przychody", label: "Przychody" },
  { href: "/finanse/koszty", label: "Koszty" },
  { href: "/finanse/koszty/wpisy", label: "Wpisy kosztów" },
];

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 8h14" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 6v4l3 2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function DeviceBoxIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="14" height="10" rx="1.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7 17.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
function SmsBubbleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M3 5.5c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2v6c0 1.1-.9 2-2 2H8l-3.5 3v-3H5c-1.1 0-2-.9-2-2v-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function FinanceBarsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 16V9M9 16V5M14 16v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1 4.7 4.7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

type PlainItem = { kind: "link"; href: string; label: string; match?: string; icon: React.ReactNode };
type FinanceItem = { kind: "finance" };

// Widok kierowcy (prawdziwy albo podgląd) zachowuje dzisiejsze okrojenie:
// tylko Kalendarz, bez Finansów/Ustawień — ten sam wzorzec co dotychczasowy
// DRIVER_NAV_ITEMS w top-nav.tsx.
function itemsFor(role: "ADMIN" | "STAFF" | "KIEROWCA" | undefined): (PlainItem | FinanceItem)[] {
  const calendar: PlainItem = { kind: "link", href: "/kalendarz", label: "Kalendarz", icon: <CalendarIcon /> };
  if (role === "KIEROWCA") return [calendar];

  const items: (PlainItem | FinanceItem)[] = [
    calendar,
    { kind: "link", href: "/nadchodzace", label: "Nadchodzące", icon: <ClockIcon /> },
    { kind: "link", href: "/urzadzenia", label: "Urządzenia", icon: <DeviceBoxIcon /> },
    { kind: "link", href: "/wysylka-sms", label: "Wysyłka SMS", icon: <SmsBubbleIcon /> },
  ];
  if (role === "ADMIN") items.push({ kind: "finance" });
  return items;
}

function NavRow({
  href,
  label,
  icon,
  collapsed,
  active,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      title={collapsed ? label : undefined}
      className="mb-0.5 flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium"
      style={
        active
          ? { background: SHELL.brandSoft, color: SHELL.brand }
          : { color: SHELL.sidebarText }
      }
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

export function SidebarNav({
  role,
  collapsed,
}: {
  role?: "ADMIN" | "STAFF" | "KIEROWCA";
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const financeActive = pathname.startsWith("/finanse");
  const [manualFinanceOpen, setManualFinanceOpen] = useState<boolean | null>(null);
  const financeOpen = manualFinanceOpen ?? financeActive;

  // Zapamiętaj ostatnią podstronę Finansów — fallback dla zwiniętego panelu.
  useEffect(() => {
    if (financeActive) {
      try {
        localStorage.setItem(LAST_FINANCE_PATH_KEY, pathname);
      } catch {
        // localStorage niedostępny (np. tryb prywatny) — fallback i tak zadziała na DEFAULT_FINANCE_PATH.
      }
    }
  }, [financeActive, pathname]);

  function goToLastFinancePage() {
    let target = DEFAULT_FINANCE_PATH;
    try {
      target = localStorage.getItem(LAST_FINANCE_PATH_KEY) || DEFAULT_FINANCE_PATH;
    } catch {
      // ignoruj — użyj domyślnej
    }
    router.push(`${BASE_PATH}${target}`);
  }

  const items = itemsFor(role);

  return (
    <nav
      className="hidden shrink-0 flex-col overflow-y-auto px-2.5 py-3.5 transition-[width] duration-[180ms] ease-in-out md:flex"
      style={{
        width: collapsed ? 64 : 220,
        background: SHELL.sidebarBg,
        borderRight: `1px solid ${SHELL.border}`,
        ...SHELL_FONT_STYLE,
      }}
    >
      {items.map((item) => {
        if (item.kind === "link") {
          const active = pathname.startsWith(item.match ?? item.href);
          return (
            <NavRow
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              collapsed={collapsed}
              active={active}
            />
          );
        }

        // --- pozycja „Finanse" — jedyna z rozwiniętym podmenu wprost w panelu ---
        return (
          <div key="finanse">
            <button
              type="button"
              title={collapsed ? "Finanse" : undefined}
              onClick={() => (collapsed ? goToLastFinancePage() : setManualFinanceOpen((v) => !(v ?? financeActive)))}
              className="mb-0.5 flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium"
              style={financeActive ? { background: SHELL.brandSoft, color: SHELL.brand } : { color: SHELL.sidebarText }}
            >
              <FinanceBarsIcon />
              {!collapsed && (
                <>
                  <span>Finanse</span>
                  <span className="ml-auto text-[10px]" style={{ color: SHELL.sidebarTextDim }}>
                    {financeOpen ? "▾" : "▸"}
                  </span>
                </>
              )}
            </button>
            {!collapsed && financeOpen && (
              <div className="mb-2 ml-8 mt-0.5">
                {FINANCE_SUB_ITEMS.map((sub) => {
                  const active = pathname === sub.href || pathname.startsWith(`${sub.href}/`);
                  return (
                    <Link
                      key={sub.href}
                      href={sub.href}
                      className="mb-px block rounded-md px-2.5 py-[7px] text-[13.5px]"
                      style={active ? { color: SHELL.brand, fontWeight: 600 } : { color: SHELL.sidebarTextDim }}
                    >
                      {sub.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {role !== "KIEROWCA" && (
        <>
          <div className="my-2.5 mx-1.5 h-px" style={{ background: SHELL.border }} />
          <NavRow
            href="/ustawienia/przypomnienia-sms"
            label="Ustawienia"
            icon={<GearIcon />}
            collapsed={collapsed}
            active={pathname.startsWith("/ustawienia")}
          />
        </>
      )}
    </nav>
  );
}
