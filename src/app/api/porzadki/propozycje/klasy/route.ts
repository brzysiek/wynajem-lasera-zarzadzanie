import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listAutoClasses } from "@/lib/porzadki/change-proposals";
import { normalizeClass } from "@/lib/porzadki/proposal-rules";

// Klasy zmian zatwierdzone na stałe — odczyt wszyscy (agent wie, co wykona
// sam), dodawanie i usuwanie tylko ADMIN.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ classes: await listAutoClasses() });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const key = normalizeClass(body?.key);
  if (!key) return NextResponse.json({ message: "Podaj klasę (key)." }, { status: 400 });
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 191) : null;
  await prisma.autoApprovedClass.upsert({ where: { key }, create: { key, label, createdById: session.user.id }, update: { label } });
  return NextResponse.json({ classes: await listAutoClasses() });
}

export async function DELETE(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const key = req.nextUrl.searchParams.get("key") ?? "";
  await prisma.autoApprovedClass.deleteMany({ where: { key } });
  return NextResponse.json({ classes: await listAutoClasses() });
}
