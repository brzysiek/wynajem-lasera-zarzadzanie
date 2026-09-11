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

function BellOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M6 8a4 4 0 1 1 8 0c0 3 1.2 4.2 1.2 4.2H4.8S6 11 6 8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.3 15a1.8 1.8 0 0 0 3.4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function RailIcon({
  children,
  tooltip,
  open,
  disabled,
  onClick,
  badge,
}: {
  children: React.ReactNode;
  tooltip: string;
  open?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  badge?: number | null;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        aria-label={tooltip}
        className="relative flex h-10 w-10 items-center justify-center rounded-[10px]"
        style={{
          color: disabled ? "#DCDFE2" : open ? SHELL.brand : SHELL.textMuted,
          background: open ? SHELL.brandSoft : "transparent",
          cursor: disabled ? "default" : "pointer",
        }}
      >
        {children}
        {badge != null && badge > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full border-2 px-0.5 text-[9px] font-bold text-white"
            style={{ background: SHELL.accent, borderColor: SHELL.surface }}
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
}: {
  showTasks: boolean;
  tasksOpen: boolean;
  openTaskCount: number | null;
  onToggleTasks: () => void;
}) {
  if (!showTasks) return null;

  return (
    <div
      className="hidden w-14 shrink-0 flex-col items-center gap-1.5 py-3.5 md:flex"
      style={{ background: SHELL.surface, borderLeft: `1px solid ${SHELL.border}` }}
    >
      <RailIcon tooltip="Zadania" open={tasksOpen} onClick={onToggleTasks} badge={openTaskCount}>
        <TasksIcon />
      </RailIcon>
      <RailIcon tooltip="Powiadomienia — wkrótce" disabled>
        <BellOffIcon />
      </RailIcon>
    </div>
  );
}
