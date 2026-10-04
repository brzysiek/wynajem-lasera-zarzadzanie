// Minimalny serwer MCP (Streamable HTTP, bezstanowy, odpowiedzi JSON) —
// JSON-RPC 2.0: initialize, ping, tools/list, tools/call; powiadomienia bez
// odpowiedzi. Czysty moduł (vitest, bez @/): narzędzia i wykonanie
// wstrzykiwane.

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_INFO = { name: "wynajem-lasera-panel", title: "Panel WynajemLasera.pl", version: "1.0.0" };
export const INSTRUCTIONS =
  "Panel WynajemLasera.pl (wynajem urządzeń kosmetologicznych). Działasz jako agent AI porządkujący bazę klientów. " +
  "Zanim zaczniesz, przeczytaj reguly_porzadkow. Zmiany danych klientów zawsze z polami zrodlo, pewnosc i paczka — trafiają do dziennika. " +
  "Większe porządki zgłaszaj jako paczkę propozycji (propozycje_dodaj) — administrator akceptuje je hurtem; sprawdzaj propozycje_lista (odrzucone z komentarzem nie proponuj ponownie). " +
  "Nie usuwasz ani nie archiwizujesz sam: archiwizację zgłaszaj jako propozycję rodzaju „archiwizacja” z powodem i dopiskiem. " +
  "Wnioski z obszarów MARKETING, STRONA, OFERTA i ORGANIZACJA (dev=false) to skrzynka Tomka: nie bierz ich do implementacji, nie planuj na ich podstawie zmian w kodzie i nie zamykaj ich — status zmienia tylko Tomek. wnioski_lista domyślnie ich nie zwraca (skrzynka=true).";

export type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type RpcResponse = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export type ToolDescriptor = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean };

export type Dispatch = {
  tools: ToolDescriptor[];
  call: (name: string, args: Record<string, unknown>) => Promise<{ ok: true; value: unknown } | { ok: false; message: string }>;
};

// Wersja serwera = skrót schematów narzędzi: każda zmiana narzędzi (np.
// nowe pola zadanie_utworz: bez_powiazania, wynajmy, klienci, sygnaly) daje
// nową wersję, więc klient (claude.ai) nie trzyma starej listy.
export function toolsVersion(tools: ToolDescriptor[]): string {
  const text = JSON.stringify(tools.map((t) => [t.name, t.description, t.inputSchema]));
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `1.1.${h.toString(36)}`;
}

export function toolList(tools: ToolDescriptor[]) {
  return {
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false },
    })),
  };
}

// Odpowiedź na jedną wiadomość; null = powiadomienie (bez odpowiedzi).
export async function handleMessage(msg: RpcMessage, d: Dispatch): Promise<RpcResponse | null> {
  const isRequest = msg && typeof msg === "object" && "id" in msg && msg.id !== undefined;
  if (!isRequest) return null;
  const id = msg.id ?? null;
  const ok = (result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg.method) {
    case "initialize": {
      const requested = typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "";
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: true } },
        serverInfo: { ...SERVER_INFO, version: toolsVersion(d.tools) },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok(toolList(d.tools));
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      const args = msg.params?.arguments && typeof msg.params.arguments === "object" ? (msg.params.arguments as Record<string, unknown>) : {};
      if (!d.tools.some((t) => t.name === name)) return fail(-32602, `Nieznane narzędzie: ${name}`);
      const r = await d.call(name, args);
      // Błąd narzędzia to wynik z isError (model widzi komunikat), nie błąd protokołu.
      return ok(r.ok ? { content: [{ type: "text", text: JSON.stringify(r.value) }] } : { content: [{ type: "text", text: r.message }], isError: true });
    }
    default:
      return fail(-32601, `Nieobsługiwana metoda: ${msg.method ?? "(brak)"}`);
  }
}
