import { useCallback, useEffect, useRef, useState } from "react";
import { weeklyApi } from "./weeklyApi";
import { sortWeeklyTasks, validWeeklyInput } from "./weekly";
import { readLocal, writeLocal } from "./storage";
import { startAutoSync } from "./sync";
import type { WeeklyTask, WeeklyTaskInput } from "./types";

export function useWeeklyTasks(userId: string, week: string) {
  const [rows, setRows] = useState<WeeklyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0), alive = useRef(true), writing = useRef(false);
  const currentRows = useRef<WeeklyTask[]>([]), initialized = useRef(false);
  const reading = useRef<symbol | null>(null);
  currentRows.current = rows;
  const activeWeek = useRef(week);
  activeWeek.current = week;
  const draftKey = `dtl:weekly-draft:v1:${userId}`;
  const draft = useRef<{ signature: string; row: WeeklyTask } | null>(readLocal(draftKey, null));
  const refresh = useCallback(async (full = true): Promise<boolean | void> => {
    if (writing.current || reading.current || !navigator.onLine) return;
    const token = Symbol();
    reading.current = token;
    const request = ++version.current;
    try {
      const data = full || !initialized.current ? await weeklyApi.list(userId, week) : await weeklyApi.sync(userId, week, currentRows.current);
      if (alive.current && version.current === request && activeWeek.current === week) {
        currentRows.current = data;
        initialized.current = true;
        setRows(sortWeeklyTasks(data)); setReady(true); setError("");
      }
      return true;
    } catch (e) {
      if (alive.current && version.current === request) setError(e instanceof Error ? e.message : "周计划同步失败，请重试");
      return false;
    } finally {
      if (reading.current === token) reading.current = null;
      if (alive.current && version.current === request) setLoading(false);
    }
  }, [userId, week]);
  useEffect(() => {
    alive.current = true;
    initialized.current = false; reading.current = null; currentRows.current = [];
    setRows([]); setReady(false); setLoading(true); setError("");
    void refresh();
    const stopSync = startAutoSync(() => refresh(false));
    return () => {
      alive.current = false; version.current++;
      stopSync();
    };
  }, [refresh]);
  const run = async <T,>(job: () => Promise<T>): Promise<T> => {
    if (writing.current) throw new Error("正在保存，请稍候");
    writing.current = true; version.current++; setBusy(true); setError("");
    try {
      if (!navigator.onLine) throw new Error("当前离线，草稿已保留，请联网后保存");
      return await job();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "保存失败，请重试");
      throw e;
    } finally { writing.current = false; if (alive.current) setBusy(false); }
  };
  const merge = (row: WeeklyTask) => {
    if (alive.current && row.week_start === activeWeek.current) setRows((prev) => sortWeeklyTasks([...prev.filter((t) => t.id !== row.id), row]));
  };
  return {
    rows, loading, ready, busy, error, refresh,
    save: (input: WeeklyTaskInput, id?: string) => run(async () => {
      const data = validWeeklyInput(input);
      if (id) merge(await weeklyApi.update(userId, id, data));
      else {
        const signature = JSON.stringify({ week, ...data });
        const row = draft.current?.signature === signature ? draft.current.row : {
          ...data, id: crypto.randomUUID(), user_id: userId, week_start: week,
          completed: false, completed_at: null, created_at: new Date().toISOString(),
        };
        draft.current = { signature, row };
        writeLocal(draftKey, draft.current);
        merge(await weeklyApi.create(row)); draft.current = null;
        writeLocal(draftKey, null);
      }
    }),
    toggle: (task: WeeklyTask) => run(async () => merge(await weeklyApi.update(userId, task.id, {
      completed: !task.completed, completed_at: task.completed ? null : new Date().toISOString(),
    }))),
    remove: (id: string) => run(async () => {
      await weeklyApi.remove(userId, id);
      if (alive.current) setRows((prev) => prev.filter((task) => task.id !== id));
    }),
  };
}
