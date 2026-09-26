import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadLeadDetail } from "@/lib/leads/load";
import { LeadError, createLeadTask } from "@/lib/leads/actions";
import { parseDay } from "@/lib/leads/validate";
import { logError, logInfo } from "@/lib/logger";

// Zadanie przy sygnale — w istniejącym panelu Zadań. ADMIN/STAFF.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ message: "Podaj treść zadania." }, { status: 400 });
  const due = parseDay(body?.dueDate ?? null);
  if (due === undefined) return NextResponse.json({ message: "Nieprawidłowa data." }, { status: 400 });
  const assigneeId = typeof body?.assigneeId === "string" && body.assigneeId ? body.assigneeId : null;
  try {
    await createLeadTask(id, { title, dueDate: due, assigneeId }, session.user.id);
    logInfo("lead_task_created", { userId: session.user.id, leadId: id });
    return NextResponse.json(await loadLeadDetail(id));
  } catch (err) {
    if (err instanceof LeadError) return NextResponse.json({ message: err.message }, { status: err.status });
    logError("lead_task_failed", err, { userId: session.user.id, leadId: id });
    return NextResponse.json({ message: "Nie udało się dodać zadania." }, { status: 500 });
  }
}
