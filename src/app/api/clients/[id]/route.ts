import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireStaffSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { loadClientDetail } from "@/lib/clients/load";
import { parseClientPatch } from "@/lib/clients/validate";
import { CLIENT_CACHE_KEYS, refreshFutureRentalCaches } from "@/lib/clients/refresh";
import { logInfo } from "@/lib/logger";

// Karta klienta — ADMIN/STAFF. Zwraca przychód, więc KIEROWCA dostaje 403
// (spec, sekcja 4; reguła jak przy hourlyRate — egzekwowana w API).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const detail = await loadClientDetail(id);
  if (!detail) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });
  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });

  const parsed = parseClientPatch(body);
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  const { deviceInterests, ...rest } = parsed.data;

  const exists = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return NextResponse.json({ message: "Nie znaleziono klienta." }, { status: 404 });

  await prisma.client.update({
    where: { id },
    data: {
      ...rest,
      ...(deviceInterests ? { deviceInterests: deviceInterests.length ? deviceInterests : Prisma.DbNull } : {}),
    },
  });

  const touchesRentals = CLIENT_CACHE_KEYS.some((k) => k in parsed.data);
  const refreshedRentals = touchesRentals ? await refreshFutureRentalCaches({ clientId: id, clientFields: true }) : 0;
  logInfo("client_updated", { userId: session.user.id, clientId: id, fields: Object.keys(parsed.data), refreshedRentals });

  return NextResponse.json({ detail: await loadClientDetail(id), refreshedRentals });
}
