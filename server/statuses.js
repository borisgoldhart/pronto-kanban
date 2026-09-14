/**
 * Status catalogue for a board: one column per distinct task status seen in the data,
 * in Pronto's workflow order where known, with counts and default visibility.
 *
 * Pronto exposes no standalone "task statuses" endpoint to the Bryntum API, so the
 * catalogue is derived from the tasks themselves (which carry id, name and colour).
 * In Pronto proper the column list comes from the project's status configuration.
 */

// Workflow order for the standard statuses (the Varun wireframes) and Beta's dev pipeline.
const ORDER = [
  "New", "Ready to Start", "In Progress", "In-Progress", "Pending Brief Approval", "Feedback Requested",
  "Feedback Provided", "With Client", "Awaiting Approval", "On Hold", "On hold",
  "BA Scope Required", "BA Scope – In Progress", "BA Review", "Awaiting Spec Sign Off", "Start Spike", "Spike Completed",
  "Awaiting Sprint Assignment", "Start Design / Prototype", "Start Development", "Done - Ready for code review",
  "Done - Ready for QA", "FB - Ready for QA", "Failed QA", "Passed – Ready for CAT", "CAT Verified", "Ready on FB",
  "Ready for Production", "LIVE - Awaiting Final Approval", "Approved - But not Closed", "Support Completed",
  "Completed", "Cancelled", "Deleted", "Parent",
];
const HIDDEN_BY_DEFAULT = new Set(["completed", "cancelled", "deleted", "parent"]);
const orderIndex = new Map(ORDER.map((n, i) => [n.trim().toLowerCase(), i]));

export function statusCatalogue(tasks) {
  const byId = new Map();
  for (const t of tasks) {
    const id = t.statusId;
    if (!byId.has(id)) byId.set(id, { id, name: String(t.statusName || "").trim(), color: t.statusColor, count: 0 });
    byId.get(id).count += 1;
  }
  const list = [...byId.values()];
  list.sort((a, b) => {
    const ia = orderIndex.get(a.name.toLowerCase()) ?? 999;
    const ib = orderIndex.get(b.name.toLowerCase()) ?? 999;
    return ia - ib || a.name.localeCompare(b.name);
  });
  for (const s of list) {
    s.hiddenByDefault = HIDDEN_BY_DEFAULT.has(s.name.toLowerCase()) || /^parent\b/i.test(s.name);
    s.isParent = /^parent\b/i.test(s.name);   // container status: never a drop target
  }
  return list;
}
