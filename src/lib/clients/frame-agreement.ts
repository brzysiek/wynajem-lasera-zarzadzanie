import { prisma } from "@/lib/prisma";
import { patchClient, type UpdateResult } from "@/lib/clients/update";

// Umowa ramowa / kaucja (karta klienta → Warunki handlowe): plik w bazie
// (ClientFile), opis w Client.frameAgreement. Zapis przez patchClient —
// dziennik zmian i pochodzenie pola jak przy każdej zmianie.

export const FRAME_MAX_BYTES = 8 * 1024 * 1024;
export const FRAME_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

export type Actor = { userId: string; role: string };

export async function uploadFrameAgreement(
  clientId: string,
  file: File,
  meta: { signedAt: string | null; note: string | null },
  actor: Actor,
): Promise<UpdateResult & { fileId?: string }> {
  if (!FRAME_TYPES[file.type]) return { ok: false, status: 400, message: "Plik umowy: PDF, JPG albo PNG." };
  if (file.size > FRAME_MAX_BYTES) return { ok: false, status: 400, message: "Plik umowy może mieć najwyżej 8 MB." };
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, frameAgreement: true } });
  if (!client) return { ok: false, status: 404, message: "Nie znaleziono klienta." };
  const data = Buffer.from(await file.arrayBuffer());
  const created = await prisma.clientFile.create({
    data: { clientId, kind: "FRAME_AGREEMENT", fileName: file.name.slice(0, 191) || "umowa", mimeType: file.type, size: file.size, data, uploadedById: actor.userId },
    select: { id: true },
  });
  const r = await patchClient(clientId, { frameAgreement: { fileId: created.id, name: file.name.slice(0, 191), signedAt: meta.signedAt, note: meta.note } }, actor);
  if (!r.ok) {
    await prisma.clientFile.delete({ where: { id: created.id } });
    return r;
  }
  // Poprzednia wersja pliku niepotrzebna — opis w dzienniku zostaje.
  await prisma.clientFile.deleteMany({ where: { clientId, kind: "FRAME_AGREEMENT", id: { not: created.id } } });
  return { ...r, fileId: created.id };
}

export async function removeFrameAgreement(clientId: string, actor: Actor): Promise<UpdateResult> {
  const r = await patchClient(clientId, { frameAgreement: null }, actor);
  if (r.ok) await prisma.clientFile.deleteMany({ where: { clientId, kind: "FRAME_AGREEMENT" } });
  return r;
}

export async function loadFrameAgreementFile(clientId: string) {
  return prisma.clientFile.findFirst({ where: { clientId, kind: "FRAME_AGREEMENT" }, orderBy: { createdAt: "desc" } });
}

