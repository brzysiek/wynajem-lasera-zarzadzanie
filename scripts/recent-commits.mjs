// Wniosek 30: po `next build` zapisuje ostatnie commity (skrót, data, tytuł)
// do .next/recent-commits.json — panel podpowiada „wdrożono w …” przy
// wnioskach wymienionych w tytule commita. Bez gita (np. brak historii) —
// pusta lista, build się nie przerywa.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

let commits = [];
try {
  const out = execFileSync("git", ["log", "-n", "300", "--format=%h%x1f%cI%x1f%s%x1e"], { encoding: "utf8" });
  commits = out
    .split("\x1e")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [hash, at, subject] = l.split("\x1f");
      return { hash, at, subject };
    });
} catch {
  commits = [];
}
mkdirSync(".next", { recursive: true });
writeFileSync(".next/recent-commits.json", JSON.stringify(commits));
console.log(`recent-commits.json: ${commits.length} commitów`);
