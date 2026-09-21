"use client";

import { SHELL } from "@/components/shell-tokens";
import { useNotifications } from "@/components/notifications-context";

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

// Paragon/raport — "brak raportu kierowcy" (report-alerts-panel.tsx). Ząbkowana
// dolna krawędź jak paragon, dwie linijki tekstu w środku.
function ReceiptIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M6 3.5h12v16.3l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3V3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M8.7 8.5h6.6M8.7 12h6.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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
  tone?: "brand" | "danger" | "report";
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
  // Hook zawsze wywołany (reguły hooków) — warunkowe jest tylko renderowanie
  // samej ikony niżej, żeby nie odpytywać kontekstu na kontach bez uprawnień.
  // Jedna ikonka na oba źródła (kalendarz + przychody, patrz
  // notifications-context.tsx) — badge to suma obu, kolorystyka per typ żyje
  // dopiero w karcie (notifications-panel.tsx), nie na samej ikonce.
  // "Brak raportu kierowcy" ma OSOBNĄ ikonkę i kartę (report-alerts-panel.tsx)
  // — celowo bez auto-popu i bez wliczania do powyższego badge'a, na życzenie
  // użytkownika (to informacja "na żądanie", nie coś co ma wyskakiwać samo
  // przy wejściu na kalendarz).
  const {
    alerts,
    unpriced,
    open: notifOpen,
    show: showNotif,
    hide: hideNotif,
    reportAlerts,
    reportOpen,
    showReport,
    hideReport,
  } = useNotifications();
  const notifCount = alerts.length + unpriced.length;
  const hasNotifications = showNotifications && notifCount > 0;
  const reportCount = reportAlerts.length;
  const hasReportAlerts = showNotifications && reportCount > 0;
  if (!showTasks && !hasNotifications && !hasReportAlerts) return null;

  return (
    <div
      className="hidden w-14 shrink-0 flex-col items-center gap-1.5 py-3.5 md:flex"
      style={{ background: SHELL.surface, borderLeft: `1px solid ${SHELL.border}` }}
    >
      {hasNotifications && (
        <RailIcon
          tooltip={`Powiadomienia (${notifCount})`}
          open={notifOpen}
          onClick={() => {
            hideReport();
            if (notifOpen) hideNotif();
            else showNotif();
          }}
          badge={notifCount}
          tone="danger"
        >
          <WarnIcon />
        </RailIcon>
      )}
      {hasReportAlerts && (
        <RailIcon
          tooltip={`Brak raportu kierowcy (${reportCount})`}
          open={reportOpen}
          onClick={() => {
            hideNotif();
            if (reportOpen) hideReport();
            else showReport();
          }}
          badge={reportCount}
          tone="report"
        >
          <ReceiptIcon />
        </RailIcon>
      )}
      {showTasks && (
        <RailIcon tooltip="Zadania" open={tasksOpen} onClick={onToggleTasks} badge={openTaskCount}>
          <TasksIcon />
        </RailIcon>
      )}
      {/* Osobny, wyłączony placeholder — inny kanał niż powyższa ikona
          (push/dzwonek), która już działa i pokazuje realne dane. */}
      <RailIcon tooltip="Powiadomienia push — wkrótce" disabled>
        <BellOffIcon />
      </RailIcon>
    </div>
  );
}
