import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { listRules } from "@/lib/porzadki/cleanup-rules";

// Reguły porządków — czytają wszyscy (agent przed pracą), zmienia ADMIN.
export async function GET() {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ rules: await listRules() });
}

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim().slice(0, 5000) : "";
  if (!text) return NextResponse.json({ message: "Wpisz treść reguły." }, { status: 400 });
  const example = typeof body?.example === "string" && body.example.trim() ? body.example.trim().slice(0, 5000) : null;
  await prisma.cleanupRule.create({ data: { body: text, example, createdById: session.user.id } });
  return NextResponse.json({ rules: await listRules() });
}
