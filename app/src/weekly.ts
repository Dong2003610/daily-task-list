import { v5 as uuidv5 } from "uuid";
import { dateFromDay, dayKey } from "./domain";
import type { Task, WeeklyTask, WeeklyTaskInput } from "./types";

export function shiftDay(day: string, days: number): string {
  const date = dateFromDay(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dayKey(date);
}

export function weekStart(day = dayKey()): string {
  const weekday = dateFromDay(day).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

export function weekRange(start: string): string {
  const label = (day: string) => `${Number(day.slice(5, 7))}月${Number(day.slice(8))}日`;
  const end = shiftDay(start, 6);
  const year = start.slice(0, 4) === end.slice(0, 4) ? `${start.slice(0, 4)}年 · ` : "";
  return year + (year ? `${label(start)} – ${label(end)}` : `${start} – ${end}`);
}

export function validWeeklyInput(input: WeeklyTaskInput): WeeklyTaskInput {
  const name = input.name.trim();
  if (!name || name.length > 500) throw new Error("周任务名称需为 1–500 个字符");
  if (!["high", "medium", "low"].includes(input.priority)) throw new Error("请选择优先级");
  return { name, priority: input.priority };
}

export function sortWeeklyTasks(tasks: WeeklyTask[]): WeeklyTask[] {
  const priority = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed)
    || priority[a.priority] - priority[b.priority]
    || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

export function weeklyDailyId(id: string, day: string): string {
  return uuidv5(`weekly-daily:${id}:${day}`, "7263a95c-7f4b-5f74-8c54-b8fd2d253a65");
}

export function weeklyDailyRow(task: WeeklyTask, userId: string, now = new Date()): Task {
  return {
    id: weeklyDailyId(task.id, dayKey(now)), user_id: userId,
    name: task.name, priority: task.priority, completed: false,
    completed_at: null, elapsed_seconds: 0, created_at: now.toISOString(),
    reminder_at: null, reminder_method: null, sort_order: null,
  };
}
