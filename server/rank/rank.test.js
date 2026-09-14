import test from "node:test";
import assert from "node:assert/strict";
import { seedRank, rankBetween, rebalance, NO_DUE_BASE, effectiveRank, TIER_SPAN } from "./rank.js";

test("due-dated tasks seed ascending by due date, ids break ties", () => {
  const a = seedRank({ id: 10, endDate: "2026-09-01 00:00:00" });
  const b = seedRank({ id: 11, endDate: "2026-09-01 00:00:00" });
  const c = seedRank({ id: 5, endDate: "2026-09-02 00:00:00" });
  assert.ok(a < b && b < c);
});

test("undated tasks follow every dated task, newest first", () => {
  const dated = seedRank({ id: 99999, endDate: "2099-12-31" });
  const older = seedRank({ id: 100 });
  const newer = seedRank({ id: 200 });
  assert.ok(dated < newer && newer < older);
  assert.ok(older > NO_DUE_BASE);
});

test("rankBetween is a single midpoint write", () => {
  assert.equal(rankBetween(10, 20).rank, 15);
  assert.equal(rankBetween(null, 20).rank, 20 - 86400);
  assert.equal(rankBetween(10, null).rank, 10 + 86400);
  assert.equal(rankBetween(null, null).rank, 0);
});

test("rankBetween flags exhausted gaps", () => {
  let lo = 1_700_000_000, hi = lo + 1;
  let flagged = false;
  for (let i = 0; i < 100 && !flagged; i++) {
    const r = rankBetween(lo, hi);
    flagged = r.rebalance;
    hi = r.rank;
  }
  assert.ok(flagged, "a rebalance should be requested before precision runs out");
});

test("rebalance spaces evenly and keeps order", () => {
  const out = rebalance([1, 1.0000001, 1.0000002, 50]);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] > out[i - 1]);
  assert.equal(out[0], 1);
  assert.equal(out[out.length - 1], 50);
});

test("priority forms the outer block: P1 before P2 before P3 before unset", () => {
  const p1 = seedRank({ id: 5, priority: 1 });
  const p2 = seedRank({ id: 5, endDate: "2020-01-01", priority: 2 });
  const p3 = seedRank({ id: 5, endDate: "2020-01-01", priority: 3 });
  const none = seedRank({ id: 5, endDate: "2020-01-01", priority: 0 });
  assert.ok(p1 < p2 && p2 < p3 && p3 < none);
  assert.ok(none < 4 * TIER_SPAN);
});

test("effectiveRank prefers the stored value", () => {
  assert.equal(effectiveRank({ id: 1 }, 42), 42);
  assert.equal(effectiveRank({ id: 1 }, null), seedRank({ id: 1 }));
});
