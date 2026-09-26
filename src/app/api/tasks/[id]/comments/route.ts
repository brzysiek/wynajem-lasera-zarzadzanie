import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { logInfo } from "@/lib/logger";
import type { TaskCommentDto } from "@/lib/tasks";

// Komentarze do zadania (panel Zadań). ADMIN/STAFF/AGENT — odczyt i
// dodawanie; bez edycji i usuwania. Komentarz agenta trafia do dziennika zmian.
async function list(taskId: string): Promise<TaskCommentDto[]> {
  const rows = await prisma.taskComment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    include: { user: { select: { name: true } } },
  });
  return rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: c.user?.name ?? null }));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  return NextResponse.json({ comments: await list(id) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text) return NextResponse.json({ message: "Wpisz treść komentarza." }, { status: 400 });
  const task = await prisma.task.findUnique({ where: { id }, select: { id: true, clientId: true } });
  if (!task) return NextResponse.json({ message: "Nie znaleziono zadania." }, { status: 404 });
  const comment = await prisma.taskComment.create({ data: { taskId: id, userId: session.user.id, body: text } });
  if (session.user.role === "AGENT") {
    await recordChanges(prisma, { userId: session.user.id }, [
      { entity: "TASK_COMMENT", entityId: comment.id, clientId: task.clientId, operation: "CREATE", before: "null", after: toLogValue(text) },
    ]);
  }
  logInfo("task_comment_created", { userId: session.user.id, taskId: id });
  return NextResponse.json({ comments: await list(id) });
}
