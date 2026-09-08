import { useEffect, useMemo, useState } from "react";
import type { Task, TimerMode } from "./types";

type SaveElapsed = (id: string, seconds: number) => Promise<void>;
interface Session {
  taskId: string;
  mode: TimerMode;
  duration: number;
  elapsedMs: number;
  startedAt: number | null;
}
interface Progress {
  totalMs: number;
  savedSeconds: number;
}
interface TimerView {
  userId: string;
  taskId: string | null;
  mode: TimerMode;
  running: boolean;
  elapsed: number;
  remaining: number;
  duration: number;
  error: string | null;
}

const SAVE_INTERVAL = 15_000;
const seconds = (ms: number) => Math.floor(ms / 1000);
const validNumber = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const remoteSeconds = (task: Task) =>
  validNumber(task.elapsed_seconds) ? Math.floor(task.elapsed_seconds) : 0;
const emptyView = (userId: string): TimerView => ({
  userId,
  taskId: null,
  mode: "countup",
  running: false,
  elapsed: 0,
  remaining: 0,
  duration: 0,
  error: null,
});

// Session time is separate from the task's cumulative time. Only timestamps advance
// either counter; render frequency and background-tab timer throttling are irrelevant.
function advance(session: Session, progress: Progress, now: number): boolean {
  if (session.startedAt === null) return false;
  const delta = Math.max(0, now - session.startedAt);
  const credited =
    session.mode === "countdown"
      ? Math.min(
          delta,
          Math.max(0, session.duration * 1000 - session.elapsedMs),
        )
      : delta;
  session.elapsedMs += credited;
  progress.totalMs += credited;
  session.startedAt = Math.max(session.startedAt, now);
  const finished =
    session.mode === "countdown" &&
    session.elapsedMs >= session.duration * 1000;
  if (finished) session.startedAt = null;
  return finished;
}

function createTimer(userId: string) {
  const storageKey = `dtl_focus_timer_v1:${encodeURIComponent(userId)}`;
  const progress = new Map<string, Progress>();
  const inFlight = new Map<string, number>();
  const followUp = new Set<string>();
  const failures = new Map<string, string>();
  let tasks = new Map<string, Task>();
  let session: Session | null = null;
  let saveElapsed: SaveElapsed;
  let listener: ((view: TimerView) => void) | null = null;
  let connected = false;
  let restored = false;
  let storageError: string | null = null;
  let actionError: string | null = null;
  let lastBackup: string | null = null;

  function view(): TimerView {
    const errors = [actionError, storageError, ...failures.values()].filter(
      Boolean,
    );
    return {
      ...emptyView(userId),
      taskId: session?.taskId ?? null,
      mode: session?.mode ?? "countup",
      running: session?.startedAt != null,
      // elapsed is cumulative task time; remaining always uses this session alone.
      elapsed: session
        ? seconds(progress.get(session.taskId)?.totalMs ?? 0)
        : 0,
      remaining:
        session?.mode === "countdown"
          ? Math.max(0, Math.ceil(session.duration - session.elapsedMs / 1000))
          : 0,
      duration: session?.duration ?? 0,
      error: errors.length ? errors.join("\n") : null,
    };
  }

  function backup() {
    if (!userId) return;
    const data = JSON.stringify({
      version: 1,
      // Never persist a running anchor: time away after a reload is not credited.
      session: session ? { ...session, startedAt: null } : null,
      progress: [...progress].filter(
        ([id, p]) =>
          id === session?.taskId || p.totalMs > p.savedSeconds * 1000,
      ),
    });
    try {
      if (data !== lastBackup) window.localStorage.setItem(storageKey, data);
      lastBackup = data;
      storageError = null;
    } catch {
      storageError = "无法备份计时进度到本机；刷新前请确认进度已同步。";
    }
  }

  function publish() {
    if (!connected) return;
    backup();
    listener?.(view());
  }

  function restore() {
    if (restored || !userId) return;
    restored = true;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version !== 1 || !Array.isArray(data.progress))
        throw new Error("Invalid backup");
      for (const entry of data.progress) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [id, p] = entry;
        if (
          typeof id === "string" &&
          p &&
          validNumber(p.totalMs) &&
          validNumber(p.savedSeconds)
        ) {
          progress.set(id, {
            totalMs: Math.max(p.totalMs, Math.floor(p.savedSeconds) * 1000),
            savedSeconds: Math.floor(p.savedSeconds),
          });
        }
      }
      const s = data.session;
      if (
        s &&
        typeof s.taskId === "string" &&
        progress.has(s.taskId) &&
        (s.mode === "countup" || s.mode === "countdown") &&
        validNumber(s.duration) &&
        validNumber(s.elapsedMs) &&
        (s.mode === "countup" || s.duration >= 1)
      ) {
        session = {
          taskId: s.taskId,
          mode: s.mode,
          duration: s.mode === "countdown" ? s.duration : 0,
          elapsedMs:
            s.mode === "countdown"
              ? Math.min(s.elapsedMs, s.duration * 1000)
              : s.elapsedMs,
          startedAt: null,
        };
      }
    } catch {
      actionError =
        "无法读取本机计时备份；已暂停计时，请检查已同步的任务时长。";
    }
  }

  function reconcile(id: string) {
    const task = tasks.get(id);
    const p = progress.get(id);
    if (!task || !p) return;
    const remote = remoteSeconds(task);
    // The callback writes an absolute total. Never send less than any remote total
    // already observed, including a newer total received during paused recovery.
    p.totalMs = Math.max(p.totalMs, remote * 1000);
    p.savedSeconds = Math.max(p.savedSeconds, remote);
    if (seconds(p.totalMs) <= p.savedSeconds) failures.delete(id);
  }

  function checkpoint(now = Date.now()) {
    if (!session) return false;
    return advance(session, progress.get(session.taskId)!, now);
  }

  function save(id: string) {
    reconcile(id);
    const p = progress.get(id);
    if (!p || seconds(p.totalMs) <= p.savedSeconds) return;
    const task = tasks.get(id);
    if (!task) {
      failures.set(id, "任务暂不可用，未同步的计时进度已保留，恢复后将重试。");
      return;
    }
    const total = seconds(p.totalMs);
    const sending = inFlight.get(id);
    if (sending !== undefined) {
      if (total > sending) followUp.add(id);
      return;
    }
    inFlight.set(id, total);
    // Capture this user's callback before any asynchronous work or account change.
    const writer = saveElapsed;
    void (async () => {
      let succeeded = false;
      try {
        await writer(id, total);
        p.savedSeconds = Math.max(p.savedSeconds, total);
        failures.delete(id);
        succeeded = true;
      } catch {
        failures.set(
          id,
          `“${task.name}”的计时进度同步失败，进度已保留，将自动重试。`,
        );
      } finally {
        inFlight.delete(id);
        const again = followUp.delete(id);
        // A late response from an unmounted controller must not overwrite a newer
        // controller's local backup. The pre-unmount backup remains retryable.
        publish();
        if (succeeded && again) save(id);
      }
    })();
  }

  function flush() {
    for (const id of progress.keys()) save(id);
    publish();
  }

  function pause() {
    checkpoint();
    if (session) session.startedAt = null;
    publish();
    flush();
  }

  function update(nextTasks: Task[], writer: SaveElapsed) {
    const previous = tasks;
    saveElapsed = writer;
    const finished = checkpoint();
    tasks = new Map(
      nextTasks.filter((t) => t.user_id === userId).map((t) => [t.id, t]),
    );
    for (const id of progress.keys()) reconcile(id);
    const unavailable =
      session &&
      (!tasks.has(session.taskId) || tasks.get(session.taskId)!.completed);
    if (session?.startedAt != null && unavailable) pause();
    else if (finished) flush();
    // Retry recovered progress once its task data arrives, not on every render.
    for (const id of progress.keys())
      if (tasks.has(id) && !previous.has(id)) save(id);
    publish();
  }

  function connect(
    nextTasks: Task[],
    writer: SaveElapsed,
    onChange: (view: TimerView) => void,
  ) {
    connected = true;
    listener = onChange;
    restore();
    update(nextTasks, writer);
    if (!userId)
      return () => {
        connected = false;
        listener = null;
      };
    flush();
    const tick = window.setInterval(() => {
      if (session?.startedAt == null) return;
      const finished = checkpoint();
      publish();
      if (finished) flush();
    }, 1000);
    const retry = window.setInterval(() => {
      checkpoint();
      flush();
    }, SAVE_INTERVAL);
    const catchUp = () => {
      checkpoint();
      flush();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") catchUp();
      else if (checkpoint()) flush();
      else publish();
    };
    // pagehide cannot guarantee delivery of a Promise-based writer. Save a paused
    // local snapshot first, then attempt the final write while the page still lives.
    const pagehide = () => pause();
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", catchUp);
    window.addEventListener("focus", catchUp);
    window.addEventListener("online", catchUp);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(retry);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", catchUp);
      window.removeEventListener("focus", catchUp);
      window.removeEventListener("online", catchUp);
      document.removeEventListener("visibilitychange", visibility);
      connected = false;
      listener = null;
      checkpoint();
      if (session) session.startedAt = null;
      backup();
      flush();
    };
  }

  function start(task: Task, mode: TimerMode, minutes = 25) {
    if (!connected) return;
    const current = tasks.get(task.id);
    if (!userId || task.user_id !== userId || !current || current.completed) {
      actionError = "任务已完成或暂不可用，无法开始计时。";
      publish();
      return;
    }
    if (
      (mode !== "countup" && mode !== "countdown") ||
      (mode === "countdown" &&
        (!Number.isFinite(minutes) ||
          minutes <= 0 ||
          minutes * 60_000 > Number.MAX_SAFE_INTEGER))
    ) {
      actionError = "请输入有效的倒计时分钟数。";
      publish();
      return;
    }
    pause();
    if (!progress.has(task.id)) {
      const total = remoteSeconds(current);
      progress.set(task.id, { totalMs: total * 1000, savedSeconds: total });
    }
    reconcile(task.id);
    session = {
      taskId: task.id,
      mode,
      duration:
        mode === "countdown" ? Math.max(1, Math.round(minutes * 60)) : 0,
      elapsedMs: 0,
      startedAt: Date.now(),
    };
    actionError = null;
    publish();
  }

  function resume() {
    if (!connected || !session || session.startedAt !== null) return;
    const task = tasks.get(session.taskId);
    if (!task || task.completed) {
      actionError = "任务已完成或暂不可用，计时保持暂停。";
      publish();
      return;
    }
    if (
      session.mode === "countdown" &&
      session.elapsedMs >= session.duration * 1000
    )
      return;
    reconcile(session.taskId);
    session.startedAt = Date.now();
    actionError = null;
    publish();
  }

  return {
    connect,
    update,
    start,
    resume,
    pause,
    stop: () => {
      pause();
      session = null;
      publish();
    },
    clearError: () => {
      actionError = null;
      storageError = null;
      failures.clear();
      listener?.(view());
    },
  };
}

export function useFocusTimer(
  userId: string,
  tasks: Task[],
  saveElapsed: SaveElapsed,
) {
  // A controller survives StrictMode's effect replay, including writes in flight.
  const timer = useMemo(() => createTimer(userId), [userId]);
  const [snapshot, setSnapshot] = useState<TimerView>(() => emptyView(userId));
  useEffect(
    () =>
      timer.connect(tasks, saveElapsed, (next) =>
        setSnapshot((previous) =>
          (Object.keys(next) as (keyof TimerView)[]).every(
            (key) => previous[key] === next[key],
          )
            ? previous
            : next,
        ),
      ),
    [timer],
  );
  useEffect(
    () => timer.update(tasks, saveElapsed),
    [timer, tasks, saveElapsed],
  );
  const { userId: _owner, ...state } =
    snapshot.userId === userId ? snapshot : emptyView(userId);
  return {
    ...state,
    task: tasks.find((t) => t.id === state.taskId && t.user_id === userId),
    start: timer.start,
    pause: timer.pause,
    resume: timer.resume,
    stop: timer.stop,
    clearError: timer.clearError,
  };
}
