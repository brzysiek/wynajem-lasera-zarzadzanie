"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { avatarColor, avatarInitial } from "@/lib/avatar-color";
import { dueChip, verbZlecil, type DueChipKind, type TaskDto } from "@/lib/tasks";

type Person = { id: string; name: string };

// Kolory Google Tasks / Material (docs/panel zadania sekcja 7).
const C = {
  text: "#202124",
  sub: "#5f6368",
  faint: "#9aa0a6",
  border: "#e8eaed",
  fieldBorder: "#dadce0",
  field: "#f8f9fa",
  hover: "#f1f3f4",
  blue: "#1a73e8",
  bluePale: "#e8f0fe",
  red: "#d93025",
};

const CHIP: Record<Exclude<DueChipKind, "none">, { bg: string; fg: string }> = {
  today: { bg: "#e8f0fe", fg: "#1a73e8" },
  tomorrow: { bg: "#fef7e0", fg: "#b06000" },
  overdue: { bg: "#fce8e6", fg: "#d93025" },
  future: { bg: "#f1f3f4", fg: "#5f6368" },
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function plusDaysISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function CheckCircle({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? "Cofnij ukończenie" : "Oznacz jako ukończone"}
      className="group/cc mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition-colors"
      style={{ borderColor: done ? C.blue : C.fieldBorder, backgroundColor: done ? C.blue : "transparent" }}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-3 w-3 ${done ? "text-white" : "text-[#5f6368] opacity-0 transition-opacity group-hover/cc:opacity-40"}`}
      >
        <path d="M4 10l4 4 8-9" />
      </svg>
    </button>
  );
}

function AssigneePill({ person }: { person: Person }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 text-xs"
      style={{ background: C.field, border: `1px solid ${C.border}`, color: C.text }}
    >
      <span
        className="flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{ background: avatarColor(person.id) }}
      >
        {avatarInitial(person.name)}
      </span>
      {person.name}
    </span>
  );
}

function DueBadge({ dueDate, status }: { dueDate: string | null; status: TaskDto["status"] }) {
  const chip = dueChip(dueDate, status);
  if (chip.kind === "none") return null;
  const c = CHIP[chip.kind];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11.5px] font-semibold"
      style={{ background: c.bg, color: c.fg }}
    >
      📅 {chip.label}
    </span>
  );
}

// Wybór terminu: chip (jeśli ustawiony) / „＋ Termin" jako trigger, po kliknięciu
// popover z Dzisiaj / Jutro / Wybierz datę… / Usuń termin.
function DuePicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const chip = dueChip(value, "OPEN");

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full px-2 py-[3px] text-[11.5px] font-semibold"
        style={
          chip.kind === "none"
            ? { border: `1px dashed ${C.fieldBorder}`, color: C.sub }
            : { background: CHIP[chip.kind].bg, color: CHIP[chip.kind].fg }
        }
      >
        {chip.kind === "none" ? "＋ Termin" : chip.label}
      </button>
      {open && (
        <div
          className="absolute left-0 z-10 mt-1 w-40 rounded-lg bg-white py-1 text-sm shadow-lg"
          style={{ border: `1px solid ${C.border}` }}
        >
          {[
            { label: "Dzisiaj", v: todayISO() },
            { label: "Jutro", v: plusDaysISO(1) },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => {
                onChange(o.v);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f3f4]"
              style={{ color: C.text }}
            >
              {o.label}
            </button>
          ))}
          <label className="block px-3 py-1.5 text-left hover:bg-[#f1f3f4]" style={{ color: C.text }}>
            Wybierz datę…
            <input
              type="date"
              value={value ?? ""}
              onChange={(e) => {
                onChange(e.target.value || null);
                setOpen(false);
              }}
              className="mt-1 block w-full rounded border px-1 py-0.5 text-xs"
              style={{ borderColor: C.fieldBorder, color: C.sub }}
            />
          </label>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-[#f1f3f4]"
              style={{ color: C.red }}
            >
              Usuń termin
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function sortOpen(a: TaskDto, b: TaskDto): number {
  // z terminem przed bez terminu; wśród z terminem — rosnąco wg daty.
  if (a.dueDate && b.dueDate) return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  if (a.dueDate) return -1;
  if (b.dueDate) return 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function TasksPanel({
  open,
  onClose,
  currentUserId,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  currentUserId: string;
  onCountChange?: (myOpenCount: number) => void;
}) {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [assignees, setAssignees] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDue, setNewDue] = useState<string | null>(null);
  const [newAssignee, setNewAssignee] = useState("");
  const [adding, setAdding] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const applyTasks = useCallback(
    (list: TaskDto[]) => {
      setTasks(list);
      onCountChange?.(list.filter((t) => t.status === "OPEN" && t.assignee?.id === currentUserId).length);
    },
    [onCountChange, currentUserId],
  );

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/tasks?status=all`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wczytać zadań.");
      applyTasks(Array.isArray(data?.tasks) ? data.tasks : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setLoading(false);
    }
  }, [applyTasks]);

  useEffect(() => {
    void fetchTasks();
    fetch(`${BASE_PATH}/api/users`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setAssignees(
          Array.isArray(d?.users)
            ? d.users
                .filter((u: { role?: string }) => u.role !== "KIEROWCA")
                .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))
            : [],
        );
      })
      .catch(() => {});
  }, [fetchTasks]);

  useEffect(() => {
    if (open) void fetchTasks();
  }, [open, fetchTasks]);

  async function addTask() {
    const title = newTitle.trim();
    if (!title || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          notes: newNotes.trim() || undefined,
          dueDate: newDue || undefined,
          assigneeId: newAssignee || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się dodać zadania.");
      setNewTitle("");
      setNewNotes("");
      setNewDue(null);
      setNewAssignee("");
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setAdding(false);
    }
  }

  function closeComposer() {
    setComposing(false);
    setNewTitle("");
    setNewNotes("");
    setNewDue(null);
    setNewAssignee("");
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              ...("status" in patch ? { status: patch.status as TaskDto["status"] } : {}),
              ...("title" in patch ? { title: String(patch.title) } : {}),
              ...("notes" in patch ? { notes: (patch.notes as string) || null } : {}),
              ...("dueDate" in patch ? { dueDate: (patch.dueDate as string) || null } : {}),
            }
          : t,
      ),
    );
    try {
      const res = await fetch(`${BASE_PATH}/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || "Nie udało się zapisać.");
      }
      void fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
      void fetchTasks();
    }
  }

  async function deleteTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch(`${BASE_PATH}/api/tasks/${id}`, { method: "DELETE" });
    } finally {
      void fetchTasks();
    }
  }

  async function clearCompleted() {
    if (!window.confirm("Usunąć wszystkie ukończone zadania?")) return;
    await fetch(`${BASE_PATH}/api/tasks?status=done`, { method: "DELETE" });
    void fetchTasks();
  }

  const openTasks = tasks.filter((t) => t.status === "OPEN").sort(sortOpen);
  const doneTasks = tasks
    .filter((t) => t.status === "DONE")
    .sort((a, b) => ((a.completedAt ?? "") < (b.completedAt ?? "") ? 1 : -1));

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white transition-transform duration-200 sm:w-[380px] ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ borderLeft: `1px solid ${C.border}`, boxShadow: open ? "0 0 16px rgba(0,0,0,0.12)" : "none" }}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between px-[18px] py-4" style={{ borderBottom: `1px solid ${C.border}` }}>
          <h2 className="text-[17px] font-semibold" style={{ color: C.text }}>
            Zadania
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void fetchTasks()}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              title="Odśwież"
              aria-label="Odśwież"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#f1f3f4]"
              aria-label="Zamknij"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {!composing ? (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="flex w-full items-center gap-3 px-[18px] py-3.5 text-sm font-medium hover:bg-[#f8f9fa]"
              style={{ color: C.blue, borderBottom: `1px solid ${C.border}` }}
            >
              <span
                className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 text-sm leading-none"
                style={{ borderColor: C.blue }}
              >
                +
              </span>
              Dodaj zadanie
            </button>
          ) : (
            <div className="m-2 rounded-[10px] p-3" style={{ background: C.field }}>
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTask();
                  if (e.key === "Escape") closeComposer();
                }}
                placeholder="Tytuł zadania"
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: C.text }}
              />
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Szczegóły"
                className="mt-2 w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-[#9aa0a6]"
                style={{ color: C.text }}
              />
              <div className="mt-1 flex items-center gap-2">
                <DuePicker value={newDue} onChange={setNewDue} />
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="flex-1 rounded border px-2 py-1 text-xs outline-none"
                  style={{ borderColor: C.fieldBorder, color: C.sub }}
                >
                  <option value="">Odpowiedzialny…</option>
                  {assignees.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2 flex items-center justify-end gap-3">
                <button type="button" onClick={closeComposer} className="text-xs" style={{ color: C.sub }}>
                  Anuluj
                </button>
                <button
                  type="button"
                  onClick={() => void addTask()}
                  disabled={!newTitle.trim() || adding}
                  className="rounded px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
                  style={{ background: C.blue }}
                >
                  Dodaj
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="px-[18px] py-1 text-xs" style={{ color: C.red }}>
              {error}
            </p>
          )}
          {loading && tasks.length === 0 && (
            <p className="px-[18px] py-2 text-sm" style={{ color: C.sub }}>
              Ładowanie…
            </p>
          )}

          <div className="py-1">
            {openTasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                assignees={assignees}
                expanded={expandedId === t.id}
                onToggleExpand={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                onComplete={() => void patchTask(t.id, { status: "DONE" })}
                onPatch={(p) => void patchTask(t.id, p)}
                onDelete={() => void deleteTask(t.id)}
              />
            ))}
          </div>

          {openTasks.length === 0 && !loading && (
            <p className="px-[18px] py-8 text-center text-sm" style={{ color: C.sub }}>
              Brak zadań. Miło.
            </p>
          )}

          {doneTasks.length > 0 && (
            <div style={{ borderTop: `1px solid ${C.border}` }}>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-1.5 px-[18px] py-3 text-[13px] font-semibold"
                style={{ color: C.sub }}
              >
                <span className="text-xs">{showDone ? "▾" : "▸"}</span>
                Ukończone ({doneTasks.length})
              </button>
              {showDone && (
                <>
                  {doneTasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      assignees={assignees}
                      expanded={expandedId === t.id}
                      onToggleExpand={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                      onComplete={() => void patchTask(t.id, { status: "OPEN" })}
                      onPatch={(p) => void patchTask(t.id, p)}
                      onDelete={() => void deleteTask(t.id)}
                    />
                  ))}
                  <button
                    type="button"
                    onClick={() => void clearCompleted()}
                    className="mb-2 px-[18px] py-1.5 text-xs hover:underline"
                    style={{ color: C.sub }}
                  >
                    Wyczyść ukończone
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function TaskRow({
  task,
  assignees,
  expanded,
  onToggleExpand,
  onComplete,
  onPatch,
  onDelete,
}: {
  task: TaskDto;
  assignees: Person[];
  expanded: boolean;
  onToggleExpand: () => void;
  onComplete: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
}) {
  const done = task.status === "DONE";
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");

  // „adjust state during render" (bez efektu) — sync po zmianie z serwera.
  const [synced, setSynced] = useState({ title: task.title, notes: task.notes ?? "" });
  if (synced.title !== task.title || synced.notes !== (task.notes ?? "")) {
    setSynced({ title: task.title, notes: task.notes ?? "" });
    setTitle(task.title);
    setNotes(task.notes ?? "");
  }

  // Linia „zlecił(a)" — tylko gdy zlecający ≠ odpowiedzialny (sekcja 2).
  const showCreator = task.author && (!task.assignee || task.assignee.id !== task.author.id);

  return (
    <div className="transition-colors hover:bg-[#f8f9fa]">
      <div className="flex items-start gap-3 px-[18px] py-[11px]">
        <CheckCircle done={done} onClick={onComplete} />
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span
            className={`block text-sm leading-5 ${done ? "line-through" : ""}`}
            style={{ color: done ? C.sub : C.text }}
          >
            {task.title}
          </span>
          {task.notes && !expanded && (
            <span className="mt-0.5 block truncate text-xs" style={{ color: C.sub }}>
              {task.notes}
            </span>
          )}
          <span className="mt-1 flex flex-wrap items-center gap-2">
            {!done && <DueBadge dueDate={task.dueDate} status={task.status} />}
            {task.assignee && <AssigneePill person={task.assignee} />}
            {showCreator && (
              <span className="text-xs" style={{ color: C.sub }}>
                {verbZlecil(task.author!.gender)}: {task.author!.name}
              </span>
            )}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="mb-2 ml-[50px] mr-[18px] rounded-[10px] p-3" style={{ background: C.field }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== task.title && onPatch({ title: title.trim() })}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: C.text }}
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes.trim() !== (task.notes ?? "") && onPatch({ notes: notes.trim() })}
            rows={2}
            placeholder="Szczegóły"
            className="mt-2 w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-[#9aa0a6]"
            style={{ color: C.text }}
          />
          <div className="mt-1 flex items-center gap-2">
            <DuePicker value={task.dueDate} onChange={(v) => onPatch({ dueDate: v })} />
            <select
              value={task.assignee?.id ?? ""}
              onChange={(e) => onPatch({ assigneeId: e.target.value || null })}
              className="flex-1 rounded border px-2 py-1 text-xs outline-none"
              style={{ borderColor: C.fieldBorder, color: C.sub }}
            >
              <option value="">Odpowiedzialny…</option>
              {assignees.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onDelete}
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5"
              style={{ color: C.sub }}
              aria-label="Usuń zadanie"
              title="Usuń zadanie"
            >
              🗑
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
