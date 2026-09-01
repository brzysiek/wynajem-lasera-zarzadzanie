import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo } from "@/lib/logger";
import { parseDueDate, taskDto } from "@/lib/tasks";

const PERSON_SELECT = { select: { id: true, name: true } } as const;
const TASK_INCLUDE = { author: PERSON_SELECT, assignee: PERSON_SELECT } as const;

async function assigneeIsAllowed(id: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return user?.role === "ADMIN" || user?.role === "STAFF";
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  }

  const data: Prisma.TaskUpdateInput = {};

  if ("title" in body) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) return NextResponse.json({ message: "Treść zadania nie może być pusta." }, { status: 400 });
    data.title = title;
  }
  if ("notes" in body) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }
  if ("dueDate" in body) {
    data.dueDate = body.dueDate == null || body.dueDate === "" ? null : parseDueDate(body.dueDate);
  }
  if ("assigneeId" in body) {
    if (body.assigneeId == null || body.assigneeId === "") {
      data.assignee = { disconnect: true };
    } else if (typeof body.assigneeId === "string" && (await assigneeIsAllowed(body.assigneeId))) {
      data.assignee = { connect: { id: body.assigneeId } };
    } else {
      return NextResponse.json({ message: "Nieprawidłowy odpowiedzialny." }, { status: 400 });
    }
  }
  if ("status" in body) {
    if (body.status === "DONE") {
      data.status = "DONE";
      data.completedAt = new Date();
    } else if (body.status === "OPEN") {
      data.status = "OPEN";
      data.completedAt = null;
    } else {
      return NextResponse.json({ message: "Nieprawidłowy status." }, { status: 400 });
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "Brak zmian." }, { status: 400 });
  }

  try {
    const task = await prisma.task.update({ where: { id }, data, include: TASK_INCLUDE });
    logInfo("task_updated", { userId: session.user.id, taskId: id, fields: Object.keys(data) });
    return NextResponse.json({ task: taskDto(task) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono zadania." }, { status: 404 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  try {
    await prisma.task.delete({ where: { id } });
    logInfo("task_deleted", { userId: session.user.id, taskId: id });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ message: "Nie znaleziono zadania." }, { status: 404 });
    }
    throw err;
  }
}
