import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaffSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";
import { parseDueDate, taskDto } from "@/lib/tasks";

const TASK_INCLUDE = {
  author: { select: { id: true, name: true, grammaticalGender: true } },
  assignee: { select: { id: true, name: true } },
} as const;

// Odpowiedzialnym może być ADMIN lub STAFF (biuro). Kierowca nie.
async function assigneeIsAllowed(id: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return user?.role === "ADMIN" || user?.role === "STAFF";
}

export async function GET(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const status = req.nextUrl.searchParams.get("status") ?? "all";
  const where = status === "open" ? { status: "OPEN" as const } : status === "done" ? { status: "DONE" as const } : {};

  const tasks = await prisma.task.findMany({
    where,
    include: TASK_INCLUDE,
    orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json({ tasks: tasks.map(taskDto) });
}

export async function POST(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ message: "Wpisz treść zadania." }, { status: 400 });

  const notes = typeof body?.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  const dueDate = parseDueDate(body?.dueDate);

  let assigneeId: string | null = null;
  if (typeof body?.assigneeId === "string" && body.assigneeId) {
    if (!(await assigneeIsAllowed(body.assigneeId))) {
      return NextResponse.json({ message: "Nieprawidłowy odpowiedzialny." }, { status: 400 });
    }
    assigneeId = body.assigneeId;
  }

  const task = await prisma.task.create({
    data: { title, notes, dueDate, assigneeId, authorId: session.user.id },
    include: TASK_INCLUDE,
  });
  logInfo("task_created", { userId: session.user.id, taskId: task.id });

  return NextResponse.json({ task: taskDto(task) });
}

// Kasuje wszystkie ukończone zadania („Wyczyść ukończone"). Wymaga ?status=done
// jako zabezpieczenia przed przypadkowym wyczyszczeniem całej listy.
export async function DELETE(req: NextRequest) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  if (req.nextUrl.searchParams.get("status") !== "done") {
    return NextResponse.json({ message: "Nieprawidłowe żądanie." }, { status: 400 });
  }

  const { count } = await prisma.task.deleteMany({ where: { status: "DONE" } });
  logInfo("tasks_cleared_completed", { userId: session.user.id, count });

  return NextResponse.json({ ok: true, count });
}
