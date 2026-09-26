// API agenta: polskie klucze uwagi (tresc, obszar, dowod, klient_id,
// sygnal_id) → klucze parseRemarkInput. Angielskie też działają.
export function normalizeRemarkBody(b: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: [string, string][] = [
    ["tresc", "body"],
    ["obszar", "area"],
    ["dowod", "evidence"],
    ["klient_id", "clientId"],
    ["sygnal_id", "leadId"],
  ];
  for (const [pl, en] of map) {
    if (pl in b) out[en] = b[pl];
    else if (en in b) out[en] = b[en];
  }
  if ("status" in b) out.status = b.status;
  return out;
}
