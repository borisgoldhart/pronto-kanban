/**
 * Client-side mirror of server/rank/rank.js, used only to place a card optimistically
 * while the server confirms. The server's answer is authoritative and replaces it.
 */
export const STEP = 86_400;
export const MIN_GAP = 1e-6;

export function rankBetween(prev: number | null, next: number | null): { rank: number; rebalance: boolean } {
  const hasPrev = typeof prev === "number" && Number.isFinite(prev);
  const hasNext = typeof next === "number" && Number.isFinite(next);
  if (!hasPrev && !hasNext) return { rank: 0, rebalance: false };
  if (!hasPrev) return { rank: (next as number) - STEP, rebalance: false };
  if (!hasNext) return { rank: (prev as number) + STEP, rebalance: false };
  const p = prev as number, n = next as number;
  if (n <= p) return { rank: p, rebalance: true };
  const mid = p + (n - p) / 2;
  return { rank: mid, rebalance: n - p < MIN_GAP || mid === p || mid === n };
}
