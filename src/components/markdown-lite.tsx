import { Fragment, type ReactNode } from "react";
import { BASE_PATH } from "@/lib/base-path";

// Szczegóły zadania (wniosek 22, pkt 7): lekki markdown bez HTML —
// [tekst](adres), gołe adresy https://…, **pogrubienie**, listy „- ” i nowe
// linie. Adresy względne („/kalendarz?wynajem=…”) z prefiksem aplikacji.
// Wszystko renderowane jako elementy Reacta (bez dangerouslySetInnerHTML).

const TOKEN = /\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)|(https?:\/\/[^\s<]+[^\s<.,;:!?)])|\*\*([^*]+)\*\*/g;

function href(url: string): string {
  return url.startsWith("/") ? `${BASE_PATH}${url}` : url;
}

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1] && m[2]) {
      out.push(
        <a key={k} href={href(m[2])} target={m[2].startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="font-medium text-[#1B6FA8] hover:underline">
          {m[1]}
        </a>,
      );
    } else if (m[3]) {
      out.push(
        <a key={k} href={m[3]} target="_blank" rel="noreferrer" className="break-all text-[#1B6FA8] hover:underline">
          {m[3]}
        </a>,
      );
    } else if (m[4]) {
      out.push(<b key={k}>{m[4]}</b>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${k}`} className="m-0 list-disc pl-4">
        {list.map((l, j) => (
          <li key={j}>{inline(l, `li-${k}-${j}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, k) => {
    const item = line.match(/^\s*[-*•]\s+(.*)$/);
    if (item) {
      list.push(item[1]);
      return;
    }
    flush(k);
    blocks.push(line.trim() ? <p key={`p-${k}`} className="m-0">{inline(line, `p-${k}`)}</p> : <Fragment key={`br-${k}`}>{null}</Fragment>);
  });
  flush(lines.length);
  return <div className={`flex flex-col gap-1 break-words ${className ?? ""}`}>{blocks}</div>;
}
