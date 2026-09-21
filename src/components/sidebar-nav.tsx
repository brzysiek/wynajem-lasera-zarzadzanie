"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { SHELL, SHELL_FONT_STYLE } from "@/components/shell-tokens";
import { useCalendarDeviceFilter } from "@/components/calendar-device-filter-context";

// Ostatnio odwiedzona podstrona Finansów — fallback nawigacyjny, gdy panel
// jest zwinięty i nie da się pokazać podmenu (docs/prompt-claude-code-powloka-aplikacji.md, sekcja 2.1).
const LAST_FINANCE_PATH_KEY = "wl_last_finance_path";
const DEFAULT_FINANCE_PATH = "/finanse/przychody";

const FINANCE_SUB_ITEMS = [
  { href: "/finanse/przychody", label: "Przychody" },
  { href: "/finanse/koszty", label: "Koszty" },
  { href: "/finanse/koszty/wpisy", label: "Wpisy kosztów" },
  { href: "/finanse/koszty/faktury-paliwa", label: "Faktury paliwa" },
  { href: "/finanse/faktury", label: "Faktury VAT" },
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
// Ikonka podpozycji "Kalendarze" (lista/warstwy) — celowo mniejsza wizualnie
// niż ikony głównych pozycji, bo to pod-element Kalendarza, nie osobna strona.
function LayersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 3 3 7l7 4 7-4-7-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 10.5 10 14.5 17 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 14 10 18 17 14" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
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
      className={`mb-0.5 flex items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
        active ? "shadow-sm" : "hover:bg-white/70"
      }`}
      style={active ? { background: SHELL.brand, color: "#FFFFFF" } : { color: SHELL.sidebarText }}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </Link>
  );
}

// Podpozycja pod "Kalendarz": nie nawiguje, tylko po najechaniu pokazuje
// listę urządzeń/kalendarzy z checkboxami widoczności (ten sam stan co
// filtr na samej stronie kalendarza — src/components/calendar-device-filter-context.tsx).
// Zastępuje dawną osobną kolumnę "URZĄDZENIA" obok siatki kalendarza, żeby
// na desktopie nie było dwóch bocznych pasków naraz.
function CalendarsSubItem({ collapsed, role }: { collapsed: boolean; role?: "ADMIN" | "STAFF" | "KIEROWCA" }) {
  const { devices, checkedIds, toggleDevice, loading, drivers, driverViewId, setDriverView } =
    useCalendarDeviceFilter();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }
  function openFlyout() {
    cancelClose();
    const rect = rowRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top, left: rect.right + 4 });
    setOpen(true);
  }
  useEffect(() => () => cancelClose(), []);

  return (
    // position: fixed liczony z realnej pozycji wiersza (getBoundingClientRect),
    // zamiast absolute wewnątrz <nav>: <nav> ma overflow-y-auto, co (per CSS —
    // ustawienie jednej osi overflow na non-visible wymusza auto na drugiej)
    // przycinało flyout wychodzący poza jego szerokość, więc renderował się
    // niewidoczny/"pod" resztą strony zamiast nad nią.
    <div
      ref={rowRef}
      className="mb-1.5 flex cursor-default items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px]"
      style={{ color: SHELL.sidebarTextDim, marginLeft: collapsed ? 0 : 20 }}
      onMouseEnter={openFlyout}
      onMouseLeave={scheduleClose}
    >
      <LayersIcon />
      {!collapsed && <span>Kalendarze</span>}

      {open && pos && (
        <div
          className="fixed z-[100] w-56 rounded-lg bg-white p-1.5 shadow-lg"
          style={{ top: pos.top, left: pos.left, border: `1px solid ${SHELL.border}` }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Urządzenia</p>
          {loading && <p className="px-2 py-1 text-xs text-gray-400">Ładowanie…</p>}
          {!loading && devices.length === 0 && <p className="px-2 py-1 text-xs text-gray-400">Brak urządzeń.</p>}
          {/* Zaznaczenia zostają widoczne, ale nieaktywne, gdy działa Widok
              kierowcy — to on wtedy decyduje, co widać (patrz calendar-view.tsx). */}
          <div className={driverViewId ? "pointer-events-none opacity-40" : undefined}>
            {devices.map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                <input type="checkbox" checked={checkedIds.has(d.id)} onChange={() => toggleDevice(d.id)} />
                <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: d.color }} />
                <span className="truncate">{d.name}</span>
                {!d.active && <span className="flex-none text-xs text-gray-400">(wycofane)</span>}
              </label>
            ))}
          </div>

          {/* Widok kierowcy — tylko ADMIN (GET /api/users, źródło listy, jest
              admin-only). Wybór jest wyłączny (jeden kierowca naraz) i
              przesłania filtr urządzeń powyżej — klik na już aktywnego
              kierowcę wyłącza widok i wraca do zaznaczonych urządzeń. */}
          {role === "ADMIN" && drivers.length > 0 && (
            <>
              <div className="my-1.5 border-t border-gray-100" />
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Widok kierowcy
              </p>
              {drivers.map((d) => {
                const active = driverViewId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDriverView(active ? null : d.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-gray-50"
                    style={active ? { background: SHELL.brandSoft, color: SHELL.brand, fontWeight: 600 } : { color: "#374151" }}
                  >
                    <span
                      className="h-2.5 w-2.5 flex-none rounded-full border"
                      style={{
                        borderColor: active ? SHELL.brand : "#D1D5DB",
                        background: active ? SHELL.brand : "transparent",
                      }}
                    />
                    <span className="truncate">Widok kierowcy: {d.name}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const financeActive = pathname.startsWith("/finanse");
  // Przychody i Koszty współdzielą wybrany okres (mode/m/from/to/s w URL,
  // docs/prompt-claude-code-dashboard-przychodow.md sekcja 1) — przy
  // przełączaniu MIĘDZY nimi doklej bieżące query params, żeby okres się nie
  // resetował. "Wpisy kosztów" ma świadomie własny, niezależny filtr —
  // zostaje bez params.
  const periodQuery =
    (pathname === "/finanse/przychody" || pathname === "/finanse/koszty") && searchParams.size > 0
      ? `?${searchParams.toString()}`
      : "";
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
            <div key={item.href}>
              <NavRow href={item.href} label={item.label} icon={item.icon} collapsed={collapsed} active={active} />
              {/* Tylko na samej sekcji Kalendarz — na innych stronach (np. Finanse)
                  ten filtr nie ma znaczenia, więc się nie pokazuje. */}
              {item.href === "/kalendarz" && active && <CalendarsSubItem collapsed={collapsed} role={role} />}
            </div>
          );
        }

        // --- pozycja „Finanse" — jedyna z rozwiniętym podmenu wprost w panelu ---
        return (
          <div key="finanse">
            <button
              type="button"
              title={collapsed ? "Finanse" : undefined}
              onClick={() => (collapsed ? goToLastFinancePage() : setManualFinanceOpen((v) => !(v ?? financeActive)))}
              className={`mb-0.5 flex w-full items-center gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                financeActive ? "shadow-sm" : "hover:bg-white/70"
              }`}
              style={financeActive ? { background: SHELL.brand, color: "#FFFFFF" } : { color: SHELL.sidebarText }}
            >
              <FinanceBarsIcon />
              {!collapsed && (
                <>
                  <span>Finanse</span>
                  <span
                    className="ml-auto text-[10px]"
                    style={{ color: financeActive ? "rgba(255,255,255,0.8)" : SHELL.sidebarTextDim }}
                  >
                    {financeOpen ? "▾" : "▸"}
                  </span>
                </>
              )}
            </button>
            {!collapsed && financeOpen && (
              <div className="mb-2 ml-8 mt-0.5">
                {FINANCE_SUB_ITEMS.map((sub) => {
                  const active = pathname === sub.href || pathname.startsWith(`${sub.href}/`);
                  const carriesPeriod = sub.href === "/finanse/przychody" || sub.href === "/finanse/koszty";
                  return (
                    <Link
                      key={sub.href}
                      href={carriesPeriod ? `${sub.href}${periodQuery}` : sub.href}
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
