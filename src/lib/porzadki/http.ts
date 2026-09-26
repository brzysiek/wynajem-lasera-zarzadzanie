import { NextResponse } from "next/server";
import { PorzadkiError } from "@/lib/porzadki/proposals";
import type { ChangeLogFilters } from "@/lib/changelog/load";
import type { ProposalFilters } from "@/lib/porzadki/proposals";
import { logError } from "@/lib/logger";

// Wspólne dla tras /api/porzadki/* (i później /api/agent/*): błąd → JSON,
// filtry z query stringa.

export function porzadkiErrorResponse(err: unknown, event: string, userId: string) {
  if (err instanceof PorzadkiError) return NextResponse.json({ message: err.message }, { status: err.status });
  logError(event, err, { userId });
  return NextResponse.json({ message: "Nie udało się zapisać." }, { status: 500 });
}

export function proposalFilters(sp: URLSearchParams): ProposalFilters {
  const blocks = sp.get("blokuje");
  return {
    status: sp.get("status"),
    area: sp.get("obszar") ?? sp.get("area"),
    type: sp.get("typ") ?? sp.get("type"),
    priority: sp.get("priorytet") ?? sp.get("priority"),
    blocks: blocks === "1" || blocks === "true" ? true : blocks === "0" || blocks === "false" ? false : null,
    authorId: sp.get("autor") ?? sp.get("authorId"),
    q: sp.get("q"),
    clientId: sp.get("klient") ?? sp.get("clientId"),
  };
}

function day(v: string | null, end: boolean): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return new Date(`${v}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
}

export function changeLogFilters(sp: URLSearchParams): ChangeLogFilters {
  return {
    clientId: sp.get("klient") ?? sp.get("clientId"),
    batch: sp.get("paczka") ?? sp.get("batch"),
    userId: sp.get("autor") ?? sp.get("userId"),
    entity: sp.get("obiekt") ?? sp.get("entity"),
    from: day(sp.get("od") ?? sp.get("from"), false),
    to: day(sp.get("do") ?? sp.get("to"), true),
    q: sp.get("q"),
  };
}

export function download(body: string, filename: string, type: string) {
  return new NextResponse(body, {
    headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Disposition": `attachment; filename="${filename}"` },
  });
}
