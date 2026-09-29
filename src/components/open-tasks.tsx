"use client";

import type { OpenTaskDto } from "@/lib/task-links";

// „Otwarte zadania” (wniosek 22, pkt 5) na karcie rezerwacji / klienta /
// sygnału — zadania powiązane z tym rekordem; klik otwiera panel Zadań.
export function openTask(id: string | null) {
  window.dispatchEvent(new CustomEvent("wl:open-task", { detail: id }));
}

const d2 = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
};

export function OpenTasks({ tasks, title = "Otwarte zadania", className = "" }: { tasks: OpenTaskDto[]; title?: string; className?: string }) {
  if (!tasks.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <h3 className="m-0 text-sm font-semibold text-[#0C3450]">
        {title} ({tasks.length})
      </h3>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {tasks.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => openTask(t.id)} className="flex w-full items-baseline gap-2 rounded-[8px] border border-[#E3E6E9] bg-white px-2.5 py-1.5 text-left text-[13px] hover:border-[#1B6FA8]">
              <span className="min-w-0 flex-1 truncate text-[#0C3450]" title={t.title}>
                {t.title}
              </span>
              {t.dueDate && <span className={`flex-none tabular-nums text-[12px] ${t.dueDate < today ? "font-semibold text-[#B8612F]" : "text-[#5C6166]"}`}>{d2(t.dueDate)}</span>}
              {t.assignee && <span className="flex-none text-[12px] text-[#5C6166]">{t.assignee}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
