/**
 * React wrapper around Bryntum TaskBoard.
 *
 * Creates the board once per grouping configuration and pushes prop changes into the
 * live instance: tasks -> taskStore, columns -> column store (hidden/order).
 * Recreating on a swimlane change keeps the wrapper simple; every other change is
 * applied in place. `boardRef` exposes the instance for realtime updates.
 *
 * Pronto already consumes Bryntum's React wrappers (@bryntum/*-react-thin); this file is
 * the equivalent of <BryntumTaskBoard> plus the Pronto behaviours, so it can be replaced
 * by the wrapper when the licensed package is available.
 */
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { TaskBoard, type ColumnModel, type TaskModel } from "@bryntum/taskboard";
import { attachLaneSource, buildBoardConfig, setAllLanesCollapsed, setBoardTasks, type BoardCallbacks } from "./board.config";
import type { BoardColumn, BoardLane, BoardTask, GroupBy } from "./model";
import "./kanban.css";

export type KanbanBoardProps = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];
  groupBy: GroupBy;
  groupKey: string;               // changes force a rebuild (swimlane field/lanes)
  showProjectOnCards: boolean;
  collapsedLanes?: Set<string>;   // initial swimlane state (BR-06: all but the first collapsed)
  laneRequest?: { collapsed: boolean; seq: number } | null; // "Expand all" / "Collapse all" clicks
  callbacks: BoardCallbacks;
  boardRef?: MutableRefObject<TaskBoard | null>;
  className?: string;
};

export function KanbanBoard({ tasks, columns, lanes, groupBy, groupKey, showProjectOnCards, collapsedLanes, laneRequest, callbacks, boardRef, className }: KanbanBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<TaskBoard | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Create / rebuild
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const config = buildBoardConfig(el, {
      tasks, columns, lanes, groupBy, showProjectOnCards, collapsedLanes,
      callbacks: {
        onMove: (r) => callbacksRef.current.onMove(r),
        onRebalance: (r) => callbacksRef.current.onRebalance ? callbacksRef.current.onRebalance(r) : Promise.resolve([]),
        onReassign: (r) => callbacksRef.current.onReassign ? callbacksRef.current.onReassign(r) : Promise.resolve(),
        onOpen: (t) => callbacksRef.current.onOpen(t),
        onHideColumn: (id) => callbacksRef.current.onHideColumn?.(id),
      },
    });
    const board = new TaskBoard(config);
    attachLaneSource(board, config);
    localRef.current = board;
    loadedRef.current = tasks;
    if (boardRef) boardRef.current = board;
    return () => { board.destroy(); localRef.current = null; if (boardRef) boardRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, showProjectOnCards]);

  // Tasks (the create effect already loaded the first list; skip that duplicate render)
  const loadedRef = useRef<BoardTask[] | null>(null);
  useEffect(() => {
    const board = localRef.current;
    if (!board || loadedRef.current === tasks) return;
    loadedRef.current = tasks;
    setBoardTasks(board, tasks);
  }, [tasks, groupKey]);

  // Columns: visibility applied in place
  useEffect(() => {
    const board = localRef.current;
    if (!board) return;
    const store = board.columns as unknown as { getById: (id: string) => ColumnModel | undefined };
    for (const c of columns) {
      const rec = store.getById(c.id);
      if (rec && rec.hidden !== c.hidden) rec.hidden = c.hidden;
    }
  }, [columns, groupKey]);

  // Expand all / Collapse all (each click is a new request, so repeats still apply)
  useEffect(() => {
    const board = localRef.current;
    if (!board || !laneRequest) return;
    setAllLanesCollapsed(board, laneRequest.collapsed);
  }, [laneRequest]);

  return <div ref={hostRef} className={`pk-board-host ${className || ""}`} />;
}

export type { TaskModel };
