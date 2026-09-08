import { useCallback, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { api } from "./api";
import {
  carryCandidates,
  carryRow,
  carryId,
  cancelledSources,
  cancelledTaskIds,
  dayKey,
  isRuleDue,
  repeatId,
  repeatRow,
  ruleForTask,
  rulesFromMetadata,
  RULE_PREFIX,
  SKIP_PREFIX,
  CARRY_PROMPT,
  CARRY_CANCEL,
  sortTasks,
  validInput,
} from "./domain";
import { readLocal, writeLocal } from "./storage";
import type {
  Task,
  TaskInput,
  Metadata,
  RepeatRule,
  PendingDelete,
} from "./types";

export function useWorkspace(user: User) {
  const userId = user.id;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [metadata, setMetadata] = useState<Metadata>(user.user_metadata || {});
  const [ready, setReady] = useState(false),
    [loading, setLoading] = useState(true),
    [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null),
    [lastSaved, setLastSaved] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const deleteKey = `dtl:delete:v2:${userId}`;
  const addKey = `dtl:add:v2:${userId}`;
  const draftRows = useRef<Record<string, Task>>(readLocal(addKey, {}));
  const [deletions, setDeletions] = useState<PendingDelete[]>(() =>
    readLocal<PendingDelete[]>(deleteKey, []).filter(
      (x) => x?.task?.user_id === userId && Number.isFinite(x.deadline),
    ),
  );
  const state = useRef({ tasks, metadata, deletions });
  state.current = { tasks, metadata, deletions };
  const alive = useRef(true),
    chain = useRef<Promise<unknown>>(Promise.resolve()),
    mutating = useRef(0),
    readVersion = useRef(0),
    readBusy = useRef(false),
    deleting = useRef(new Set<string>());
  const mergeTasks = (rows: Task[]) =>
    setTasks((prev) =>
      sortTasks([
        ...new Map([...prev, ...rows].map((t) => [t.id, t])).values(),
      ]),
    );
  const setDeleteList = useCallback(
    (next: PendingDelete[]) => {
      state.current.deletions = next;
      setDeletions(next);
      writeLocal(deleteKey, next);
    },
    [deleteKey],
  );
  const transact = useCallback(<T>(operation: () => Promise<T>): Promise<T> => {
    if (!alive.current)
      return Promise.reject(new Error("页面或账号已切换，操作已取消"));
    mutating.current++;
    readVersion.current++;
    setPending(mutating.current);
    const job = chain.current
      .catch(() => undefined)
      .then(async () => {
        if (!alive.current) throw new Error("页面或账号已切换，操作已取消");
        if (!navigator.onLine)
          throw new Error("网络已断开，内容已保留，请联网后重试");
        const result = await operation();
        if (alive.current) {
          setError(null);
          setLastSaved(new Date().toISOString());
        }
        return result;
      })
      .catch((e) => {
        if (alive.current)
          setError(e instanceof Error ? e.message : "保存失败，请重试");
        throw e;
      })
      .finally(() => {
        mutating.current--;
        if (alive.current) setPending(mutating.current);
      });
    chain.current = job;
    return job;
  }, []);
  const refresh = useCallback(async () => {
    if (readBusy.current || mutating.current) return;
    readBusy.current = true;
    const version = ++readVersion.current;
    try {
      const [rows, meta] = await Promise.all([
        api.list(userId),
        api.metadata(userId),
      ]);
      if (alive.current && readVersion.current === version) {
        setTasks(sortTasks(rows));
        setMetadata(meta);
        setReady(true);
        setError(null);
        setLastSaved(new Date().toISOString());
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      readBusy.current = false;
      if (alive.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const wake = () => {
      setOnline(navigator.onLine);
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = setInterval(wake, 60000);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      alive.current = false;
      clearInterval(interval);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [refresh]);
  useEffect(() => {
    const receive = (e: StorageEvent) => {
      if (e.key === deleteKey)
        setDeletions(readLocal<PendingDelete[]>(deleteKey, []));
    };
    window.addEventListener("storage", receive);
    return () => window.removeEventListener("storage", receive);
  }, [deleteKey]);
  const add = useCallback(
    (input: TaskInput) =>
      transact(async () => {
        const normalized = validInput(input),
          signature = JSON.stringify(normalized);
        const row: Task = draftRows.current[signature] || {
          ...normalized,
          id: crypto.randomUUID(),
          user_id: userId,
          completed: false,
          completed_at: null,
          elapsed_seconds: 0,
          created_at: new Date().toISOString(),
        };
        draftRows.current[signature] = row;
        writeLocal(addKey, draftRows.current);
        await api.insertOnce([row]);
        const saved = await api.get(userId, row.id);
        mergeTasks([saved]);
        delete draftRows.current[signature];
        writeLocal(addKey, draftRows.current);
        return saved;
      }),
    [userId, transact, addKey],
  );
  const update = useCallback(
    (id: string, input: TaskInput) =>
      transact(async () => {
        const saved = await api.update(userId, id, validInput(input));
        mergeTasks([saved]);
      }),
    [userId, transact],
  );
  const toggle = useCallback(
    (id: string) =>
      transact(async () => {
        const task = state.current.tasks.find((t) => t.id === id);
        if (!task) return;
        const saved = await api.update(userId, id, {
          completed: !task.completed,
          completed_at: task.completed ? null : new Date().toISOString(),
        });
        mergeTasks([saved]);
      }),
    [userId, transact],
  );
  const saveElapsed = useCallback(
    (id: string, seconds: number) =>
      transact(async () => {
        const saved = await api.saveElapsed(
          userId,
          id,
          Math.max(0, Math.floor(seconds)),
        );
        mergeTasks([saved]);
      }),
    [userId, transact],
  );
  const dismissCarry = useCallback(
    () =>
      transact(async () => {
        const day = dayKey();
        const meta = await api.patchMetadata(userId, { [CARRY_PROMPT]: day });
        setMetadata(meta);
        writeLocal(`dtl:carry:${userId}`, day);
      }),
    [userId, transact],
  );
  const carry = useCallback(
    (ids: string[], expectedDay: string) =>
      transact(async () => {
        const now = new Date();
        if (dayKey(now) !== expectedDay)
          throw new Error("日期已变化，请重新选择要迁移的任务");
        const [fresh, settings] = await Promise.all([
            api.list(userId),
            api.metadata(userId),
          ]),
          wanted = new Set(ids);
        const cancelled = cancelledSources(settings);
        const candidates = carryCandidates(
          fresh,
          expectedDay,
          cancelled,
        ).filter((t) => wanted.has(t.id));
        if (dayKey() !== expectedDay)
          throw new Error("日期已变化，请重新选择要迁移的任务");
        const inserted = await api.insertOnce(
          candidates.map((t) => carryRow(t, userId, now)),
        );
        const resulting = await api.list(userId);
        setTasks(sortTasks(resulting));
        // Mark after successful insert. Failure of this write is safe to retry: stable IDs.
        const meta = await api.patchMetadata(userId, {
          [CARRY_PROMPT]: expectedDay,
        });
        setMetadata(meta);
        writeLocal(`dtl:carry:${userId}`, expectedDay);
        return inserted.length;
      }),
    [userId, transact],
  );
  const saveRule = useCallback(
    (rule: RepeatRule) =>
      transact(async () => {
        if (!rule.name.trim()) throw new Error("请输入重复任务名称");
        const meta = await api.patchMetadata(userId, {
          [RULE_PREFIX + rule.id]: rule.deleted ? null : rule,
        });
        setMetadata(meta);
      }),
    [transact, userId],
  );
  const generateRepeats = useCallback(
    () =>
      transact(async () => {
        const meta = await api.metadata(userId),
          now = new Date(),
          day = dayKey(now);
        setMetadata(meta);
        const rules = rulesFromMetadata(meta).filter(
          (r) => isRuleDue(r, day) && meta[SKIP_PREFIX + r.id] !== day,
        );
        if (dayKey() !== day) return;
        await api.insertOnce(rules.map((r) => repeatRow(r, userId, now)));
        const latest = await api.metadata(userId);
        setMetadata(latest);
        const cancelled = cancelledTaskIds(latest);
        // A second device may have cancelled while this device was inserting.
        for (const rule of rules) {
          const id = repeatId(rule.id, day);
          if (cancelled.has(id)) await api.remove(userId, id);
        }
        const rows = await api.list(userId);
        setTasks(sortTasks(rows));
      }),
    [userId, transact],
  );
  const scheduleDelete = useCallback(
    (task: Task) => {
      if (state.current.deletions.some((x) => x.task.id === task.id)) return;
      setDeleteList([
        ...state.current.deletions,
        { task, deadline: Date.now() + 8000 },
      ]);
    },
    [setDeleteList],
  );
  const undoDelete = useCallback(
    (id: string) => {
      if (deleting.current.has(id)) return;
      const item = state.current.deletions.find((x) => x.task.id === id);
      if (
        item &&
        (item.status || (item.deadline <= Date.now() && navigator.onLine))
      )
        return;
      setDeleteList(state.current.deletions.filter((x) => x.task.id !== id));
    },
    [setDeleteList],
  );
  const retryDelete = useCallback(
    (id: string) =>
      setDeleteList(
        state.current.deletions.map((item) =>
          item.task.id === id
            ? { ...item, status: undefined, error: undefined, deadline: 0 }
            : item,
        ),
      ),
    [setDeleteList],
  );
  useEffect(() => {
    const timer = setInterval(() => {
      for (const item of state.current.deletions) {
        if (
          item.deadline > Date.now() ||
          item.status === "failed" ||
          deleting.current.has(item.task.id) ||
          !navigator.onLine
        )
          continue;
        deleting.current.add(item.task.id);
        const execute = () =>
          transact(async () => {
            // Skip this occurrence before deletion so it cannot immediately regenerate.
            // Re-read cross-tab undo state immediately before committing the delete.
            const stillPending = readLocal<PendingDelete[]>(
              deleteKey,
              state.current.deletions,
            ).some((x) => x.task.id === item.task.id);
            if (!stillPending) {
              setDeleteList(
                state.current.deletions.filter(
                  (x) => x.task.id !== item.task.id,
                ),
              );
              return;
            }
            setDeleteList(
              state.current.deletions.map((x) =>
                x.task.id === item.task.id
                  ? { ...x, status: "committing", error: undefined }
                  : x,
              ),
            );
            const [meta, fresh] = await Promise.all([
              api.metadata(userId),
              api.list(userId),
            ]);
            const rule = ruleForTask(item.task, rulesFromMetadata(meta));
            const sources = fresh.filter(
              (t) =>
                carryId(t.id, dayKey(item.task.created_at)) === item.task.id,
            );
            const patch: Metadata = {};
            if (rule && dayKey(item.task.created_at) === dayKey())
              patch[SKIP_PREFIX + rule.id] = dayKey(item.task.created_at);
            for (const source of sources)
              patch[CARRY_CANCEL + source.id] = item.task.id;
            // Mark cancelled copies before removal, preventing automatic regeneration.
            if (Object.keys(patch).length) {
              const next = await api.patchMetadata(userId, patch);
              setMetadata(next);
            }
            await api.remove(userId, item.task.id);
            setTasks((prev) => prev.filter((t) => t.id !== item.task.id));
            setDeleteList(
              state.current.deletions.filter((x) => x.task.id !== item.task.id),
            );
          }).catch(async () => {
            if (!alive.current) return;
            // A failed response does not prove that DELETE failed on the server.
            try {
              const rows = await api.list(userId);
              setTasks(sortTasks(rows));
              if (!rows.some((t) => t.id === item.task.id)) {
                setDeleteList(
                  state.current.deletions.filter(
                    (x) => x.task.id !== item.task.id,
                  ),
                );
                setError(null);
                return;
              }
            } catch {
              /* Keep the uncertain operation recoverable. */
            }
            setDeleteList(
              state.current.deletions.map((x) =>
                x.task.id === item.task.id
                  ? {
                      ...x,
                      status: "failed",
                      error: "删除尚未完成，任务记录已保留",
                    }
                  : x,
              ),
            );
          });
        const commit = navigator.locks
          ? navigator.locks.request(
              `dtl-delete:${userId}:${item.task.id}`,
              { ifAvailable: true },
              async (lock) => {
                if (lock) await execute();
              },
            )
          : execute();
        void commit.finally(() => deleting.current.delete(item.task.id));
      }
    }, 500);
    return () => clearInterval(timer);
  }, [setDeleteList, transact, userId, deleteKey]);
  const hidden = cancelledTaskIds(metadata);
  return {
    tasks: tasks.filter(
      (t) => !hidden.has(t.id) && !deletions.some((d) => d.task.id === t.id),
    ),
    allTasks: tasks.filter((t) => !hidden.has(t.id)),
    metadata,
    ready,
    loading,
    pending,
    error,
    lastSaved,
    online,
    deletions,
    refresh,
    add,
    update,
    toggle,
    saveElapsed,
    carry,
    dismissCarry,
    saveRule,
    generateRepeats,
    scheduleDelete,
    undoDelete,
    retryDelete,
  };
}
