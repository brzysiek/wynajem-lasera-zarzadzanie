// Wniosek 30: „wdrożono w …” — numery wniosków z tytułu commita, np.
// „Wnioski 24–27 (część 2): …”, „Wnioski 26 i 24 (część 1)”,
// „Wnioski 20 (dziennik), 21 (pula wiosny), 22 i uwagi 18 a–d”,
// „Cel sezonu … (wniosek 21)”. Tylko podpowiedź — status ustawia Tomek.

const KEYWORD = /wnios(?:ek|ki|ków|ku)\s+/gi;

export function proposalNumbersIn(subject: string): number[] {
  const out = new Set<number>();
  for (const m of subject.matchAll(KEYWORD)) {
    let rest = subject.slice((m.index ?? 0) + m[0].length);
    // Koniec listy: dwukropek, nowa linia albo nawias zamykający bez pary.
    let depth = 0;
    let end = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === ":" || c === "\n") {
        end = i;
        break;
      }
      if (c === "(") depth++;
      if (c === ")") {
        if (depth === 0) {
          end = i;
          break;
        }
        depth--;
      }
    }
    rest = rest.slice(0, end).replace(/\([^()]*\)/g, " ");
    const tokens = rest.match(/\d+\s*[–—-]\s*\d+|\d+|[^\s\d,]+/g) ?? [];
    for (const t of tokens) {
      const range = t.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
      if (range) {
        const [a, b] = [Number(range[1]), Number(range[2])];
        if (b >= a && b - a <= 20) for (let n = a; n <= b; n++) out.add(n);
        continue;
      }
      if (/^\d+$/.test(t)) {
        out.add(Number(t));
        continue;
      }
      if (/^(i|oraz|and|\+|&)$/i.test(t)) continue;
      break;
    }
  }
  return [...out].filter((n) => n > 0 && n < 100000).sort((a, b) => a - b);
}

export type DeployCommit = { hash: string; at: string; subject: string };

// Numer wniosku → najnowszy commit, który go wymienia (lista od najnowszego).
export function latestDeployByNumber(commits: DeployCommit[]): Map<number, { hash: string; at: string }> {
  const out = new Map<number, { hash: string; at: string }>();
  for (const c of commits) {
    for (const n of proposalNumbersIn(c.subject)) {
      const prev = out.get(n);
      if (!prev || prev.at < c.at) out.set(n, { hash: c.hash, at: c.at });
    }
  }
  return out;
}
