import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireSession } from "@/lib/auth-guards";
import { AGENT_CLIENT_FIELDS, OFFICE_AND_AGENT } from "@/lib/permissions";
import { changedFields } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { fieldEntries, recordChanges } from "@/lib/changelog/record";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { parseClientPatch } from "@/lib/clients/validate";
import { CLIENT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";
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

// Zmiana danych klienta. Każda zmiana pola trafia do dziennika zmian (przed →
// po). Rola AGENT: tylko pola z AGENT_CLIENT_FIELDS i obowiązkowo źródło +
// pewność zmiany (changeSource/changeConfidence albo zrodlo/pewnosc).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  const isAgent = session.user.role === "AGENT";
  const provenance = parseProvenance(body, { required: isAgent });
  if (!provenance.ok) return NextResponse.json({ message: provenance.message }, { status: 400 });

  const parsed = parseClientPatch(body);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  if (isAgent) {
    const denied = Object.keys(parsed.data).filter((k) => !(AGENT_CLIENT_FIELDS as readonly string[]).includes(k));
    if (denied.length) return NextResponse.json({ message: `Pole poza zakresem agenta: ${denied.join(", ")}.` }, { status: 403 });
  }
  const { deviceInterests, ...rest } = parsed.data;

  const current = await prisma.client.findUnique({ where: { id } });
  if (!current) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  const changes = changedFields(current as unknown as Record<string, unknown>, parsed.data);

  await prisma.$transaction(async (tx) => {
    await tx.client.update({
      where: { id },
      data: {
        ...rest,
        ...(deviceInterests ? { deviceInterests: deviceInterests.length ? deviceInterests : Prisma.DbNull } : {}),
      },
    });
    await recordChanges(tx, { userId: session.user.id, provenance: provenance.value }, fieldEntries("CLIENT", id, id, changes));
  });

  const touchesRentals = CLIENT_CACHE_KEYS.some((k) => k in parsed.data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId: id, clientFields: true }) : 0;
  logInfo("client_updated", { userId: session.user.id, clientId: id, fields: Object.keys(parsed.data), refreshedRentals });

  return NextResponse.json({ detail: await loadClientDetail(id), refreshedRentals });
}
