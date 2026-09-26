import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { patchClient } from "@/lib/clients/update";
import { loadClientDetail } from "@/lib/clients/load";
import { logInfo } from "@/lib/logger";

// Karta klienta — ADMIN/STAFF/AGENT. Zwraca przychód, więc KIEROWCA dostaje 403
// (spec, sekcja 4; reguła jak przy hourlyRate — egzekwowana w API).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const detail = await loadClientDetail(id);
  if (!detail) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  return NextResponse.json(detail);
}

// Zmiana danych klienta — logika (dziennik zmian, ograniczenia roli AGENT)
// w src/lib/clients/update.ts, wspólna z API agenta.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  const result = await patchClient(id, body, { userId: session.user.id, role: session.user.role });
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  logInfo("client_updated", { userId: session.user.id, clientId: id, fields: Object.keys(body), refreshedRentals: result.refreshedRentals });

  return NextResponse.json({ detail: await loadClientDetail(id), refreshedRentals: result.refreshedRentals });
}
