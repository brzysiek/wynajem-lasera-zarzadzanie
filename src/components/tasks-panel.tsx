"use client";

import { useCallback, useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { isOverdue, type TaskDto } from "@/lib/tasks";

type Person = { id: string; name: string };

function fmtDue(due: string): string {
  const d = new Date(`${due}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Dziś";
  if (diff === 1) return "Jutro";
  if (diff === -1) return "Wczoraj";
  return d.toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
}

// Kolory Google Tasks / Material.
const C = {
  text: "#202124",
  sub: "#5f6368",
  border: "#dadce0",
  hover: "#f1f3f4",
  field: "#f8f9fa",
  blue: "#1a73e8",
  red: "#d93025",
};

function CheckCircle({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={done ? "Cofnij ukończenie" : "Oznacz jako ukończone"}
      className="group/cc mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-2 transition-colors"
      style={{ borderColor: C.sub, backgroundColor: done ? C.sub : "transparent" }}
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

export function TasksPanel({
  open,
  onClose,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onCountChange?: (openCount: number) => void;
}) {
  const [tasks, setTasks] = useState<TaskDto[]>([]);
  const [assignees, setAssignees] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [composing, setComposing] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [adding, setAdding] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  const applyTasks = useCallback(
    (list: TaskDto[]) => {
      setTasks(list);
      onCountChange?.(list.filter((t) => t.status === "OPEN").length);
    },
    [onCountChange],
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
      setNewDue("");
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
    setNewDue("");
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

  const openTasks = tasks.filter((t) => t.status === "OPEN");
  const doneTasks = tasks.filter((t) => t.status === "DONE");

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
        <header
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${C.border}` }}
        >
          <h2 className="text-base font-medium" style={{ color: C.text }}>
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

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {/* Dodaj zadanie */}
          {!composing ? (
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-sm hover:bg-[#f1f3f4]"
              style={{ color: C.sub }}
            >
              <span className="flex h-5 w-5 flex-none items-center justify-center text-lg leading-none" style={{ color: C.blue }}>
                +
              </span>
              Dodaj zadanie
            </button>
          ) : (
            <div className="rounded-lg p-3" style={{ background: C.field }}>
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void addTask();
                  if (e.key === "Escape") closeComposer();
                }}
                placeholder="Tytuł zadania"
                className="w-full bg-transparent text-sm outline-none placeholder:text-[#5f6368]"
                style={{ color: C.text }}
              />
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Szczegóły"
                className="mt-2 w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-[#5f6368]"
                style={{ color: C.text }}
              />
              <div className="mt-1 flex gap-2">
                <input
                  type="date"
                  value={newDue}
                  onChange={(e) => setNewDue(e.target.value)}
                  className="flex-1 rounded border px-2 py-1 text-xs outline-none"
                  style={{ borderColor: C.border, color: C.sub }}
                />
                <select
                  value={newAssignee}
                  onChange={(e) => setNewAssignee(e.target.value)}
                  className="flex-1 rounded border px-2 py-1 text-xs outline-none"
                  style={{ borderColor: C.border, color: C.sub }}
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

          {error && <p className="px-2 py-1 text-xs" style={{ color: C.red }}>{error}</p>}
          {loading && tasks.length === 0 && (
            <p className="px-2 py-2 text-sm" style={{ color: C.sub }}>
              Ładowanie…
            </p>
          )}

          <div className="mt-1">
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
            <p className="px-2 py-8 text-center text-sm" style={{ color: C.sub }}>
              Brak zadań. Miło.
            </p>
          )}

          {doneTasks.length > 0 && (
            <div className="mt-3" style={{ borderTop: `1px solid ${C.border}` }}>
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-1 px-2 py-2 text-sm font-medium"
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
                    className="mt-1 px-2 py-1.5 text-xs hover:underline"
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

  const metaBits: string[] = [];
  if (task.assignee) metaBits.push(task.assignee.name);
  if (task.author) metaBits.push(`zlecił: ${task.author.name}`);
  const meta = metaBits.join(" · ");

  return (
    <div className="rounded-lg transition-colors hover:bg-[#f1f3f4]">
      <div className="flex items-start gap-3 px-2 py-2">
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
          {(task.dueDate || meta) && (
            <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: C.sub }}>
              {task.dueDate && (
                <span style={isOverdue(task) ? { color: C.red, fontWeight: 500 } : undefined}>
                  {fmtDue(task.dueDate)}
                </span>
              )}
              {meta && <span>{meta}</span>}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div className="mb-1 ml-8 mr-2 rounded-lg p-3" style={{ background: C.field }}>
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
            className="mt-2 w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-[#5f6368]"
            style={{ color: C.text }}
          />
          <div className="mt-1 flex gap-2">
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => onPatch({ dueDate: e.target.value || null })}
              className="flex-1 rounded border px-2 py-1 text-xs outline-none"
              style={{ borderColor: C.border, color: C.sub }}
            />
            <select
              value={task.assignee?.id ?? ""}
              onChange={(e) => onPatch({ assigneeId: e.target.value || null })}
              className="flex-1 rounded border px-2 py-1 text-xs outline-none"
              style={{ borderColor: C.border, color: C.sub }}
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
