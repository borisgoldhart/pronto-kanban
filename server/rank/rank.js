/**
 * Kanban rank: one global, per-task ordering value.
 *
 * Design (from the "Spike: Global Task Order" on the Kanban Enhancements project):
 *   - Every task has ONE rank, independent of status and of which board it is seen on.
 *     Project Kanban and Task Explorer Kanban both sort each column by rank, so a card
 *     keeps its relative position wherever it is viewed. Filtering never re-ranks.
 *   - The rank is SEEDED from data the task already has, so the 200k existing tasks need
 *     no backfill: due date first (tasks coming up sort to the top, ascending), otherwise
 *     a "no due date" block ordered newest-first. The task id is folded in as a
 *     tie-breaker so two tasks due the same day never collide.
 *   - A drag and drop writes ONE value: the moved task's rank becomes the midpoint of its
 *     new neighbours (relative ranking). Nothing else in the column is touched.
 *   - Midpoints halve the gap each time. When a gap gets too small the column
 *     neighbourhood is re-spaced (rebalance); with the seed spacing used here that is a
 *     rare, cheap, background operation.
 *
 * Units: seconds. Due-dated tasks sit around 1.5e9 to 2e9; undated tasks sit above
 * NO_DUE_BASE so they follow every dated task. Doubles keep ~1e-7 precision at this
 * magnitude, so roughly 40 consecutive drops into the same gap are possible before a
 * rebalance is needed.
 *
 * Production mapping: `kanban_rank DOUBLE NULL` on the task table, index (status, kanban_rank);
 * NULL means "use the seed", computed in SQL as
 *   COALESCE(kanban_rank, IF(enddate IS NULL, 1e10 + (1e8 - id), UNIX_TIMESTAMP(enddate) + id / 1e6)).
 * Redis is a cache in front of that, never the source of truth.
 */

export const NO_DUE_BASE = 10_000_000_000;   // year 2286: after every real due date
export const ID_SPAN = 100_000_000;          // ids are far below this
export const STEP = 86_400;                  // one day: gap used when dropping at the top/bottom
export const MIN_GAP = 1e-6;                 // below this a rebalance is requested

/** Seed rank for a task that has never been dragged. */
export function seedRank({ id, endDate }) {
  const numericId = Number(id) || 0;
  const due = endDate ? Date.parse(String(endDate).replace(" ", "T")) : NaN;
  if (Number.isFinite(due)) return Math.floor(due / 1000) + numericId / 1e6;
  return NO_DUE_BASE + (ID_SPAN - numericId);
}

/** Effective rank: the stored override when there is one, otherwise the seed. */
export function effectiveRank(task, storedRank) {
  return typeof storedRank === "number" && Number.isFinite(storedRank) ? storedRank : seedRank(task);
}

/**
 * Rank for a task dropped between two neighbours (either may be null at the edges).
 * Returns { rank, rebalance } where rebalance=true means the gap is exhausted and the
 * caller should re-space the column (the returned rank is still usable meanwhile).
 */
export function rankBetween(prevRank, nextRank) {
  const hasPrev = typeof prevRank === "number" && Number.isFinite(prevRank);
  const hasNext = typeof nextRank === "number" && Number.isFinite(nextRank);
  if (!hasPrev && !hasNext) return { rank: 0, rebalance: false };
  if (!hasPrev) return { rank: nextRank - STEP, rebalance: false };
  if (!hasNext) return { rank: prevRank + STEP, rebalance: false };
  if (nextRank <= prevRank) return { rank: prevRank, rebalance: true };
  const gap = nextRank - prevRank;
  const mid = prevRank + gap / 2;
  return { rank: mid, rebalance: gap < MIN_GAP || mid === prevRank || mid === nextRank };
}

/**
 * Re-space an ordered list of ranks evenly between the first and last value
 * (or STEP apart when they coincide). Returns the new ranks in the same order.
 */
export function rebalance(orderedRanks) {
  const n = orderedRanks.length;
  if (n < 2) return orderedRanks.slice();
  const first = orderedRanks[0];
  const last = orderedRanks[n - 1];
  const span = last > first ? last - first : STEP * (n - 1);
  const step = span / (n - 1);
  return orderedRanks.map((_, i) => first + step * i);
}

/** Sort comparator for column display. */
export function byRank(a, b) {
  return (a.rank - b.rank) || (Number(a.id) - Number(b.id));
}
