import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guards";
import { OFFICE_AND_AGENT } from "@/lib/permissions";
import { listChangeLog } from "@/lib/changelog/load";
import { changeLogFilters, download } from "@/lib/porzadki/http";
import { ENTITY_LABEL, OPERATION_LABEL } from "@/lib/porzadki/labels";
import { toCsv } from "@/lib/porzadki/rules";

// Eksport dziennika do CSV (filtr dat, klienta, paczki — jak lista).
export async function GET(req: NextRequest) {
  const session = await requireSession(OFFICE_AND_AGENT);
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  const rows = await listChangeLog(changeLogFilters(req.nextUrl.searchParams), 5000);
  const csv = toCsv(
    ["Data", "Wykonał", "Klient", "Obiekt", "ID obiektu", "Operacja", "Pole", "Przed", "Po", "Źródło", "Pewność", "Paczka", "Cofnięto"],
    rows.map((r) => [
      r.createdAt.replace("T", " ").slice(0, 19),
      r.userName,
      r.clientName,
      ENTITY_LABEL[r.entity] ?? r.entity,
      r.entityId,
      OPERATION_LABEL[r.operation] ?? r.operation,
      r.field,
      r.before,
      r.after,
      r.source,
      r.confidence,
      r.batch,
      r.undoneById ? "tak" : "",
    ]),
  );
  return download(csv, `dziennik-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv");
}
