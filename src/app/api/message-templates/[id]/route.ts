import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteSmsTemplate, updateSmsTemplate } from "@/lib/message-templates";
import { logInfo } from "@/lib/logger";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const data: { label?: string; body?: string } = {};
  if (typeof body?.label === "string") {
    const label = body.label.trim();
    if (!label) return NextResponse.json({ message: "Nazwa szablonu nie może być pusta." }, { status: 400 });
    data.label = label;
  }
  if (typeof body?.body === "string") {
    const text = body.body.trim();
    if (!text) return NextResponse.json({ message: "Treść szablonu nie może być pusta." }, { status: 400 });
    data.body = text;
  }
  if (!data.label && !data.body) {
    return NextResponse.json({ message: "Brak zmian do zapisania." }, { status: 400 });
  }

  try {
    const template = await updateSmsTemplate(id, data);
    logInfo("sms_template_updated", { userId: session.user.id, templateId: id });
    return NextResponse.json({ template });
  } catch {
    return NextResponse.json({ message: "Nie znaleziono szablonu." }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const { id } = await params;
  try {
    await deleteSmsTemplate(id);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Nie udało się usunąć szablonu.";
    return NextResponse.json({ message }, { status: 400 });
  }

  logInfo("sms_template_deleted", { userId: session.user.id, templateId: id });
  return NextResponse.json({ ok: true });
}
