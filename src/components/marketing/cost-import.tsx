"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { BTN, BTN_PRIMARY, Card, ErrorNote } from "@/components/porzadki/shared";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { CostPreview } from "@/lib/marketing/costs-csv";

// Marketing → Import kosztów (wniosek 54, etap 1b): CSV raportu słów kluczowych
// z Google Ads (segment Dzień). Najpierw podgląd (dni, kampanie, koszt), dopiero
// potem zapis; ponowny import tych samych dni je nadpisuje.

export type CostStatus = { days: number; from: string | null; to: string | null; lastImportAt: string | null; totalCost: number };

const PLN = (n: number) => `${n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const day = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "—");

// Raport z Google Ads bywa UTF-16 (eksport „Excel .csv”) albo Windows-1250.
function decode(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("�") ? new TextDecoder("windows-1250").decode(buf) : utf8;
}

export function CostImport({ initial }: { initial: CostStatus }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<CostPreview | null>(null);
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function send(apply: boolean, body = text) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const r = await fetch(`${BASE_PATH}/api/marketing/costs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body, apply }) });
      const j = (await r.json().catch(() => ({}))) as { message?: string; preview?: CostPreview; applied?: boolean; deleted?: number; inserted?: number; status?: CostStatus };
      if (j.preview) setPreview(j.preview);
      if (!r.ok) return setError(j.message ?? "Nie udało się odczytać pliku.");
      if (j.applied) {
        if (j.status) setStatus(j.status);
        setInfo(`Zapisano ${j.inserted} wierszy (nadpisano ${j.deleted} istniejących z tych dni).`);
        setPreview(null);
        setText("");
        setFileName(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const t = decode(await f.arrayBuffer());
    setFileName(f.name);
    setText(t);
    await send(false, t);
  }

  return (
    <div style={APP_CSS_VARS} className="flex max-w-3xl flex-col gap-4">
      <Card title="Zaimportowane koszty">
        <p className="m-0 text-sm text-[var(--c-text)]">
          {status.days === 0 ? (
            "Nic jeszcze nie zaimportowano."
          ) : (
            <>
              Dni z kosztami: <b>{status.days}</b> (od {day(status.from)} do {day(status.to)}), łącznie <b>{PLN(status.totalCost)}</b>. Ostatni import: {status.lastImportAt ? new Date(status.lastImportAt).toLocaleString("pl-PL") : "—"}.
            </>
          )}
        </p>
        <p className="mb-0 mt-2 text-xs text-[var(--c-muted)]">
          Raport pokazuje koszty tylko dla zaimportowanych dni. Ponowny import tych samych dni je nadpisuje (bez dubli).{" "}
          <Link href="/marketing/kampanie" className="font-semibold text-[var(--c-brand)] hover:underline">
            Przejdź do raportu →
          </Link>
        </p>
      </Card>

      <Card title="Wczytaj raport z Google Ads">
        <ol className="mb-3 mt-0 list-decimal pl-5 text-[13px] text-[var(--c-muted)]">
          <li>W Google Ads: Raporty → Wstępnie zdefiniowane → Podstawowe → <b>Słowa kluczowe</b> (albo tabela „Słowa kluczowe wyszukiwania”).</li>
          <li>
            Segment <b>Czas → Dzień</b>. Kolumny: <b>Kampania</b>, <b>Grupa reklam</b>, <b>Identyfikator grupy reklam</b>, <b>Słowo kluczowe</b>, <b>Wyświetlenia</b>, <b>Kliknięcia</b>, <b>Koszt</b>.
          </li>
          <li>Pobierz jako .csv (nagłówki polskie lub angielskie, przecinek lub średnik — obie wersje działają). Kolumna z identyfikatorem grupy jest potrzebna, żeby leady (utm_content) połączyły się z kosztami grup.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="text-sm" />
          {fileName && <span className="text-xs text-[var(--c-muted)]">{fileName}</span>}
        </div>
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder="…albo wklej zawartość pliku CSV tutaj"
          rows={5}
          className="mt-3 w-full rounded-lg border border-[var(--c-border)] p-2 font-mono text-xs"
        />
        <div className="mt-2 flex gap-2">
          <button type="button" className={BTN} disabled={busy || !text.trim()} onClick={() => void send(false)}>
            Podgląd
          </button>
          <button
            type="button"
            className={`${BTN_PRIMARY} disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600 disabled:opacity-100`}
            disabled={busy || !preview || preview.rows === 0}
            onClick={() => void send(true)}
            title={!preview ? "Najpierw wczytaj plik i obejrzyj podgląd" : undefined}
          >
            Zapisz koszty
          </button>
        </div>
        <ErrorNote message={error} />
        {info && <p className="mb-0 mt-2 text-[13px] text-[var(--c-brand-deep)]">{info}</p>}
      </Card>

      {preview && (
        <Card title="Podgląd przed zapisem">
          <p className="mt-0 text-sm">
            Dni: <b>{preview.days}</b> ({day(preview.dayFrom)} – {day(preview.dayTo)}) · kampanii: <b>{preview.campaigns.length}</b> · wierszy: {preview.rows} · wyświetleń: {preview.impressions.toLocaleString("pl-PL")} · kliknięć: {preview.clicks.toLocaleString("pl-PL")} · łączny koszt: <b>{PLN(preview.totalCost)}</b>
          </p>
          <table className="mb-2 w-full text-left text-sm">
            <thead className="text-xs uppercase text-[var(--c-muted)]">
              <tr>
                <th className="py-1 font-medium">Kampania</th>
                <th className="py-1 font-medium">Dopasowanie</th>
                <th className="py-1 text-right font-medium">Koszt</th>
              </tr>
            </thead>
            <tbody>
              {preview.campaigns.map((c) => (
                <tr key={c.key} className="border-t border-[var(--c-border)]">
                  <td className="py-1.5">{c.name}</td>
                  <td className="py-1.5 text-xs text-[var(--c-muted)]">{c.known ? "znana (jak w utm_campaign)" : "bez dopasowania do leadów"}</td>
                  <td className="py-1.5 text-right tabular-nums">{PLN(c.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.warnings.length > 0 && (
            <ul className="m-0 list-disc pl-5 text-[13px] text-amber-800">
              {preview.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <p className="mb-0 mt-2 text-xs text-[var(--c-muted)]">
            Zapis nadpisze koszty z dni {day(preview.dayFrom)} – {day(preview.dayTo)} (cały ten zakres), jeśli były już zaimportowane.
          </p>
        </Card>
      )}
    </div>
  );
}
