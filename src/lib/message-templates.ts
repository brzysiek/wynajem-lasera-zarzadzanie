import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { TEMPLATE_KEYS, ensureDefaultTemplates } from "@/lib/reminders";

const RESERVED_KEYS = new Set<string>(Object.values(TEMPLATE_KEYS));

export type SmsTemplateDto = { id: string; key: string; label: string; body: string; locked: boolean };

function toDto(row: { id: string; key: string; label: string; body: string }): SmsTemplateDto {
  return { id: row.id, key: row.key, label: row.label, body: row.body, locked: RESERVED_KEYS.has(row.key) };
}

export async function listSmsTemplates(): Promise<SmsTemplateDto[]> {
  await ensureDefaultTemplates();
  const rows = await prisma.messageTemplate.findMany({ where: { channel: "SMS" }, orderBy: { label: "asc" } });
  return rows.map(toDto);
}

export async function createSmsTemplate(label: string, body: string): Promise<SmsTemplateDto> {
  const row = await prisma.messageTemplate.create({
    data: { key: `custom_${randomUUID()}`, label, channel: "SMS", body },
  });
  return toDto(row);
}

export async function updateSmsTemplate(id: string, data: { label?: string; body?: string }): Promise<SmsTemplateDto> {
  const row = await prisma.messageTemplate.update({ where: { id }, data });
  return toDto(row);
}

export async function deleteSmsTemplate(id: string): Promise<void> {
  const row = await prisma.messageTemplate.findUnique({ where: { id } });
  if (!row) return;
  if (RESERVED_KEYS.has(row.key)) {
    throw new Error("Nie można usunąć wbudowanego szablonu przypomnienia.");
  }
  await prisma.messageTemplate.delete({ where: { id } });
}
