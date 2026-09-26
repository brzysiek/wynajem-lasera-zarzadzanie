import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireClientsPageAccess } from "@/lib/clients/page-access";
import { loadPorzadkiPeople } from "@/lib/porzadki/people";
import { PorzadkiLayout } from "@/components/porzadki/shared";
import { ChangeLogPanel } from "@/components/porzadki/changelog-panel";

// Porządki → Dziennik zmian. „Cofnij” tylko ADMIN. ?klient=<id> zawęża do klienta.
export default async function ChangeLogPage({ searchParams }: { searchParams: Promise<{ klient?: string }> }) {
  const session = await requireClientsPageAccess();
  const { klient } = await searchParams;
  const [users, client] = await Promise.all([
    loadPorzadkiPeople(),
    klient ? prisma.client.findUnique({ where: { id: klient }, select: { id: true, name: true } }) : null,
  ]);
  return (
    <PorzadkiLayout title="Dziennik zmian" description="Każda zmiana danych klientów i dopasowań — kto, kiedy, co było przed i po. Wpis da się cofnąć.">
      {client && (
        <p className="mb-3 text-[13px] text-[var(--c-muted)]">
          Tylko klient{" "}
          <Link href={`/klienci/${client.id}`} className="font-semibold text-[var(--c-brand)] hover:underline">
            {client.name}
          </Link>{" "}
          ·{" "}
          <Link href="/dziennik" className="text-[var(--c-brand)] hover:underline">
            pokaż wszystkie
          </Link>
        </p>
      )}
      <ChangeLogPanel clientId={client?.id} canUndo={session.user.role === "ADMIN"} users={users} />
    </PorzadkiLayout>
  );
}
