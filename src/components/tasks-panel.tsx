"use client";

import { useCallback, useEffect, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { isOverdue, type TaskDto } from "@/lib/tasks";

type Person = { id: string; name: string };

function fmtDue(due: string): string {
  return new Date(`${due}T00:00:00`).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
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

  const [newTitle, setNewTitle] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newNotes, setNewNotes] = useState("");
  const [newDue, setNewDue] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [adding, setAdding] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  // onCountChange z AppShell to setter useState — stabilna tożsamość.
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

  // Licznik w pasku ma być aktualny od wejścia na stronę — pobieramy raz na
  // montaż, a potem odświeżamy przy każdym otwarciu panelu.
  useEffect(() => {
    void fetchTasks();
    fetch(`${BASE_PATH}/api/users`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: Person[] = Array.isArray(d?.users)
          ? d.users
              .filter((u: { role?: string }) => u.role !== "KIEROWCA")
              .map((u: { id: string; name: string }) => ({ id: u.id, name: u.name }))
          : [];
        setAssignees(list);
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
      setNewOpen(false);
      await fetchTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setAdding(false);
    }
  }

  async function patchTask(id: string, patch: Record<string, unknown>) {
    // optymistycznie
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
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się zapisać.");
      applyTasks(tasks.map((t) => (t.id === id ? (data.task as TaskDto) : t)));
      // pełny refetch dla porządku (sortowanie, nazwa odpowiedzialnego)
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
    if (!confirm("Usunąć wszystkie ukończone zadania?")) return;
    await fetch(`${BASE_PATH}/api/tasks?status=done`, { method: "DELETE" });
    void fetchTasks();
  }

  const openTasks = tasks.filter((t) => t.status === "OPEN");
  const doneTasks = tasks.filter((t) => t.status === "DONE");

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} aria-hidden />}

      <aside
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-gray-200 bg-white shadow-xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">Zadania</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void fetchTasks()}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
              title="Odśwież"
              aria-label="Odśwież"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
              aria-label="Zamknij"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Dodawanie */}
        <div className="border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addTask();
              }}
              placeholder="Nowe zadanie…"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setNewOpen((v) => !v)}
              className="flex-none rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              aria-expanded={newOpen}
              title="Więcej pól"
            >
              {newOpen ? "▴" : "▾"}
            </button>
            <button
              type="button"
              onClick={() => void addTask()}
              disabled={!newTitle.trim() || adding}
              className="flex-none rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
            >
              Dodaj
            </button>
          </div>
          {newOpen && (
            <div className="mt-2 flex flex-col gap-2">
              <textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Opis (opcjonalnie)"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-gray-500 focus:outline-none"
              />
              <div className="flex gap-2">
                <label className="flex flex-1 flex-col text-xs text-gray-500">
                  Termin
                  <input
                    type="date"
                    value={newDue}
                    onChange={(e) => setNewDue(e.target.value)}
                    className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                  />
                </label>
                <label className="flex flex-1 flex-col text-xs text-gray-500">
                  Odpowiedzialny
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
                  >
                    <option value="">—</option>
                    {assignees.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {error && <p className="px-2 py-1 text-xs text-red-600">{error}</p>}
          {loading && tasks.length === 0 && <p className="px-2 py-2 text-sm text-gray-400">Ładowanie…</p>}

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

          {openTasks.length === 0 && !loading && (
            <p className="px-2 py-6 text-center text-sm text-gray-400">Brak otwartych zadań.</p>
          )}

          {doneTasks.length > 0 && (
            <div className="mt-2 border-t border-gray-200 pt-2">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center justify-between px-2 py-1 text-xs font-medium text-gray-500"
              >
                <span>Ukończone ({doneTasks.length})</span>
                <span>{showDone ? "▴" : "▾"}</span>
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
                    className="mt-1 px-2 py-1 text-xs text-red-600 hover:underline"
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

  // Zsynchronizuj lokalne pola, gdy zadanie zmieni się z serwera — wzorzec
  // „adjust state during render" (bez efektu), jak trackedPathname w top-nav.
  const [synced, setSynced] = useState({ title: task.title, notes: task.notes ?? "" });
  if (synced.title !== task.title || synced.notes !== (task.notes ?? "")) {
    setSynced({ title: task.title, notes: task.notes ?? "" });
    setTitle(task.title);
    setNotes(task.notes ?? "");
  }

  const meta: string[] = [];
  if (task.assignee) meta.push(`→ ${task.assignee.name}`);
  if (task.author) meta.push(`utw. ${task.author.name}`);

  return (
    <div className="rounded-md px-1 hover:bg-gray-50">
      <div className="flex items-start gap-2 py-1.5">
        <input
          type="checkbox"
          checked={done}
          onChange={onComplete}
          className="mt-0.5 h-4 w-4 flex-none accent-gray-900"
          aria-label={done ? "Oznacz jako otwarte" : "Oznacz jako zrobione"}
        />
        <button type="button" onClick={onToggleExpand} className="min-w-0 flex-1 text-left">
          <span className={`block text-sm ${done ? "text-gray-400 line-through" : "text-gray-900"}`}>
            {task.title}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-gray-400">
            {task.dueDate && (
              <span className={isOverdue(task) ? "font-medium text-red-600" : ""}>📅 {fmtDue(task.dueDate)}</span>
            )}
            {meta.join(" · ")}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-2 pb-3 pl-6 pr-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title.trim() !== task.title && onPatch({ title: title.trim() })}
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
          />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes.trim() !== (task.notes ?? "") && onPatch({ notes: notes.trim() })}
            rows={2}
            placeholder="Opis"
            className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
          />
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col text-xs text-gray-500">
              Termin
              <input
                type="date"
                value={task.dueDate ?? ""}
                onChange={(e) => onPatch({ dueDate: e.target.value || null })}
                className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
              />
            </label>
            <label className="flex flex-1 flex-col text-xs text-gray-500">
              Odpowiedzialny
              <select
                value={task.assignee?.id ?? ""}
                onChange={(e) => onPatch({ assigneeId: e.target.value || null })}
                className="mt-0.5 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
              >
                <option value="">—</option>
                {assignees.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="self-start text-xs text-red-600 hover:underline"
          >
            Usuń zadanie
          </button>
        </div>
      )}
    </div>
  );
}
