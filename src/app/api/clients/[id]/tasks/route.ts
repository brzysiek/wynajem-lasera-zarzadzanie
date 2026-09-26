import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { toLogValue } from "@/lib/changelog/diff";
import { recordChanges } from "@/lib/changelog/record";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { parseDay } from "@/lib/leads/validate";
import { logInfo } from "@/lib/logger";

// Zadanie przy kliencie (np. „Zadanie z tego maila”) — w istniejącym panelu
// Zadań, z linkiem do klienta. ADMIN/STAFF — zadanie dla siebie; AGENT —
// zadanie dla wskazanej osoby z biura (assigneeId). KIEROWCA — 403.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 191) : "";
  if (!title) return NextResponse.json({ message: "Podaj treść zadania." }, { status: 400 });
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 5000) || null : null;
  const due = parseDay(body?.dueDate ?? null);
  if (due === undefined) return NextResponse.json({ message: "Nieprawidłowa data." }, { status: 400 });
  const exists = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  const isAgent = session.user.role === "AGENT";
  let assigneeId = session.user.id;
  if (isAgent) {
    const target = typeof body?.assigneeId === "string" ? await prisma.user.findUnique({ where: { id: body.assigneeId }, select: { role: true } }) : null;
    if (target?.role !== "ADMIN" && target?.role !== "STAFF") return NextResponse.json({ message: "Wskaż, komu przypisać zadanie." }, { status: 400 });
    assigneeId = body.assigneeId;
  }
  const task = await prisma.task.create({ data: { title, notes, dueDate: due, clientId: id, authorId: session.user.id, assigneeId } });
  if (isAgent) {
    await recordChanges(prisma, { userId: session.user.id }, [
      { entity: "TASK", entityId: task.id, clientId: id, operation: "CREATE", before: "null", after: toLogValue({ title, assigneeId }) },
    ]);
  }
  logInfo("client_task_created", { userId: session.user.id, clientId: id });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
