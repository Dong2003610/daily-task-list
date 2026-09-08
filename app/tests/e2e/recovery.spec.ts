import type {Task} from '../../src/types';
import {NOW} from '../factories';
import {card, expect, openApp, test} from './fixtures';

test('quick add retries a lost successful response with the same normalized draft ID across reload', async ({page, backend}) => {
  const name = '已保存但响应丢失的任务';
  await openApp(page);
  backend.loseNextTaskInsertResponse = true;
  const input = page.getByRole('textbox', {name: '快速添加任务'});
  await input.fill(`  ${name}  `);
  await page.getByRole('combobox', {name: '快速任务优先级'}).selectOption('high');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue(`  ${name}  `);
  await expect(input).toBeEnabled();
  const persisted = structuredClone(backend.tasks.find(t => t.name === name));
  expect(persisted).toMatchObject({name, priority: 'high'});
  expect(backend.tasks.filter(t => t.name === name)).toHaveLength(1);

  // Re-enter the normalized draft after reload: its recovery ID must survive.
  await page.reload();
  await expect(card(page, name)).toBeVisible();
  await input.fill(name);
  await page.getByRole('combobox', {name: '快速任务优先级'}).selectOption('high');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(card(page, name)).toHaveCount(1);
  expect(backend.tasks.filter(t => t.name === name)).toEqual([persisted]);
  const firstAttempts = backend.taskRequests('POST').map(request => (request.body as Task[])[0].id);
  expect(firstAttempts).toEqual([persisted!.id, persisted!.id]);

  // Once success is acknowledged, the same text is a legitimate new task.
  await input.fill(name);
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(card(page, name)).toHaveCount(2);
  expect(new Set(backend.tasks.filter(t => t.name === name).map(t => t.id)).size).toBe(2);
});

test('failed deletion remains pending across reload and succeeds only after explicit retry', async ({page, backend}) => {
  const original = structuredClone(backend.tasks[0]);
  await page.clock.install({time: new Date(NOW)});
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  backend.failNext('DELETE', '/rest/v1/tasks', 'mock delete failure');
  await card(page, original.name).getByRole('button', {name: `删除：${original.name}`, exact: true}).click();
  await page.clock.runFor(8_500);
  const retry = page.getByRole('button', {name: '重试删除', exact: true});
  await expect(retry).toBeVisible();
  await expect(page.locator('.undo-toast')).toContainText('删除尚未完成，记录已保留');
  expect(backend.taskRequests('DELETE')).toHaveLength(1);
  expect(backend.tasks.find(t => t.id === original.id)).toEqual(original);
  await expect(card(page, original.name)).toHaveCount(0);
  await page.reload();
  await expect(retry).toBeVisible();
  await page.clock.runFor(1_500);
  expect(backend.taskRequests('DELETE')).toHaveLength(1);
  expect(backend.tasks.find(t => t.id === original.id)).toEqual(original);
  await retry.click();
  await page.clock.runFor(1_000);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(2);
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  expect(backend.tasks.some(t => t.id === original.id)).toBe(false);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, original.name)).toHaveCount(0);
});

test('a lost successful DELETE response is reconciled by a fresh read without a false pending failure', async ({page, backend}) => {
  const original = structuredClone(backend.tasks[0]);
  await page.clock.install({time: new Date(NOW)});
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  backend.loseNextTaskDeleteResponse = true;
  await card(page, original.name).getByRole('button', {name: `删除：${original.name}`, exact: true}).click();
  await page.clock.runFor(8_500);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(1);
  await expect(page.locator('.undo-toast')).toHaveCount(0);
  await expect(page.getByRole('button', {name: '重试删除', exact: true})).toHaveCount(0);
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  const deleteIndex = backend.requests.findIndex(request => request.method === 'DELETE');
  expect(backend.requests.slice(deleteIndex + 1).some(request => request.method === 'GET' && request.path.endsWith('/rest/v1/tasks'))).toBe(true);
  expect(backend.tasks.some(t => t.id === original.id)).toBe(false);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, original.name)).toHaveCount(0);
  expect(backend.taskRequests('DELETE')).toHaveLength(1);
});
