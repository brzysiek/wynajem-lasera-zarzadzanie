"use client";

import { useContext, useState } from "react";
import type { ClientDetail } from "@/lib/clients/load";
import { BASE_PATH } from "@/lib/base-path";
import { AgentModeContext, FormError, INPUT, api } from "../client-forms";
import { BTN_OUTLINE, BTN_PRIMARY, LINK, Missing, Row, Section, dmy, money } from "./kit";

// „Warunki handlowe” na karcie klienta (ADMIN/STAFF edytują; agent tylko
// proponuje): cena ustalona = wynajem netto + transport netto, forma
// płatności (gotówka / przelew — oba zaznaczone = „oba”), termin płatności,
// e-mail do FV i plik umowy ramowej.

export const PAYMENT_FORM_LABEL: Record<string, string> = { GOTOWKA: "gotówka", PRZELEW: "przelew", OBA: "gotówka i przelew" };

export function agreedTotal(d: ClientDetail): { rental: number | null; transport: number | null; total: number | null } {
  const rental = d.profile.agreedPrice ? Number(d.profile.agreedPrice) : null;
  const transport = d.transportPriceNet ? Number(d.transportPriceNet) : null;
  return { rental, transport, total: rental != null ? rental + (transport ?? 0) : null };
}

const toForm = (cash: boolean, transfer: boolean) => (cash && transfer ? "OBA" : cash ? "GOTOWKA" : transfer ? "PRZELEW" : null);

export function TermsSection({ d, onChanged, notify }: { d: ClientDetail; onChanged: (n: ClientDetail) => void; notify: (t: string, e?: boolean) => void }) {
  const agent = useContext(AgentModeContext);
  const [edit, setEdit] = useState(false);
  const p = d.profile;
  const price = agreedTotal(d);
  const fa = p.frameAgreement;

  return (
    <Section title="Warunki handlowe" wide action={!agent && !edit && <button type="button" onClick={() => setEdit(true)} className={LINK}>Edytuj</button>}>
      {edit ? (
        <TermsEditor
          d={d}
          onCancel={() => setEdit(false)}
          onSaved={(n) => {
            setEdit(false);
            onChanged(n);
            notify("Zapisano warunki handlowe.");
          }}
        />
      ) : (
        <>
          <Row label="Cena ustalona">
            {price.rental != null ? (
              <>
                <span className="font-semibold text-[var(--c-brand)]">{money(price.total!)} netto</span>
                <span className="text-[var(--c-muted)]">
                  {" "}
                  = {money(price.rental)} wynajem + {price.transport != null ? `${money(price.transport)} transport` : "transport ?"}
                </span>
              </>
            ) : (
              <Missing>uzupełnij wynajem i transport</Missing>
            )}
          </Row>
          <Row label="Forma płatności">{p.paymentForm ? PAYMENT_FORM_LABEL[p.paymentForm] : <Missing>ustal: gotówka / przelew</Missing>}</Row>
          <Row label="Termin płatności">{p.paymentTerms ?? <Missing>uzupełnij</Missing>}</Row>
          <Row label="E-mail do FV">{p.invoiceEmail ?? <Missing>uzupełnij</Missing>}</Row>
          <Row label="Umowa ramowa">
            {fa?.fileId ? (
              <>
                <a href={`${BASE_PATH}/api/clients/${d.id}/frame-agreement`} target="_blank" rel="noreferrer" className="text-[var(--c-brand)] hover:underline">
                  {fa.name ?? "umowa"}
                </a>
                {fa.signedAt && <span className="text-[var(--c-muted)]"> · podpisana {dmy(fa.signedAt)}</span>}
                {fa.note && <span className="text-[var(--c-muted)]"> · {fa.note}</span>}
              </>
            ) : fa?.url ? (
              <a href={fa.url} target="_blank" rel="noreferrer" className="text-[var(--c-brand)] hover:underline">
                {fa.name ?? "umowa (link)"}
              </a>
            ) : (
              <Missing>brak pliku</Missing>
            )}
          </Row>
        </>
      )}
    </Section>
  );
}

function TermsEditor({ d, onCancel, onSaved }: { d: ClientDetail; onCancel: () => void; onSaved: (n: ClientDetail) => void }) {
  const p = d.profile;
  const price = agreedTotal(d);
  const [f, setF] = useState({
    rental: price.rental != null ? String(price.rental) : "",
    transport: price.transport != null ? String(price.transport) : "",
    cash: p.paymentForm === "GOTOWKA" || p.paymentForm === "OBA",
    transfer: p.paymentForm === "PRZELEW" || p.paymentForm === "OBA",
    terms: p.paymentTerms ?? "",
    email: p.invoiceEmail ?? "",
    signedAt: p.frameAgreement?.signedAt ?? "",
    note: p.frameAgreement?.note ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    const faChanged = !file && !removeFile && p.frameAgreement && (f.signedAt !== (p.frameAgreement.signedAt ?? "") || f.note !== (p.frameAgreement.note ?? ""));
    let { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}`, "PATCH", {
      agreedPrice: f.rental,
      transportPriceNet: f.transport,
      paymentForm: toForm(f.cash, f.transfer),
      paymentTerms: f.terms,
      invoiceEmail: f.email,
      ...(faChanged ? { frameAgreement: { ...p.frameAgreement, signedAt: f.signedAt || null, note: f.note || null } } : {}),
    });
    if (ok && removeFile) ({ ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/frame-agreement`, "DELETE"));
    if (ok && file) {
      const form = new FormData();
      form.set("file", file);
      if (f.signedAt) form.set("signedAt", f.signedAt);
      if (f.note) form.set("note", f.note);
      const res = await fetch(`${BASE_PATH}/api/clients/${d.id}/frame-agreement`, { method: "POST", body: form });
      data = await res.json().catch(() => ({}));
      ok = res.ok;
    }
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    onSaved(data.detail);
  }

  const label = "flex flex-col gap-1 text-[14px] text-[var(--c-muted)]";
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--c-divider)] pt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Wynajem netto (zł)
          <input className={INPUT} inputMode="decimal" value={f.rental} onChange={(e) => set("rental", e.target.value)} placeholder="np. 1000" />
        </label>
        <label className={label}>
          Transport netto (zł)
          <input className={INPUT} inputMode="decimal" value={f.transport} onChange={(e) => set("transport", e.target.value)} placeholder="np. 180" />
        </label>
      </div>
      <fieldset className={label}>
        <legend className="mb-1">Forma płatności (można obie)</legend>
        <div className="flex gap-5 text-[15px] text-[var(--c-text)]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.cash} onChange={(e) => set("cash", e.target.checked)} /> gotówka
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={f.transfer} onChange={(e) => set("transfer", e.target.checked)} /> przelew
          </label>
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Termin płatności
          <input className={INPUT} value={f.terms} onChange={(e) => set("terms", e.target.value)} placeholder="np. przelew 7 dni, gotówka przy dostawie" />
        </label>
        <label className={label}>
          E-mail do FV
          <input className={INPUT} inputMode="email" value={f.email} onChange={(e) => set("email", e.target.value)} />
        </label>
      </div>
      <fieldset className={`${label} border border-[var(--c-border)] p-3`}>
        <legend className="px-1">Umowa ramowa / kaucja</legend>
        {p.frameAgreement?.fileId && !removeFile && (
          <div className="flex items-center gap-3 text-[15px] text-[var(--c-text)]">
            obecny plik: {p.frameAgreement.name}
            <button type="button" className="text-[14px] text-[var(--c-warn-text)] hover:underline" onClick={() => setRemoveFile(true)}>
              usuń
            </button>
          </div>
        )}
        <input type="file" accept="application/pdf,image/jpeg,image/png" className="text-[14px]" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <span>PDF, JPG albo PNG, do 8 MB. Nowy plik zastępuje poprzedni.</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Data podpisania
            <input type="date" className={INPUT} value={f.signedAt} onChange={(e) => set("signedAt", e.target.value)} />
          </label>
          <label className={label}>
            Uwagi
            <input className={INPUT} value={f.note} onChange={(e) => set("note", e.target.value)} placeholder="np. kaucja 2000 zł" />
          </label>
        </div>
      </fieldset>
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className={BTN_OUTLINE} onClick={onCancel}>
          Anuluj
        </button>
        <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => void save()}>
          {busy ? "Zapisywanie…" : "Zapisz"}
        </button>
      </div>
    </div>
  );
}
