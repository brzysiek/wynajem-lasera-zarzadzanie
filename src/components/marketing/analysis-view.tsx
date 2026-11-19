"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { MarkdownLite } from "@/components/markdown-lite";
import { AREA_LABEL, STATUS_LABEL, type Area, type Status } from "@/lib/marketing/analysis-rules";
import type { ProposalDto } from "@/lib/marketing/analysis";

// Marketing → Analiza (wniosek 54, etap 1c): najważniejsze wnioski tygodnia,
// propozycje zmian z decyzją administratora i poprzednie raporty. Nic nie zmienia
// się samo — decyzje i wdrożenia trafiają do dziennika panelu.

export type ReportSummary = { id: string; periodFrom: string; periodTo: string; title: string; counts: { proposals: number; implemented: number; rejected: number; waiting: number } };
export type ReportView = { id: string; periodFrom: string; periodTo: string; title: string; author: string; createdAt: string; conclusions: { tytul: string; opis: string }[]; contentMd: string; proposals: ProposalDto[] };

const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const dmy = (d: string) => `${dm(d)}.${d.slice(0, 4)}`;
const range = (a: string, b: string) => (a.slice(5, 7) === b.slice(5, 7) ? `${a.slice(8, 10)}–${dmy(b)}` : `${dm(a)}–${dmy(b)}`);

const STATUS_CLS: Record<Status, string> = { czeka: "bg-amber-100 text-amber-900", zaakceptowana: "bg-green-100 text-green-800", odrzucona: "bg-gray-200 text-gray-700", wdrozona: "bg-blue-100 text-blue-800" };

function ReportMarkdown({ text }: { text: string }) {
  // Nagłówki „#” jako nagłówki, reszta jako lekki markdown (listy, pogrubienia, linki).
  const blocks: { h?: number; text: string }[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (buf.length) blocks.push({ text: buf.join("\n") });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^(#{1,3})\s+(.*)$/);
    if (m) {
      flush();
      blocks.push({ h: m[1].length, text: m[2] });
    } else buf.push(line);
  }
  flush();
  return (
    <div className="flex flex-col gap-2 text-sm text-gray-800">
      {blocks.map((b, i) =>
        b.h ? (
          <div key={i} className={b.h === 1 ? "mt-2 text-lg font-semibold text-gray-900" : "mt-2 text-base font-semibold text-gray-900"}>
            {b.text}
          </div>
        ) : b.text.trim().startsWith("|") ? (
          <pre key={i} className="m-0 overflow-x-auto rounded bg-gray-50 p-2 text-xs">{b.text}</pre>
        ) : (
          <MarkdownLite key={i} text={b.text} />
        ),
      )}
    </div>
  );
}

function ProposalCard({ p, onChanged }: { p: ProposalDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"reject" | "implement" | null>(null);
  const [text, setText] = useState("");

  async function act(action: "accept" | "reject" | "undo" | "implement", extra: { comment?: string; note?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/marketing/proposals/${p.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { message?: string };
        setError(j.message ?? "Nie udało się zapisać decyzji.");
        return;
      }
      setMode(null);
      setText("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const btn = "h-9 rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-800 hover:border-[#1B6FA8] disabled:opacity-50";
  const primary = "h-9 rounded-lg bg-[#177A3E] px-4 text-sm font-semibold text-white hover:bg-[#126131] disabled:opacity-50";
  return (
    <li className="rounded-lg border border-gray-200 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700">{AREA_LABEL[p.area as Area] ?? p.area}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[p.status]}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className="font-semibold text-gray-900">{p.title}</div>
          <div className="mt-0.5 text-sm text-gray-600">{p.reasoning}</div>
          {p.decidedAt && (
            <div className="mt-1 text-xs text-gray-500">
              {p.status === "odrzucona" ? "Odrzucona" : "Zaakceptowana"} · {p.decidedByName} · {dmy(p.decidedAt.slice(0, 10))}
              {p.comment ? ` — ${p.comment}` : ""}
            </div>
          )}
          {p.implementedAt && (
            <div className="mt-1 text-xs text-gray-500">
              Wdrożona · {p.implementedBy} · {dmy(p.implementedAt.slice(0, 10))} — {p.implementedNote}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.status === "czeka" && (
            <>
              <button type="button" className={primary} disabled={busy} onClick={() => void act("accept")}>
                Akceptuję
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => setMode(mode === "reject" ? null : "reject")}>
                Odrzucam
              </button>
            </>
          )}
          {p.status === "zaakceptowana" && (
            <>
              <button type="button" className={btn} disabled={busy} onClick={() => setMode(mode === "implement" ? null : "implement")}>
                Oznacz jako wdrożone
              </button>
              <button type="button" className={btn} disabled={busy} onClick={() => void act("undo")}>
                Cofnij decyzję
              </button>
            </>
          )}
          {p.status === "odrzucona" && (
            <button type="button" className={btn} disabled={busy} onClick={() => void act("undo")}>
              Cofnij decyzję
            </button>
          )}
        </div>
      </div>
      {mode && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder={mode === "reject" ? "Komentarz (opcjonalnie)" : "Notatka wdrożenia — co zostało zrobione"}
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy || (mode === "implement" && !text.trim())}
              onClick={() => void (mode === "reject" ? act("reject", { comment: text }) : act("implement", { note: text }))}
            >
              {mode === "reject" ? "Odrzuć" : "Zapisz wdrożenie"}
            </button>
            <button type="button" className={btn} onClick={() => setMode(null)}>
              Anuluj
            </button>
          </div>
        </div>
      )}
      {error && <p className="mb-0 mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}
    </li>
  );
}

export function AnalysisView({ report, reports }: { report: ReportView | null; reports: ReportSummary[] }) {
  const router = useRouter();
  const [full, setFull] = useState(false);
  const refresh = () => router.refresh();

  if (!report) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500">
        Claude jeszcze nie zapisał żadnego raportu. Pierwszy pojawi się tu po cotygodniowej analizie.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <select aria-label="Raport" value={report.id} onChange={(e) => router.push(`/marketing/analiza?raport=${e.target.value}`)} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm">
          {reports.map((r) => (
            <option key={r.id} value={r.id}>
              Raport: tydzień {range(r.periodFrom, r.periodTo)}
            </option>
          ))}
        </select>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white px-6 py-5">
        <div className="text-xs text-gray-500">
          Raport tygodniowy · przygotował {report.author} · {dmy(report.createdAt.slice(0, 10))}
        </div>
        <h2 className="m-0 mt-1 text-xl font-semibold text-gray-900">Najważniejsze w tym tygodniu</h2>
        <ol className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
          {report.conclusions.map((c, i) => (
            <li key={i} className="flex gap-3">
              <span className={`flex h-7 w-7 flex-none items-center justify-center rounded-full text-sm font-semibold ${i === 0 ? "bg-orange-100 text-[#B8530F]" : "bg-blue-100 text-[#1B4FD8]"}`}>{i + 1}</span>
              <span>
                <span className="block font-semibold text-gray-900">{c.tytul}</span>
                <span className="block text-sm text-gray-600">{c.opis}</span>
              </span>
            </li>
          ))}
        </ol>
        <button type="button" onClick={() => setFull(!full)} aria-expanded={full} className="mt-4 text-sm text-[#1B4FD8] underline">
          {full ? "Ukryj pełny raport" : "Pełny raport z liczbami →"}
        </button>
        {full && (
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4">
            <ReportMarkdown text={report.contentMd} />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-6 py-5">
        <h2 className="m-0 text-lg font-semibold text-gray-900">Propozycje zmian</h2>
        <p className="mb-3 mt-0.5 text-xs text-gray-500">Nic nie zmienia się samo. Zaakceptowana propozycja trafia do wdrożenia, a po wdrożeniu wpis do dziennika.</p>
        {report.proposals.length === 0 ? (
          <p className="m-0 text-sm text-gray-500">Ten raport nie ma propozycji zmian.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {report.proposals.map((p) => (
              <ProposalCard key={p.id} p={p} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white px-6 py-5">
        <h2 className="m-0 mb-2 text-lg font-semibold text-gray-900">Poprzednie raporty</h2>
        <ul className="m-0 flex list-none flex-col p-0 text-sm">
          {reports.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 py-2 first:border-t-0">
              <Link href={`/marketing/analiza?raport=${r.id}`} className="text-[#1B4FD8] underline">
                Tydzień {range(r.periodFrom, r.periodTo)}
              </Link>
              <span className="ml-auto text-gray-600">
                {r.counts.proposals} propozycji · {r.counts.implemented} wdrożone · {r.counts.rejected} odrzucone
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
