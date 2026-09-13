"use client";

import { SHELL } from "@/components/shell-tokens";
import { useRentalAlerts } from "@/components/rental-alerts-context";

function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5 21 19.5H3L12 4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M12 10v4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 9.5l2 2 4-4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 14h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 8a4 4 0 1 1 8 0c0 3 1.2 4.2 1.2 4.2H4.8S6 11 6 8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.3 15a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

const RAIL_TONE = {
  brand: { fg: SHELL.brand, bg: SHELL.brandSoft, badge: SHELL.accent },
  // Ostrzeżenia kalendarza — celowo poza marką (czerwień, nie brand-blue ani
  // terracotta accentu), żeby wyraźnie odróżnić się od Zadań jako "coś pilnego".
  danger: { fg: "#D93025", bg: "#FCE8E6", badge: "#D93025" },
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
  tone?: "brand" | "danger";
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
  showAlerts,
}: {
  showTasks: boolean;
  tasksOpen: boolean;
  openTaskCount: number | null;
  onToggleTasks: () => void;
  showAlerts: boolean;
}) {
  // Hook zawsze wywołany (reguły hooków) — warunkowe jest tylko renderowanie
  // samej ikony niżej, żeby nie odpytywać kontekstu na kontach bez uprawnień.
  const { alerts, open: alertsOpen, setOpen: setAlertsOpen } = useRentalAlerts();
  const hasAlerts = showAlerts && alerts.length > 0;
  if (!showTasks && !hasAlerts) return null;

  return (
    <div
      className="hidden w-14 shrink-0 flex-col items-center gap-1.5 py-3.5 md:flex"
      style={{ background: SHELL.surface, borderLeft: `1px solid ${SHELL.border}` }}
    >
      {hasAlerts && (
        <RailIcon
          tooltip={`Ostrzeżenia kalendarza (${alerts.length})`}
          open={alertsOpen}
          onClick={() => setAlertsOpen(!alertsOpen)}
          badge={alerts.length}
          tone="danger"
        >
          <WarnIcon />
        </RailIcon>
      )}
      {showTasks && (
        <RailIcon tooltip="Zadania" open={tasksOpen} onClick={onToggleTasks} badge={openTaskCount}>
          <TasksIcon />
        </RailIcon>
      )}
      <RailIcon tooltip="Powiadomienia — wkrótce" disabled>
        <BellOffIcon />
      </RailIcon>
    </div>
  );
}
