import { useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { dayKey, PRIORITY, validInput } from "./domain";
import { Modal } from "./Modal";
import type { Priority, ReminderMethod, Task, TaskInput } from "./types";

type TaskEditorProps = {
  task: Task | null;
  onSave: (input: TaskInput) => Promise<unknown>;
  onClose: () => void;
};

function localDateTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${dayKey(date)}T${date.toLocaleTimeString("en-GB", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}`;
}

export function TaskEditor(props: TaskEditorProps) {
  // Switching tasks starts a fresh draft; updates to the same task keep user edits.
  return <TaskEditorForm key={props.task?.id ?? "new"} {...props} />;
}

function TaskEditorForm({ task, onSave, onClose }: TaskEditorProps) {
  const id = useId();
  const [name, setName] = useState(task?.name ?? "");
  const [priority, setPriority] = useState<Priority>(
    task?.priority ?? "medium",
  );
  const [originalReminder] = useState(task?.reminder_at ?? null);
  const [reminder, setReminder] = useState(() =>
    localDateTime(originalReminder),
  );
  const [method, setMethod] = useState<ReminderMethod>(
    task?.reminder_method ?? "dialog",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const reminderRef = useRef<HTMLInputElement>(null);

  function close() {
    if (!submitLock.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      if (reminderRef.current?.validity.badInput)
        throw new Error("请输入完整、有效的提醒时间");
      let reminderAt: string | null = null;
      if (reminder) {
        if (originalReminder && reminder === localDateTime(originalReminder)) {
          // Keep the exact saved instant, including seconds, precision and DST offset.
          reminderAt = originalReminder;
        } else {
          const date = new Date(reminder + ":00+08:00");
          if (
            !Number.isFinite(date.getTime()) ||
            localDateTime(date.toISOString()) !== reminder
          ) {
            throw new Error("提醒时间无效，请选择有效的本地日期和时间");
          }
          if (date.getTime() <= Date.now())
            throw new Error("新增或修改的提醒时间必须晚于现在");
          reminderAt = date.toISOString();
        }
      }
      const input = validInput({
        name,
        priority,
        reminder_at: reminderAt,
        reminder_method: reminderAt ? method : null,
      });
      await onSave(input);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "保存失败，内容已保留，请重试",
      );
      return;
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
    onClose();
  }

  return (
    <Modal
      title={task ? "编辑任务" : "新建任务"}
      onClose={close}
      busy={busy}
      className="task-editor-modal"
    >
      <form
        className="task-editor"
        onSubmit={submit}
        noValidate
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <div className="field">
          <label htmlFor={`${id}-name`}>任务名称</label>
          <input
            id={`${id}-name`}
            name="name"
            data-autofocus
            value={name}
            required
            disabled={busy}
            placeholder="例如：读书 20 分钟"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-priority`}>优先级</label>
          <select
            id={`${id}-priority`}
            name="priority"
            value={priority}
            disabled={busy}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {(Object.keys(PRIORITY) as Priority[]).map((value) => (
              <option key={value} value={value}>
                {PRIORITY[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-reminder`}>提醒时间（可选）</label>
          <input
            ref={reminderRef}
            id={`${id}-reminder`}
            name="reminder_at"
            type="datetime-local"
            step={60}
            value={reminder}
            disabled={busy}
            aria-describedby={`${id}-reminder-help`}
            onChange={(event) => setReminder(event.target.value)}
          />
          <p id={`${id}-reminder-help`} className="muted">
            使用北京时间，留空则不提醒。新增或修改时间需晚于现在，原有过期时间可保持不变。
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-method`}>提醒方式</label>
          <select
            id={`${id}-method`}
            name="reminder_method"
            value={method}
            disabled={busy || !reminder}
            onChange={(event) =>
              setMethod(event.target.value as ReminderMethod)
            }
          >
            <option value="dialog">弹窗提醒</option>
            <option value="sound">声音提醒</option>
          </select>
        </div>
        {error && (
          <div id={`${id}-error`} className="error-box" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? "保存中…" : "保存任务"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default TaskEditor;
