import { prisma } from "@/lib/prisma";
import { MetaPanel } from "@/components/meta-panel";
import { metaConfigStatus } from "@/lib/chat/meta-graph";
import { BASE_PATH } from "@/lib/base-path";
import { headers } from "next/headers";

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-green-600" : "bg-gray-300"}`} />
      <Code>{label}</Code>
      <span className="text-gray-500">{ok ? "ustawione" : "brak"}</span>
    </li>
  );
}

// Ustawienia → Integracje → Meta (Messenger i Instagram Direct, wniosek 42, faza 1:
// tylko odbiór). Tokeny i App Secret wpisuje Tomek wprost do konfiguracji serwera —
// ta strona pokazuje wyłącznie, czy są ustawione (nigdy ich wartości).
export default async function MetaIntegrationPage() {
  const cfg = metaConfigStatus();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "panel";
  const url = `https://${host}${BASE_PATH}/api/webhooks/meta`;
  const [logs, threads, messages] = await Promise.all([
    prisma.webhookLog.findMany({ where: { kind: "meta-chat" }, orderBy: { createdAt: "desc" }, take: 8, select: { createdAt: true, result: true, message: true, tookMs: true } }),
    prisma.chatThread.count(),
    prisma.chatMessage.count(),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Messenger i Instagram Direct</h2>
        <p className="mb-4 text-sm text-gray-500">Wiadomości z Meta trafiają do panelu (nowa rozmowa = sygnał „Nowe”, nasza odpowiedź = „W kontakcie”). Faza 1: tylko odbiór, bez wysyłania z panelu. Instrukcja krok po kroku: <Code>docs/meta-messaging.md</Code>.</p>
        <p className="mb-1 text-sm text-gray-700">Adres webhooka (Callback URL w aplikacji Meta):</p>
        <p className="mb-4"><Code>{url}</Code></p>
        <ul className="m-0 mb-4 flex list-none flex-col gap-1 p-0">
          <Flag ok={cfg.verifyToken} label="META_VERIFY_TOKEN" />
          <Flag ok={cfg.appSecret} label="META_APP_SECRET" />
          <Flag ok={cfg.pageToken} label="META_PAGE_ACCESS_TOKEN" />
          <Flag ok={cfg.pageId} label="META_PAGE_ID" />
          <Flag ok={cfg.appId} label="META_APP_ID (opcjonalnie — pokazuje, która subskrypcja jest nasza)" />
        </ul>
        <MetaPanel canCall={cfg.pageToken && cfg.pageId} />
      </section>
      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Ostatnie zdarzenia</h2>
        <p className="mb-3 text-sm text-gray-500">W panelu: {threads} {threads === 1 ? "rozmowa" : "rozmów"}, {messages} wiadomości.</p>
        {logs.length === 0 ? (
          <p className="text-sm text-gray-500">Jeszcze nic nie przyszło z Meta.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {logs.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-2">
                <span className="tabular-nums text-gray-500">{l.createdAt.toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}</span>
                <b className={l.result === "OK" ? "text-green-700" : l.result === "IGNORED" ? "text-gray-600" : "text-red-700"}>{l.result}</b>
                <span className="text-gray-700">{l.message ?? ""}</span>
                {l.tookMs != null && <span className="text-gray-400">{l.tookMs} ms</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
