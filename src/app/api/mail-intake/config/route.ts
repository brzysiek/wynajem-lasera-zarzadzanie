import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { loadIntakeConfig, saveIntakeConfig } from "@/lib/leads/mail-intake";
import { DEFAULT_CONFIG } from "@/lib/leads/mail-intake-rules";

// Słowa, domeny, progi i tryb filtra maili (wniosek 43, pkt 2d/3) — ADMIN.
export async function GET() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  return NextResponse.json({ config: await loadIntakeConfig(), defaults: DEFAULT_CONFIG });
}

export async function PUT(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ message: "Nieprawidłowe dane." }, { status: 400 });
  return NextResponse.json({ config: await saveIntakeConfig((body as { config?: unknown }).config ?? body) });
}
