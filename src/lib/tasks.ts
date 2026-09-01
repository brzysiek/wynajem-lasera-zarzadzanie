// Współdzielone typy listy zadań (API + panel kliencki). Bez importu wartości
// z @prisma/client — plik bezpieczny w bundlu przeglądarki.
import type { Task, TaskStatus } from "@prisma/client";

export type TaskPerson = { id: string; name: string } | null;

export type TaskDto = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  completedAt: string | null;
  dueDate: string | null; // "YYYY-MM-DD"
  author: TaskPerson;
  assignee: TaskPerson;
  createdAt: string;
};

type TaskRow = Task & {
  author: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
};

export function taskDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    dueDate: row.dueDate ? row.dueDate.toISOString().slice(0, 10) : null,
    author: row.author,
    assignee: row.assignee,
    createdAt: row.createdAt.toISOString(),
  };
}

// "YYYY-MM-DD" z <input type="date"> -> Date (północ UTC) albo null.
export function parseDueDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Zadanie po terminie (dueDate < dziś) i wciąż otwarte.
export function isOverdue(task: TaskDto): boolean {
  if (task.status !== "OPEN" || !task.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return task.dueDate < today;
}
