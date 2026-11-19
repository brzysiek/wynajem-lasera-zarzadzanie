import { NextRequest, NextResponse, after } from "next/server";
import { MAX_BODY_BYTES, createRateLimiter, isBotUserAgent, originAllowed, parseBeacon } from "@/lib/traffic/ingest";
import { storeBeacon } from "@/lib/traffic/store";
import { logError } from "@/lib/logger";

// Wniosek 54, etap 2: anonimowy licznik ruchu — POST /api/ruch (navigator.sendBeacon, text/plain
// z JSON). Publiczny (strona wynajemlasera.pl nie ma sesji panelu): CORS tylko dla strony,
// zawsze szybko 204, zapis po odpowiedzi.
//
// PRYWATNOŚĆ: nie zapisujemy IP, user-agenta ani nagłówków. Adres IP służy wyłącznie do limitu
// paczek w pamięci procesu (60 / min), user-agent do odrzucenia znanych botów w locie. Nic z
// tego nie trafia do bazy ani do logów (błędy logujemy bez ciała i bez nagłówków).
const limiter = createRateLimiter();

const allowedOrigins = (): string[] =>
  (process.env.TRAFFIC_ALLOWED_ORIGINS ?? "https://wynajemlasera.pl")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function cors(origin: string | null): Record<string, string> {
  return origin && allowedOrigins().includes(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", Vary: "Origin" }
    : { Vary: "Origin" };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const done = () => new NextResponse(null, { status: 204, headers });
  // Obce domeny, boty i nadmiar — po cichu 204, bez zapisu.
  if (!originAllowed(origin, allowedOrigins())) return done();
  if (isBotUserAgent(req.headers.get("user-agent"))) return done();
  // Adres tylko jako klucz limitu w pamięci (nigdzie niezapisywany ani niezalogowany).
  const key = (req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "?").split(",")[0].trim();
  if (!limiter.allow(key)) return done();
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return done();
  const body = await req.text().catch(() => "");
  const parsed = parseBeacon(body);
  if (!parsed.ok) return done();
  const beacon = parsed.beacon;
  after(() => storeBeacon(beacon).then(() => undefined).catch((err) => logError("traffic_store_failed", err)));
  return done();
}
