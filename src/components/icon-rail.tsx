"use client";

import { SHELL } from "@/components/shell-tokens";

function TasksIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9.5l2 2 4-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

const RAIL_TONE = {
  brand: { fg: SHELL.brand, bg: SHELL.brandSoft, badge: SHELL.accent },
  // Ostrzeżenia kalendarza — celowo poza marką (czerwień, nie brand-blue ani
  // terracotta accentu), żeby wyraźnie odróżnić się od Zadań jako "coś pilnego".
  danger: { fg: "#D93025", bg: "#FCE8E6", badge: "#D93025" },
  // "Brak raportu kierowcy" — fiolet, ten sam co karta (report-alerts-panel.tsx).
  // Inny odcień niż danger, bo to inny rodzaj pilności (operacyjny follow-up,
  // nie brakujące dane samego wynajmu) i celowo bez auto-popu.
  report: { fg: "#6B46C1", bg: "#F3EEFC", badge: "#6B46C1" },
  // "Brak faktury" — rdzawy pomarańcz, ten sam co karta (invoice-alerts-panel.tsx).
  // Trzeci, odrębny odcień — inny temat niż dane wynajmu (danger) i inny niż
  // raport kierowcy (report), też bez auto-popu.
  invoice: { fg: "#C2410C", bg: "#FFF1E8", badge: "#C2410C" },
  // "Brak maila kontrahenta" — róż/malina, ten sam co karta
  // (missing-email-alerts-panel.tsx). Czwarty, odrębny odcień — blokuje
  // wysyłkę faktury/przypomnienia, więc inny temat niż samo "brak faktury".
  mail: { fg: "#9F1239", bg: "#FFE4EC", badge: "#9F1239" },
};

function RailIcon({
  children,
  tooltip,
  open,
  disabled,
  onClick,
  badge,
  tone = "brand",
}: {
  children: React.ReactNode;
  tooltip: string;
  open?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  badge?: number | null;
  tone?: "brand" | "danger" | "report" | "invoice" | "mail";
}) {
  const t = RAIL_TONE[tone];
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={tooltip}
        className="relative flex h-10 w-10 items-center justify-center rounded-[10px]"
        style={{
          color: disabled ? "#DCDFE2" : t.fg,
          background: open ? t.bg : "transparent",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {children}
        {badge != null && badge > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border-2 px-0.5 text-[9px] font-bold text-white"
            style={{ background: t.badge, borderColor: SHELL.surface }}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
      <div
        className="pointer-events-none absolute right-[52px] top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded-md px-2.5 py-1 text-[11.5px] opacity-0 transition-opacity duration-100 group-hover:opacity-100"
        style={{ background: "#2A2E33", color: "#fff" }}
      >
        {tooltip}
      </div>
    </div>
  );
}

// Prawy trwały pasek ikon (docs/prompt-claude-code-powloka-aplikacji.md,
// sekcja 4) — desktop only (mobile zachowuje dzisiejszy przycisk Zadań w
// topbarze, patrz top-nav.tsx). Zaprojektowany jako rozszerzalny: kolejna
// funkcja = kolejny <RailIcon>, ten sam wzorzec klik → slide-out.
export function IconRail({
  showTasks,
  tasksOpen,
  openTaskCount,
  onToggleTasks,
  showNotifications,
}: {
  showTasks: boolean;
  tasksOpen: boolean;
  openTaskCount: number | null;
  onToggleTasks: () => void;
  showNotifications: boolean;
}) {
  // 30.09: braki przy rezerwacjach są w jednym miejscu — Kalendarz → „Do
  // dopięcia” (kafle). Ikony „Powiadomienia”, „Brak raportu kierowcy”, „Brak
  // faktury” i „Brak maila” usunięte z paska; zostają Zadania.
  void showNotifications;
  if (!showTasks) return null;

  return (
    <div
      className="hidden w-14 shrink-0 flex-col items-center gap-1.5 py-3.5 md:flex"
      style={{ background: SHELL.surface, borderLeft: `1px solid ${SHELL.border}` }}
    >
      {showTasks && (
        <RailIcon tooltip="Zadania" open={tasksOpen} onClick={onToggleTasks} badge={openTaskCount}>
          <TasksIcon />
        </RailIcon>
      )}
    </div>
  );
}
