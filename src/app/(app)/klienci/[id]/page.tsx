import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadClientRows } from "@/lib/clients/load";
import { countPendingHistory } from "@/lib/history/review-load";
import { ClientsManager } from "@/components/clients/clients-manager";

// Link do konkretnego klienta — ta sama lista, z otwartą kartą (spec 3.3).
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireClientsPageAccess();
  const { id } = await params;
  const exists = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!exists) notFound();
  const [rows, pendingHistory] = await Promise.all([loadClientRows(), countPendingHistory()]);
  return <ClientsManager rows={rows} initialSelectedId={id} pendingHistory={pendingHistory} />;
}
