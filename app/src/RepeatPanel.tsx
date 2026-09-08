import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { dateFromDay, dayKey, PRIORITY } from "./domain";
import { Modal } from "./Modal";
import type { Priority, ReminderMethod, RepeatRule } from "./types";

type RepeatPanelProps = {
  rules: RepeatRule[];
  onSave: (rule: RepeatRule) => Promise<unknown>;
  onClose: () => void;
};

const RULE_LIMIT = 20;
const WEEKDAYS = [
  { value: 1, label: "周一" },
  { value: 2, label: "周二" },
  { value: 3, label: "周三" },
  { value: 4, label: "周四" },
  { value: 5, label: "周五" },
  { value: 6, label: "周六" },
  { value: 0, label: "周日" },
];

function newRule(): RepeatRule {
  return {
    id: crypto.randomUUID(),
    name: "",
    priority: "medium",
    frequency: "daily",
    weekdays: [],
    startDate: dayKey(),
    reminderTime: "",
    reminderMethod: "dialog",
    enabled: true,
  };
}

function validateRule(rule: RepeatRule): RepeatRule {
  const name = rule.name.trim();
  if (!name || name.length > 500)
    throw new Error("重复任务名称需为 1–500 个字符");
  if (rule.frequency === "weekly" && rule.weekdays.length === 0)
    throw new Error("每周重复请至少选择一天");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(rule.startDate) ||
    dayKey(dateFromDay(rule.startDate)) !== rule.startDate
  ) {
    throw new Error("请选择有效的开始日期");
  }
  if (
    rule.reminderTime &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(rule.reminderTime)
  ) {
    throw new Error("提醒时间需为有效的 HH:mm 格式");
  }
  return {
    ...rule,
    name,
    weekdays: [...new Set(rule.weekdays)].sort((a, b) => a - b),
  };
}

function frequencyLabel(rule: RepeatRule): string {
  if (rule.frequency === "daily") return "每天";
  if (rule.frequency === "weekdays") return "工作日（周一至周五）";
  return `每周 ${WEEKDAYS.filter((day) => rule.weekdays.includes(day.value))
    .map((day) => day.label)
    .join("、")}`;
}

export function RepeatPanel({ rules, onSave, onClose }: RepeatPanelProps) {
  const id = useId();
  const [localRules, setLocalRules] = useState(rules);
  const rulesRef = useRef(rules);
  const [draft, setDraft] = useState<RepeatRule>(newRule);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitLock = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const reminderRef = useRef<HTMLInputElement>(null);

  // Successful local saves are visible immediately; refreshed props remain authoritative.
  // Refreshing the list never replaces the selected draft.
  useEffect(() => {
    rulesRef.current = rules;
    setLocalRules(rules);
  }, [rules]);

  const visibleRules = localRules.filter((rule) => !rule.deleted);
  const atCapacity = visibleRules.length >= RULE_LIMIT;

  function close() {
    if (!submitLock.current) onClose();
  }

  function startNew() {
    if (submitLock.current) return;
    setDraft(newRule());
    setEditingId(null);
    setError(null);
    nameRef.current?.focus();
  }

  function edit(rule: RepeatRule) {
    if (submitLock.current) return;
    setDraft({ ...rule, weekdays: [...rule.weekdays] });
    setEditingId(rule.id);
    setError(null);
    nameRef.current?.focus();
  }

  function patchDraft(patch: Partial<RepeatRule>) {
    if (!submitLock.current) setDraft((current) => ({ ...current, ...patch }));
  }

  async function persist(
    makeRule: () => RepeatRule,
    afterSave: (rule: RepeatRule) => void,
  ) {
    if (submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const rule = makeRule();
      const current = rulesRef.current.find((item) => item.id === rule.id);
      const count = rulesRef.current.filter((item) => !item.deleted).length;
      if (
        !rule.deleted &&
        (!current || current.deleted) &&
        count >= RULE_LIMIT
      ) {
        throw new Error(
          `最多保留 ${RULE_LIMIT} 条规则（包含已暂停规则），请先删除一条规则`,
        );
      }
      await onSave(rule);
      const next = rulesRef.current.some((item) => item.id === rule.id)
        ? rulesRef.current.map((item) => (item.id === rule.id ? rule : item))
        : [...rulesRef.current, rule];
      rulesRef.current = next;
      setLocalRules(next);
      afterSave(rule);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "保存失败，草稿和选择已保留，请重试",
      );
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist(
      () => {
        if (reminderRef.current?.validity.badInput)
          throw new Error("请输入完整、有效的提醒时间");
        const existing = editingId
          ? rulesRef.current.find((rule) => rule.id === editingId)
          : undefined;
        if (editingId && (!existing || existing.deleted))
          throw new Error("此规则已被删除，请新建规则");
        return validateRule({
          ...draft,
          id: existing?.id ?? draft.id,
          startDate: existing?.startDate ?? draft.startDate,
          deleted: false,
        });
      },
      () => {
        setDraft(newRule());
        setEditingId(null);
      },
    );
  }

  function toggle(rule: RepeatRule) {
    void persist(
      () => {
        const next = { ...rule, enabled: !rule.enabled };
        return next.enabled ? validateRule(next) : next;
      },
      (saved) => {
        if (editingId === saved.id)
          setDraft((current) => ({ ...current, enabled: saved.enabled }));
      },
    );
  }

  function remove(rule: RepeatRule) {
    // Persist a tombstone so metadata merge/refresh cannot revive a deleted rule.
    void persist(
      () => ({ ...rule, enabled: false, deleted: true }),
      (saved) => {
        if (editingId === saved.id) {
          setDraft(newRule());
          setEditingId(null);
        }
      },
    );
  }

  return (
    <Modal
      title="重复任务"
      onClose={close}
      busy={busy}
      className="repeat-panel-modal"
    >
      <p className="muted">
        打开或返回网站时生成当天任务；规则随账号同步，不补建过去日期。
      </p>
      <p className="muted">修改、暂停或删除规则不会影响已经生成的任务副本。</p>
      <p className="muted">
        {visibleRules.length} / {RULE_LIMIT}{" "}
        条未删除规则（包含已暂停规则）。删除的规则不占名额。
      </p>
      <ul className="repeat-list" aria-label="重复规则">
        {visibleRules.map((rule) => (
          <li key={rule.id} className="repeat-item">
            <div className="repeat-item-details">
              <strong>{rule.name}</strong>
              <p className="muted">
                {frequencyLabel(rule)} · {PRIORITY[rule.priority]}优先级 ·{" "}
                {rule.enabled ? "已启用" : "已暂停"}
              </p>
              <p className="muted">
                开始日期：{rule.startDate} ·{" "}
                {rule.reminderTime
                  ? `${rule.reminderTime} ${rule.reminderMethod === "sound" ? "声音提醒" : "弹窗提醒"}`
                  : "不提醒"}
              </p>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                aria-label={`编辑规则：${rule.name}`}
                aria-pressed={editingId === rule.id}
                onClick={() => edit(rule)}
              >
                编辑
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                aria-label={`${rule.enabled ? "暂停" : "启用"}规则：${rule.name}`}
                onClick={() => toggle(rule)}
              >
                {rule.enabled ? "暂停" : "启用"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                aria-label={`删除规则：${rule.name}`}
                onClick={() => remove(rule)}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      {visibleRules.length === 0 && (
        <p className="muted">还没有重复规则，可在下方创建。</p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="button secondary"
          disabled={busy || atCapacity}
          onClick={startNew}
        >
          新建规则
        </button>
      </div>
      {atCapacity && (
        <p className="muted">
          已达到 {RULE_LIMIT} 条规则上限，仍可编辑、暂停或删除现有规则。
        </p>
      )}
      <form
        className="repeat-editor"
        onSubmit={submit}
        noValidate
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <h3>{editingId ? "编辑规则" : "新建规则"}</h3>
        <div className="field">
          <label htmlFor={`${id}-name`}>重复任务名称</label>
          <input
            ref={nameRef}
            id={`${id}-name`}
            name="name"
            data-autofocus
            required
            value={draft.name}
            disabled={busy}
            placeholder="例如：每天拉伸 10 分钟"
            onChange={(event) => patchDraft({ name: event.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-priority`}>优先级</label>
          <select
            id={`${id}-priority`}
            name="priority"
            value={draft.priority}
            disabled={busy}
            onChange={(event) =>
              patchDraft({ priority: event.target.value as Priority })
            }
          >
            {(Object.keys(PRIORITY) as Priority[]).map((value) => (
              <option key={value} value={value}>
                {PRIORITY[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-frequency`}>重复频率</label>
          <select
            id={`${id}-frequency`}
            name="frequency"
            value={draft.frequency}
            disabled={busy}
            onChange={(event) =>
              patchDraft({
                frequency: event.target.value as RepeatRule["frequency"],
              })
            }
          >
            <option value="daily">每天</option>
            <option value="weekdays">工作日（周一至周五）</option>
            <option value="weekly">每周指定日期</option>
          </select>
        </div>
        {draft.frequency === "weekly" && (
          <fieldset className="field" disabled={busy}>
            <legend>每周重复日期（至少选择一天）</legend>
            {WEEKDAYS.map((day) => (
              <label key={day.value}>
                <input
                  type="checkbox"
                  name="weekdays"
                  value={day.value}
                  checked={draft.weekdays.includes(day.value)}
                  onChange={(event) =>
                    patchDraft({
                      weekdays: event.target.checked
                        ? [...draft.weekdays, day.value]
                        : draft.weekdays.filter((value) => value !== day.value),
                    })
                  }
                />
                {day.label}
              </label>
            ))}
          </fieldset>
        )}
        <div className="field">
          <label htmlFor={`${id}-start`}>开始日期</label>
          <input
            id={`${id}-start`}
            name="startDate"
            type="date"
            required
            value={draft.startDate}
            disabled={busy}
            readOnly={editingId !== null}
            aria-describedby={`${id}-start-help`}
            onChange={(event) => {
              if (!editingId) patchDraft({ startDate: event.target.value });
            }}
          />
          <p id={`${id}-start-help`} className="muted">
            {editingId
              ? "现有规则的开始日期保持不变。"
              : "按本地日期计算，默认从今天开始。"}
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-time`}>提醒时间（可选）</label>
          <input
            ref={reminderRef}
            id={`${id}-time`}
            name="reminderTime"
            type="time"
            step={60}
            value={draft.reminderTime}
            disabled={busy}
            aria-describedby={`${id}-time-help`}
            onChange={(event) =>
              patchDraft({ reminderTime: event.target.value })
            }
          />
          <p id={`${id}-time-help`} className="muted">
            本地时间，格式为 HH:mm，留空则不提醒。
          </p>
        </div>
        <div className="field">
          <label htmlFor={`${id}-method`}>提醒方式</label>
          <select
            id={`${id}-method`}
            name="reminderMethod"
            value={draft.reminderMethod}
            disabled={busy || !draft.reminderTime}
            onChange={(event) =>
              patchDraft({
                reminderMethod: event.target.value as ReminderMethod,
              })
            }
          >
            <option value="dialog">弹窗提醒</option>
            <option value="sound">声音提醒</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${id}-enabled`}>
            <input
              id={`${id}-enabled`}
              name="enabled"
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) =>
                patchDraft({ enabled: event.target.checked })
              }
            />
            启用规则
          </label>
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
            关闭面板
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || (!editingId && atCapacity)}
          >
            {busy ? "保存中…" : "保存规则"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default RepeatPanel;
