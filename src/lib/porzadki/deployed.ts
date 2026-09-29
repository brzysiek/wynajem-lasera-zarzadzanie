import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { logWarn } from "@/lib/logger";
import { latestDeployByNumber, type DeployCommit } from "./deploy-refs";

// Wniosek 30: raz na wdrożenie (nowy commit w stopce) czyta
// .next/recent-commits.json (scripts/recent-commits.mjs) i zapisuje przy
// wnioskach „wdrożono w <commit> · <data>”. Statusu nie zmienia.

const SCAN_KEY = "proposals_deploy_scan";

export async function syncDeployedProposals(): Promise<void> {
  const head = process.env.NEXT_PUBLIC_APP_COMMIT;
  if (!head || head === "dev") return;
  try {
    const done = await prisma.setting.findUnique({ where: { key: SCAN_KEY } });
    if (done?.value === head) return;
    const raw = await readFile(path.join(process.cwd(), ".next", "recent-commits.json"), "utf8").catch(() => null);
    const commits: DeployCommit[] = raw ? JSON.parse(raw) : [];
    const byNumber = latestDeployByNumber(commits);
    for (const [number, c] of byNumber) {
      const at = new Date(c.at);
      await prisma.proposal.updateMany({
        where: { number, OR: [{ deployedAt: null }, { deployedAt: { lt: at } }] },
        data: { deployedCommit: c.hash, deployedAt: at },
      });
    }
    await prisma.setting.upsert({ where: { key: SCAN_KEY }, create: { key: SCAN_KEY, value: head }, update: { value: head } });
  } catch (err) {
    logWarn("proposal_deploy_scan_failed", { error: err instanceof Error ? err.message : String(err) });
  }
}
