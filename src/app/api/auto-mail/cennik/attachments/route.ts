import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { prisma } from "@/lib/prisma";
import { AUTO_MAIL_MAX_FILE_BYTES, AUTO_MAIL_MAX_TOTAL_BYTES, AUTO_MAIL_TEMPLATE_KEY } from "@/lib/leads/auto-mail-render";
import { logInfo } from "@/lib/logger";

const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png"]);

// Załącznik maila z cennikiem (PDF, ewentualnie JPG/PNG) — trzymany w bazie.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Wybierz plik." }, { status: 400 });
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
  if (!ALLOWED.has(mime)) return NextResponse.json({ message: "Dozwolone pliki: PDF, JPG, PNG." }, { status: 400 });
  if (file.size > AUTO_MAIL_MAX_FILE_BYTES) return NextResponse.json({ message: "Plik ma ponad 10 MB." }, { status: 400 });
  const used = await prisma.emailTemplateAttachment.aggregate({ where: { templateKey: AUTO_MAIL_TEMPLATE_KEY }, _sum: { size: true }, _max: { sortOrder: true } });
  if ((used._sum.size ?? 0) + file.size > AUTO_MAIL_MAX_TOTAL_BYTES) {
    return NextResponse.json({ message: "Załączniki razem przekroczyłyby 17 MB (limit Gmaila to 25 MB po zakodowaniu)." }, { status: 400 });
  }
  const filename = file.name.replace(/[\\/\r\n"]/g, "_").slice(0, 180) || "zalacznik.pdf";
  const row = await prisma.emailTemplateAttachment.create({
    data: { templateKey: AUTO_MAIL_TEMPLATE_KEY, filename, mime, size: file.size, data: Buffer.from(await file.arrayBuffer()), sortOrder: (used._max.sortOrder ?? -1) + 1 },
    select: { id: true, filename: true, mime: true, size: true },
  });
  logInfo("auto_mail_attachment_added", { userId: session.user.id, filename, size: file.size });
  return NextResponse.json({ attachment: row });
}
