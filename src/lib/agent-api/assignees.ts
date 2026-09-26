import { prisma } from "@/lib/prisma";

// Komu agent AI może przydzielić zadanie: tylko osoby z biura (ADMIN/STAFF)
// z włączonym „agentAssignable” (Ustawienia → Użytkownicy). Dziś: Tomek i Ania.
export const AGENT_ASSIGNEE_WHERE = { role: { in: ["ADMIN" as const, "STAFF" as const] }, agentAssignable: true };

export async function agentAssignees(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({ where: AGENT_ASSIGNEE_WHERE, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export async function agentMayAssign(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  return (await prisma.user.count({ where: { id: userId, ...AGENT_ASSIGNEE_WHERE } })) > 0;
}

export const AGENT_ASSIGNEE_MESSAGE = "Agent przydziela zadania tylko wskazanym osobom z biura (Ustawienia → Użytkownicy).";
