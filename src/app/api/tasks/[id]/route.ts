import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession, requireStaffSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { logInfo } from "@/lib/logger";
import { parseDueDate, taskDto } from "@/lib/tasks";

const TASK_INCLUDE = {
  author: { select: { id: true, name: true, grammaticalGender: true } },
  assignee: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} as const;

async function assigneeIsAllowed(id: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  return user?.role === "ADMIN" || user?.role === "STAFF";
}

// Zmiana zadania: ADMIN/STAFF — dowolnego; AGENT — tylko własnego (autor),
// każda zmiana w dzienniku zmian. Usuwanie (DELETE) tylko ADMIN/STAFF.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const { id } = await params;
  const isAgent = session.user.role === "AGENT";
  const current = isAgent ? await prisma.task.findUnique({ where: { id } }) : null;
  if (isAgent && !current) return NextResponse.json({ message: "Nie znaleziono zadania." }, { status: 404 });
  if (isAgent && current?.authorId !== session.user.id) {
    return NextResponse.json({ message: "Agent zmienia tylko własne zadania." }, { status: 403 });
  }
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
    if (isAgent && current) {
      const changes = changedFields(current as unknown as Record<string, unknown>, {
        title: task.title,
        notes: task.notes,
        dueDate: task.dueDate,
        assigneeId: task.assigneeId,
        status: task.status,
      });
      await recordChanges(prisma, { userId: session.user.id }, fieldEntries("TASK", id, task.clientId, changes));
    }
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
  const session = await requireStaffSession();
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
