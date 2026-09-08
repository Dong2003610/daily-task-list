export type Priority = "high" | "medium" | "low";
export type ReminderMethod = "sound" | "dialog";
export interface Task {
  id: string;
  user_id: string;
  name: string;
  priority: Priority;
  completed: boolean;
  reminder_at: string | null;
  reminder_method: ReminderMethod | null;
  elapsed_seconds: number;
  completed_at: string | null;
  created_at: string;
  updated_at?: string;
}
export interface TaskInput {
  name: string;
  priority: Priority;
  reminder_at: string | null;
  reminder_method: ReminderMethod | null;
}
export interface RepeatRule {
  id: string;
  name: string;
  priority: Priority;
  frequency: "daily" | "weekdays" | "weekly";
  weekdays: number[];
  startDate: string;
  reminderTime: string;
  reminderMethod: ReminderMethod;
  enabled: boolean;
  deleted?: boolean;
}
export type Metadata = Record<string, unknown>;
export interface PendingDelete {
  task: Task;
  deadline: number;
  status?: "committing" | "failed";
  error?: string;
}
export type TimerMode = "countup" | "countdown";
