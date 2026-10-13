import { useCallback, useEffect, useRef, useState } from "react";
import { weeklyApi } from "./weeklyApi";
import { sortWeeklyTasks, validWeeklyInput } from "./weekly";
import { readLocal, writeLocal } from "./storage";
import type { WeeklyTask, WeeklyTaskInput } from "./types";

export function useWeeklyTasks(userId: string, week: string) {
  const [rows, setRows] = useState<WeeklyTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0), alive = useRef(true), writing = useRef(false);
  const activeWeek = useRef(week);
  activeWeek.current = week;
  const draftKey = `dtl:weekly-draft:v1:${userId}`;
  const draft = useRef<{ signature: string; row: WeeklyTask } | null>(readLocal(draftKey, null));
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const request = ++version.current;
    try {
      const data = await weeklyApi.list(userId, week);
      if (alive.current && version.current === request) {
        setRows(sortWeeklyTasks(data)); setReady(true); setError("");
      }
    } catch (e) {
      if (alive.current && version.current === request) setError(e instanceof Error ? e.message : "周计划同步失败，请重试");
    } finally {
      if (alive.current && version.current === request) setLoading(false);
    }
  }, [userId, week]);
  useEffect(() => {
    alive.current = true;
    setRows([]); setReady(false); setLoading(true); setError("");
    void refresh();
    const wake = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = setInterval(wake, 60000);
    window.addEventListener("focus", wake); window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false; version.current++;
      clearInterval(interval);
      window.removeEventListener("focus", wake); window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wake);
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
