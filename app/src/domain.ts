import { v5 as uuidv5 } from "uuid";
import type { Task, RepeatRule, Metadata, TaskInput } from "./types";
const NS = "7263a95c-7f4b-5f74-8c54-b8fd2d253a65";
export const PRIORITY = { high: "高", medium: "中", low: "低" } as const;
export const RULE_PREFIX = "dtl_rule_v2_";
export const SKIP_PREFIX = "dtl_skip_v2_";
export const CARRY_PROMPT = "dtl_carry_prompt_v2";
export const CARRY_CANCEL = "dtl_carry_cancel_v2_";
export const TIMEZONE = "Asia/Shanghai";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function dayKey(value: Date | string = new Date()): string {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return "";
  const parts = dayFormatter.formatToParts(d);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function dateFromDay(day: string): Date {
  return new Date(`${day}T12:00:00+08:00`);
}
export function yesterday(day = dayKey()): string {
  const d = dateFromDay(day);
  d.setUTCDate(d.getUTCDate() - 1);
  return dayKey(d);
}
export function dayLabel(day: string, today = dayKey()): string {
  return day === today ? "今天" : day === yesterday(today) ? "昨天" : day;
}
export function carryId(sourceId: string, day: string): string {
  return uuidv5(`carry:${sourceId}:${day}`, NS);
}
export function repeatId(ruleId: string, day: string): string {
  return uuidv5(`repeat:${ruleId}:${day}`, NS);
}
export function cancelledSources(metadata: Metadata): Set<string> {
  return new Set(
    Object.keys(metadata)
      .filter((k) => k.startsWith(CARRY_CANCEL) && Boolean(metadata[k]))
      .map((k) => k.slice(CARRY_CANCEL.length)),
  );
}
export function cancelledTaskIds(metadata: Metadata): Set<string> {
  const ids = new Set<string>();
  for (const [key, value] of Object.entries(metadata)) {
    if (key.startsWith(CARRY_CANCEL) && typeof value === "string")
      ids.add(value);
    if (
      key.startsWith(SKIP_PREFIX) &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value)
    )
      ids.add(repeatId(key.slice(SKIP_PREFIX.length), value));
  }
  return ids;
}
export function sortTasks(tasks: Task[]): Task[] {
  const rank = { high: 3, medium: 2, low: 1 };
  return [...tasks].sort(
    (a, b) =>
      Number(a.completed) - Number(b.completed) ||
      (a.completed
        ? Date.parse(b.completed_at || b.created_at) -
          Date.parse(a.completed_at || a.created_at)
        : rank[b.priority] - rank[a.priority] ||
          Date.parse(a.created_at) - Date.parse(b.created_at)),
  );
}
// Infer links from deterministic IDs, without altering legacy rows or task names.
export function carryCandidates(
  tasks: Task[],
  today = dayKey(),
  cancelled: ReadonlySet<string> = new Set(),
): Task[] {
  const ids = new Set(tasks.map((t) => t.id));
  const days = [...new Set(tasks.map((t) => dayKey(t.created_at)))];
  return sortTasks(
    tasks.filter((t) => {
      const sourceDay = dayKey(t.created_at);
      return (
        !t.completed &&
        !cancelled.has(t.id) &&
        sourceDay < today &&
        !days.some((d) => d > sourceDay && ids.has(carryId(t.id, d)))
      );
    }),
  );
}
export function carryRow(task: Task, userId: string, now = new Date()): Task {
  const future =
    task.reminder_at && Date.parse(task.reminder_at) > now.getTime();
  return {
    id: carryId(task.id, dayKey(now)),
    user_id: userId,
    name: task.name,
    priority: task.priority,
    completed: false,
    elapsed_seconds: 0,
    completed_at: null,
    created_at: now.toISOString(),
    reminder_at: future ? task.reminder_at : null,
    reminder_method: future ? task.reminder_method : null,
  };
}
export function isRule(value: unknown): value is RepeatRule {
  if (!value || typeof value !== "object") return false;
  const r = value as RepeatRule;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    r.name.trim().length > 0 &&
    r.name.length <= 500 &&
    ["high", "medium", "low"].includes(r.priority) &&
    ["daily", "weekdays", "weekly"].includes(r.frequency) &&
    Array.isArray(r.weekdays) &&
    r.weekdays.every((n) => Number.isInteger(n) && n >= 0 && n <= 6) &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) &&
    typeof r.enabled === "boolean" &&
    typeof r.reminderTime === "string" &&
    (!r.reminderTime || /^([01]\d|2[0-3]):[0-5]\d$/.test(r.reminderTime)) &&
    ["sound", "dialog"].includes(r.reminderMethod)
  );
}
export function rulesFromMetadata(metadata: Metadata): RepeatRule[] {
  return Object.entries(metadata)
    .filter(([k, v]) => k.startsWith(RULE_PREFIX) && isRule(v))
    .map(([, v]) => v as RepeatRule);
}
export function isRuleDue(rule: RepeatRule, day = dayKey()): boolean {
  if (!rule.enabled || rule.deleted || day < rule.startDate) return false;
  const weekday = dateFromDay(day).getUTCDay();
  return (
    rule.frequency === "daily" ||
    (rule.frequency === "weekdays"
      ? weekday >= 1 && weekday <= 5
      : rule.weekdays.includes(weekday))
  );
}
export function repeatRow(
  rule: RepeatRule,
  userId: string,
  now = new Date(),
): Task {
  const day = dayKey(now);
  const at = rule.reminderTime
    ? new Date(`${day}T${rule.reminderTime}:00+08:00`).toISOString()
    : null;
  return {
    id: repeatId(rule.id, day),
    user_id: userId,
    name: rule.name,
    priority: rule.priority,
    completed: false,
    elapsed_seconds: 0,
    completed_at: null,
    created_at: now.toISOString(),
    reminder_at: at,
    reminder_method: at ? rule.reminderMethod : null,
  };
}
export function ruleForTask(
  task: Task,
  rules: RepeatRule[],
): RepeatRule | undefined {
  return rules.find((r) => repeatId(r.id, dayKey(task.created_at)) === task.id);
}
export function validInput(input: TaskInput): TaskInput {
  const name = input.name.trim();
  if (!name || name.length > 500) throw new Error("任务名称需为 1–500 个字符");
  if (!["high", "medium", "low"].includes(input.priority))
    throw new Error("请选择任务优先级");
  if (input.reminder_at && !Number.isFinite(Date.parse(input.reminder_at)))
    throw new Error("提醒时间无效");
  return {
    ...input,
    name,
    reminder_method: input.reminder_at
      ? input.reminder_method || "dialog"
      : null,
  };
}
export function formatDuration(value: number): string {
  const n = Math.max(0, Math.floor(value));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}
export function reminderKey(task: Task): string {
  return `${task.id}:${task.reminder_at}`;
}
export function dueReminders(
  tasks: Task[],
  seen: ReadonlySet<string>,
  now = Date.now(),
): Task[] {
  return tasks
    .filter(
      (t) =>
        !t.completed &&
        t.reminder_at &&
        Date.parse(t.reminder_at) <= now &&
        !seen.has(reminderKey(t)),
    )
    .sort((a, b) => Date.parse(a.reminder_at!) - Date.parse(b.reminder_at!));
}
function safeCsv(value: unknown): string {
  let s = String(value ?? "");
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
export function exportCsv(tasks: Task[]): string {
  const rows = [
    [
      "任务名称",
      "优先级",
      "完成状态",
      "创建日期",
      "提醒时间",
      "已用秒数",
      "完成时间",
      "任务ID",
    ],
    ...tasks.map((t) => [
      t.name,
      PRIORITY[t.priority],
      t.completed ? "已完成" : "未完成",
      dayKey(t.created_at),
      t.reminder_at || "",
      t.elapsed_seconds,
      t.completed_at || "",
      t.id,
    ]),
  ];
  return "\ufeff" + rows.map((r) => r.map(safeCsv).join(",")).join("\r\n");
}
