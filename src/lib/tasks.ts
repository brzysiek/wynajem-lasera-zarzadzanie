// Współdzielone typy i czysta logika listy zadań (API + panel kliencki).
// Bez importu wartości z @prisma/client — plik bezpieczny w bundlu przeglądarki.
import type { GrammaticalGender, Task, TaskStatus } from "@prisma/client";

export type TaskPerson = { id: string; name: string } | null;
export type TaskAuthor = { id: string; name: string; gender: GrammaticalGender | null } | null;

export type TaskDto = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  completedAt: string | null;
  dueDate: string | null; // "YYYY-MM-DD"
  author: TaskAuthor;
  assignee: TaskPerson;
  createdAt: string;
};

type TaskRow = Task & {
  author: { id: string; name: string; grammaticalGender: GrammaticalGender | null } | null;
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
    author: row.author
      ? { id: row.author.id, name: row.author.name, gender: row.author.grammaticalGender }
      : null,
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

// Polska odmiana czasownika wg płci ZLECAJĄCEGO. Null → „zlecił" (fallback,
// nic nie wyświetla się pusto).
export function verbZlecil(gender: GrammaticalGender | null | undefined): string {
  return gender === "F" ? "zleciła" : "zlecił";
}

export type DueChipKind = "today" | "tomorrow" | "overdue" | "future" | "none";
export type DueChip = { kind: DueChipKind; label: string };

// Liczba dni między dwoma datami „YYYY-MM-DD" (lokalna północ).
function dayDiff(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`);
  const b = new Date(`${toISO}T00:00:00`);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Chip terminu wg specyfikacji (docs/panel zadania sekcja 4). Zadanie DONE
// nie sygnalizuje już pilności — chip neutralny („future") z samą datą.
export function dueChip(dueDate: string | null, status: TaskStatus, today: string = todayISO()): DueChip {
  if (!dueDate) return { kind: "none", label: "" };

  const monthDay = new Date(`${dueDate}T00:00:00`).toLocaleDateString("pl-PL", { day: "numeric", month: "short" });
  const diff = dayDiff(today, dueDate);

  if (status === "DONE") return { kind: "future", label: monthDay };
  if (diff === 0) return { kind: "today", label: "Dziś" };
  if (diff === 1) return { kind: "tomorrow", label: "Jutro" };
  if (diff < 0) return { kind: "overdue", label: diff === -1 ? "Wczoraj" : monthDay };
  return { kind: "future", label: monthDay };
}
