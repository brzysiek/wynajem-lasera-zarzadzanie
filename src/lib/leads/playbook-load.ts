import { prisma } from "@/lib/prisma";
import { PLAYBOOK_SETTING_KEY, parsePlaybook, type Playbook } from "@/lib/leads/playbook";

// Ściąga (złote zasady) — Setting "sales_playbook"; brak = treść domyślna.
export async function loadPlaybook(): Promise<Playbook> {
  const row = await prisma.setting.findUnique({ where: { key: PLAYBOOK_SETTING_KEY } });
  return parsePlaybook(row?.value);
}

export async function savePlaybook(input: unknown): Promise<Playbook> {
  const pb = parsePlaybook(JSON.stringify(input ?? {}));
  const value = JSON.stringify(pb);
  await prisma.setting.upsert({ where: { key: PLAYBOOK_SETTING_KEY }, create: { key: PLAYBOOK_SETTING_KEY, value }, update: { value } });
  return pb;
}
