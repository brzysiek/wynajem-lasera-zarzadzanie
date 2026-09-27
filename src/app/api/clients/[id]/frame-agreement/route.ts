import { NextRequest, NextResponse } from "next/server";
import { requireStaffSession } from "@/lib/auth-guards";
import { loadClientDetail } from "@/lib/clients/load";
import { loadFrameAgreementFile, removeFrameAgreement, uploadFrameAgreement } from "@/lib/clients/frame-agreement";
import { logInfo } from "@/lib/logger";

// Umowa ramowa klienta (ADMIN/STAFF): GET = pobranie pliku, POST (multipart:
// file, signedAt?, note?) = wgranie / podmiana, DELETE = usunięcie.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const f = await loadFrameAgreementFile(id);
  if (!f) return NextResponse.json({ message: "Brak pliku umowy." }, { status: 404 });
  return new NextResponse(new Uint8Array(f.data), {
    headers: {
      "Content-Type": f.mimeType,
      "Content-Length": String(f.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ message: "Wybierz plik umowy." }, { status: 400 });
  const text = (v: FormDataEntryValue | null | undefined, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const r = await uploadFrameAgreement(id, file, { signedAt: text(form?.get("signedAt"), 10), note: text(form?.get("note"), 500) }, { userId: session.user.id, role: session.user.role });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  logInfo("frame_agreement_uploaded", { userId: session.user.id, clientId: id, size: file.size });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireStaffSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const { id } = await params;
  const r = await removeFrameAgreement(id, { userId: session.user.id, role: session.user.role });
  if (!r.ok) return NextResponse.json({ message: r.message }, { status: r.status });
  return NextResponse.json({ detail: await loadClientDetail(id) });
}
