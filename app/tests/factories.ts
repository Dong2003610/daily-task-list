import type {RepeatRule, Task} from '../src/types';

export const USER_ID = '00000000-0000-4000-8000-000000000001';
export const TODAY = '2026-09-08';
export const NOW = '2026-09-08T10:00:00+08:00';

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: '00000000-0000-4000-8000-000000000101', user_id: USER_ID,
    name: '今日计划', priority: 'medium', completed: false,
    reminder_at: null, reminder_method: null, elapsed_seconds: 0,
    completed_at: null, created_at: '2026-09-08T01:00:00.000Z',
    ...overrides,
  };
}

export function rule(overrides: Partial<RepeatRule> = {}): RepeatRule {
  return {
    id: '00000000-0000-4000-8000-000000000201', name: '每天复盘',
    priority: 'medium', frequency: 'daily', weekdays: [],
    startDate: '2026-09-01', reminderTime: '', reminderMethod: 'dialog',
    enabled: true, ...overrides,
  };
}

export function seedTasks(): Task[] {
  return [
    task({name: '今日 Alpha 计划'}),
    task({id: '00000000-0000-4000-8000-000000000102', name: '今日已完成', completed: true, completed_at: '2026-09-08T01:30:00.000Z'}),
    task({id: '00000000-0000-4000-8000-000000000103', name: '昨天 Alpha 计划', priority: 'high', elapsed_seconds: 3671, created_at: '2026-09-07T01:00:00.000Z'}),
    task({id: '00000000-0000-4000-8000-000000000104', name: '更早 Alpha 计划', priority: 'low', elapsed_seconds: 125, created_at: '2026-08-31T01:00:00.000Z'}),
  ];
}
