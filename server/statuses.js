/**
 * Status catalogue for a board: every task status the user can put a column on, in
 * Pronto's workflow order where known, with the count of loaded tasks in each and the
 * flags the client needs (parent container, excluded from the automatic column pick).
 *
 * Source of the list. Pronto's JSON API has no task-status resource (`/v2/api/statuses`
 * is the batch-job status table; nothing under tickets/ or tasks/ lists them), so the
 * catalogue is a snapshot of the list Beta renders into its Task Explorer page
 * (`pulse.request.formOptions.statuses`: id, title, hex_colour) kept in
 * fixtures/statuses.json. Statuses seen on the loaded tasks are merged in on top, so a
 * status added in Pronto after the snapshot still appears (with the name and colour the
 * task carries) as soon as a task has it. Swap the snapshot for the real endpoint once
 * Pronto exposes one (see README "Status list").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = JSON.parse(readFileSync(path.join(here, "fixtures", "statuses.json"), "utf8"))
  .map(([id, name, color]) => ({ id: Number(id), name: String(name).trim(), color: color || "#999999" }));

// Workflow order for the standard statuses (the Varun wireframes) and Beta's dev pipeline.
const ORDER = [
  "New", "Not Started", "Ready to Start", "In Progress", "In-Progress", "Pending Brief Approval", "Feedback Requested",
  "Feedback Provided", "Feedback in Progress", "With Client", "Awaiting Approval", "Awaiting Financial Approval", "On Hold", "On hold", "Started - On Hold",
  "Please Estimate", "Estimate Provided - Assign to Roadmap", "UX Consulting Required",
  "BA Scope Required", "BA Scope – In Progress", "BA Review", "BA Design Review", "Awaiting Spec Sign Off", "Tech Spec", "Start Spike", "Spike Completed",
  "Awaiting Sprint Assignment", "Ready for Dev Assignment", "Start Design / Prototype", "Design In Progress", "Design Done – Review Required", "Design Done - Ready for Development",
  "Start Development", "Front End DONE – Back End Required", "Back End DONE – Front End Required", "FE Ready for BE integration", "Done - Ready for code review", "Review - In Progress",
  "Done - Ready for QA", "QA in Progress", "Test Case", "Feature QA Task", "Failed QA", "Passed – Ready for CAT", "CAT Verified",
  "Ready on FB", "FB - Ready for QA", "Failed on FB", "Verified on FB", "FB - Ready for CAT", "Hotfix - Ready to test on Master",
  "Ready for Production", "LIVE - Awaiting Final Approval", "Approved - But not Closed", "KB - Review Required", "KB - Ready for Publish",
  "Support Completed", "Ready to invoice", "Invoiced", "Completed", "Cancelled", "Deleted", "Don't Use", "Parent",
];
// Closed / container statuses: hidden unless chosen, and never part of the automatic top-5 pick.
const CLOSED = new Set(["completed", "cancelled", "deleted", "don't use"]);
const isParentName = (name) => /^parent\b/i.test(name);
const isOnHoldName = (name) => /\bon[\s-]?hold\b/i.test(name);
const orderIndex = new Map(ORDER.map((n, i) => [n.trim().toLowerCase(), i]));

/** The full catalogue with per-status counts for the given tasks (0 where no task has the status). */
export function statusCatalogue(tasks) {
  const byId = new Map(SNAPSHOT.map((s) => [s.id, { ...s, count: 0 }]));
  for (const t of tasks) {
    const id = Number(t.statusId);
    const name = String(t.statusName || "").trim();
    let s = byId.get(id);
    if (!s) { s = { id, name, color: t.statusColor || "#999999", count: 0 }; byId.set(id, s); }
    else if (name && name !== s.name) { s.name = name; if (t.statusColor) s.color = t.statusColor; }   // the task is the fresher source
    s.count += 1;
  }
  const list = [...byId.values()];
  list.sort((a, b) => {
    const ia = orderIndex.get(a.name.toLowerCase()) ?? 999;
    const ib = orderIndex.get(b.name.toLowerCase()) ?? 999;
    return ia - ib || a.name.localeCompare(b.name);
  });
  for (const s of list) {
    const lower = s.name.toLowerCase();
    s.isParent = isParentName(s.name);                       // container status: never a drop target
    s.hiddenByDefault = CLOSED.has(lower) || s.isParent;     // legacy flag, kept for saved views written before the top-5 rule
    s.autoExcluded = CLOSED.has(lower) || s.isParent || isOnHoldName(s.name);   // left out of the automatic column pick
  }
  return list;
}
