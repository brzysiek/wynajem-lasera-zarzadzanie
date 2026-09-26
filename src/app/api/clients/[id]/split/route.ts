import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { previewSplit, splitClient } from "@/lib/clients/split";
import { parseSplitInput } from "@/lib/clients/split-rules";
import { logInfo } from "@/lib/logger";

// „Wydziel do nowego klienta” — ADMIN/STAFF. Agent zgłasza wydzielenie jako
// propozycję (Porządki → Propozycje), którą akceptuje ADMIN.
// GET ?osoby=id1,id2 — podgląd: co przejdzie razem z osobami.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const ids = (req.nextUrl.searchParams.get("osoby") ?? "").split(",").filter(Boolean);
  return NextResponse.json(await previewSplit((await params).id, ids));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  const input = parseSplitInput(body);
  if (!input.ok) return NextResponse.json({ message: input.message }, { status: 400 });
  const r = await splitClient(id, input.value, body, { userId: session.user.id, role: session.user.role });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  logInfo("client_split", { userId: session.user.id, sourceId: id, newClientId: r.newClientId, moved: r.moved });
  return NextResponse.json({ newClientId: r.newClientId, moved: r.moved, detail: await loadClientDetail(id) });
}
