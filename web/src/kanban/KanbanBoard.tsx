/**
 * React wrapper around Bryntum TaskBoard.
 *
 * Creates the board once per grouping configuration and pushes prop changes into the
 * live instance: tasks -> taskStore, columns -> column store (hidden/order), zoom -> a
 * CSS variable. Recreating on a swimlane change keeps the wrapper simple; every other
 * change is applied in place. `boardRef` exposes the instance for realtime updates.
 *
 * Pronto already consumes Bryntum's React wrappers (@bryntum/*-react-thin); this file is
 * the equivalent of <BryntumTaskBoard> plus the Pronto behaviours, so it can be replaced
 * by the wrapper when the licensed package is available.
 */
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";
import { TaskBoard, type ColumnModel, type TaskModel } from "@bryntum/taskboard";
import { buildBoardConfig, taskStoreOf, toTaskData, type BoardCallbacks } from "./board.config";
import type { BoardColumn, BoardLane, BoardTask, GroupBy } from "./model";
import "./kanban.css";

export type KanbanBoardProps = {
  tasks: BoardTask[];
  columns: BoardColumn[];
  lanes: BoardLane[];
  groupBy: GroupBy;
  groupKey: string;               // changes force a rebuild (swimlane field/lanes)
  zoom: number;                   // 0.7 .. 1.3
  showProjectOnCards: boolean;
  callbacks: BoardCallbacks;
  boardRef?: MutableRefObject<TaskBoard | null>;
  className?: string;
};

export function KanbanBoard({ tasks, columns, lanes, groupBy, groupKey, zoom, showProjectOnCards, callbacks, boardRef, className }: KanbanBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<TaskBoard | null>(null);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Create / rebuild
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const board = new TaskBoard(buildBoardConfig(el, {
      tasks, columns, lanes, groupBy, showProjectOnCards,
      callbacks: {
        onMove: (r) => callbacksRef.current.onMove(r),
        onRebalance: (r) => callbacksRef.current.onRebalance ? callbacksRef.current.onRebalance(r) : Promise.resolve([]),
        onReassign: (r) => callbacksRef.current.onReassign ? callbacksRef.current.onReassign(r) : Promise.resolve(),
        onOpen: (t) => callbacksRef.current.onOpen(t),
        onHideColumn: (id) => callbacksRef.current.onHideColumn?.(id),
      },
    }));
    localRef.current = board;
    if (boardRef) boardRef.current = board;
    return () => { board.destroy(); localRef.current = null; if (boardRef) boardRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupKey, showProjectOnCards]);

  // Tasks
  useEffect(() => {
    const board = localRef.current;
    if (!board) return;
    taskStoreOf(board).data = tasks.map(toTaskData);
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

  // Zoom: cards and headers are sized in em, so one font-size scales the board
  useEffect(() => {
    hostRef.current?.style.setProperty("--pk-zoom", String(zoom));
  }, [zoom]);

  return <div ref={hostRef} className={`pk-board-host ${className || ""}`} />;
}

export type { TaskModel };
