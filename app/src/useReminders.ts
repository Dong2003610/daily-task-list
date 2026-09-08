import { useEffect, useMemo, useState } from "react";
import { dueReminders, reminderKey } from "./domain";
import type { Task } from "./types";

interface ReminderView {
  userId: string;
  pending: Task[];
}

function isStoredReminder(value: unknown, userId: string): value is Task {
  if (!value || typeof value !== "object") return false;
  const t = value as Task;
  return (
    typeof t.id === "string" &&
    t.user_id === userId &&
    typeof t.name === "string" &&
    ["high", "medium", "low"].includes(t.priority) &&
    typeof t.completed === "boolean" &&
    typeof t.reminder_at === "string" &&
    Number.isFinite(Date.parse(t.reminder_at)) &&
    (t.reminder_method === null ||
      t.reminder_method === "dialog" ||
      t.reminder_method === "sound") &&
    typeof t.elapsed_seconds === "number" &&
    Number.isFinite(t.elapsed_seconds) &&
    typeof t.created_at === "string" &&
    (t.completed_at === null || typeof t.completed_at === "string")
  );
}

function createReminders(userId: string) {
  const storageKey = `dtl_reminders_v1:${encodeURIComponent(userId)}`;
  const dismissed = new Set<string>();
  const sounded = new Set<string>();
  const queue = new Map<string, Task>();
  let tasks: Task[] = [];
  let listener: ((view: ReminderView) => void) | null = null;
  let context: AudioContext | null = null;
  let unlocking: Promise<void> | null = null;
  let connected = false;

  function readStorage() {
    if (!userId) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.version !== 1) return;
      for (const key of Array.isArray(data.dismissed) ? data.dismissed : []) {
        if (typeof key === "string") dismissed.add(key);
      }
      for (const key of Array.isArray(data.sounded) ? data.sounded : []) {
        if (typeof key === "string") sounded.add(key);
      }
      for (const task of Array.isArray(data.pending) ? data.pending : []) {
        if (isStoredReminder(task, userId) && !queue.has(reminderKey(task)))
          queue.set(reminderKey(task), task);
      }
      for (const key of dismissed) {
        queue.delete(key);
        sounded.delete(key);
      }
    } catch {
      // Storage can be unavailable in private/restricted contexts; keep the full
      // in-memory queue usable. No occurrence is dismissed because storage failed.
    }
  }

  function persist() {
    if (!userId) return;
    try {
      const data = JSON.stringify({
        version: 1,
        dismissed: [...dismissed],
        sounded: [...sounded],
        pending: [...queue.values()],
      });
      if (window.localStorage.getItem(storageKey) !== data)
        window.localStorage.setItem(storageKey, data);
    } catch {
      /* The in-memory queue remains available for explicit dismissal. */
    }
  }

  function publish() {
    if (!connected) return;
    persist();
    listener?.({
      userId,
      pending: [...queue.values()].sort(
        (a, b) =>
          Date.parse(a.reminder_at!) - Date.parse(b.reminder_at!) ||
          reminderKey(a).localeCompare(reminderKey(b)),
      ),
    });
  }

  function tone(): boolean {
    if (!context || context.state !== "running") return false;
    try {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(now);
      oscillator.stop(now + 0.5);
      return true;
    } catch {
      return false;
    }
  }

  function announce() {
    const waiting = [...queue].filter(
      ([key, task]) => task.reminder_method === "sound" && !sounded.has(key),
    );
    // One chime can announce a batch; every occurrence remains in the visible queue.
    if (waiting.length && tone()) {
      for (const [key] of waiting) sounded.add(key);
      publish();
    }
  }

  function unlock(explicit = false) {
    if (!connected) return;
    try {
      if (!context || context.state === "closed") {
        const Audio =
          window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Audio) return;
        context = new Audio();
      }
      const audio = context;
      const ready = () => {
        if (!connected || context !== audio || audio.state !== "running")
          return;
        readStorage();
        if (explicit) {
          if (tone()) {
            for (const [key, task] of queue)
              if (task.reminder_method === "sound") sounded.add(key);
            publish();
          }
        } else announce();
      };
      if (audio.state === "running") ready();
      else if (!unlocking) {
        // resume() is invoked synchronously inside the gesture, with rejection
        // handled. Automatic polling never creates/resumes an AudioContext.
        const request = audio.resume();
        unlocking = request;
        void request
          .then(ready, () => {})
          .finally(() => {
            if (unlocking === request) unlocking = null;
          })
          .catch(() => {});
      }
    } catch {
      /* Sound is optional; browser policy must not block reminders. */
    }
  }

  function scan() {
    if (!connected || !userId) return;
    readStorage();
    const ownTasks = tasks.filter((t) => t.user_id === userId);
    // Preserve a queued occurrence's original timestamp if a task is rescheduled.
    // Completion/deletion prevents new reminders but does not dismiss an existing one.
    for (const task of ownTasks) {
      const key = reminderKey(task);
      if (queue.has(key)) queue.set(key, { ...task });
    }
    const seen = new Set([...dismissed, ...queue.keys()]);
    for (const task of dueReminders(ownTasks, seen))
      queue.set(reminderKey(task), { ...task });
    publish();
    announce();
  }

  function connect(nextTasks: Task[], onChange: (view: ReminderView) => void) {
    connected = true;
    listener = onChange;
    tasks = nextTasks;
    scan();
    const visibility = () => {
      if (document.visibilityState === "visible") scan();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === storageKey) scan();
    };
    const gesture = () => unlock();
    const interval = window.setInterval(scan, 30_000);
    window.addEventListener("focus", scan);
    window.addEventListener("pageshow", scan);
    window.addEventListener("load", scan);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("pointerdown", gesture);
    document.addEventListener("pointerup", gesture);
    document.addEventListener("keydown", gesture);
    return () => {
      connected = false;
      listener = null;
      window.clearInterval(interval);
      window.removeEventListener("focus", scan);
      window.removeEventListener("pageshow", scan);
      window.removeEventListener("load", scan);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
      document.removeEventListener("pointerdown", gesture);
      document.removeEventListener("pointerup", gesture);
      document.removeEventListener("keydown", gesture);
      const audio = context;
      context = null;
      unlocking = null;
      if (audio && audio.state !== "closed") {
        try {
          void audio.close().catch(() => {});
        } catch {
          /* Already closed. */
        }
      }
    };
  }

  return {
    connect,
    update: (nextTasks: Task[]) => {
      tasks = nextTasks;
      scan();
    },
    dismiss: (task: Task) => {
      if (!connected || !userId || task.user_id !== userId || !task.reminder_at)
        return;
      readStorage();
      const key = reminderKey(task);
      dismissed.add(key);
      queue.delete(key);
      sounded.delete(key);
      publish();
    },
    playSound: () => unlock(true),
  };
}

export function useReminders(userId: string, tasks: Task[]) {
  const reminders = useMemo(() => createReminders(userId), [userId]);
  const [snapshot, setSnapshot] = useState<ReminderView>(() => ({
    userId,
    pending: [],
  }));
  useEffect(
    () =>
      reminders.connect(tasks, (next) =>
        setSnapshot((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        ),
      ),
    [reminders],
  );
  useEffect(() => reminders.update(tasks), [reminders, tasks]);
  return {
    pending: snapshot.userId === userId ? snapshot.pending : [],
    dismiss: reminders.dismiss,
    playSound: reminders.playSound,
  };
}
