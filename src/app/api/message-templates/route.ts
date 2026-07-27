import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createSmsTemplate, listSmsTemplates } from "@/lib/message-templates";
import { logInfo } from "@/lib/logger";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const templates = await listSmsTemplates();
  return NextResponse.json({ templates });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const label = typeof body?.label === "string" ? body.label.trim() : "";
  const text = typeof body?.body === "string" ? body.body.trim() : "";

  if (!label || !text) {
    return NextResponse.json({ message: "Podaj nazwę i treść szablonu." }, { status: 400 });
  }

  const template = await createSmsTemplate(label, text);
  logInfo("sms_template_created", { userId: session.user.id, templateId: template.id });
  return NextResponse.json({ template });
}
