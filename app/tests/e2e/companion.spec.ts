import { test, expect, openApp, card } from './fixtures';
import { NOW } from '../factories';

test('desktop focus blocks a web start; pause releases and reload recovers paused with bounded expiry', async ({ page, backend }) => {
  backend.metadata.dtl_focus_v1 = { client: 'desktop-fixture', owner: 'desktop', phase: 'running', expiresAt: Date.parse(NOW) + 90000 };
  await openApp(page);
  const start = card(page, '今日 Alpha 计划').getByRole('button', { name: '计时：今日 Alpha 计划', exact: true });
  await start.click();
  await expect(page.getByRole('alert')).toContainText('桌宠正在专注');
  await expect(page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
  backend.metadata.dtl_focus_v1 = null;
  await start.click();
  await expect(page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await expect.poll(() => (backend.metadata.dtl_focus_v1 as { owner?: string })?.owner).toBe('web');
  await page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => backend.metadata.dtl_focus_v1).toBeNull();
  await page.locator('.timer-panel').getByRole('button', { name: '继续', exact: true }).click();
  await expect.poll(() => (backend.metadata.dtl_focus_v1 as { owner?: string })?.owner).toBe('web');
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(page.locator('.timer-panel').getByRole('button', { name: '继续', exact: true })).toBeVisible();
  await expect(page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
  // A page unload may abort the best-effort release request. A new document
  // must still recover after the bounded lease, without counting reload time.
  await page.clock.setFixedTime(new Date(Date.parse(NOW) + 91000));
  await page.locator('.timer-panel').getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.locator('.timer-panel').getByRole('button', { name: '停止', exact: true }).click();
  await expect.poll(() => backend.metadata.dtl_focus_v1).toBeNull();
});

test('finishing a countdown releases ownership and stores elapsed task time', async ({ page, backend }) => {
  await page.clock.install({ time: new Date(NOW) }); await page.clock.pauseAt(new Date(NOW));
  await openApp(page, { keepClock: true });
  await page.getByRole('button', { name: '展开或收起计时器' }).click();
  await page.getByRole('combobox', { name: '计时方式', exact: true }).selectOption('countdown');
  await page.getByRole('spinbutton', { name: '倒计时分钟', exact: true }).fill('1');
  await card(page, '今日 Alpha 计划').getByRole('button', { name: '计时：今日 Alpha 计划', exact: true }).click();
  await expect(page.locator('.timer-panel').getByRole('button', { name: '暂停', exact: true })).toBeVisible();
  await page.clock.runFor(61000);
  await expect(page.locator('.timer-panel').getByRole('button', { name: '重新开始', exact: true })).toBeVisible();
  await expect.poll(() => backend.metadata.dtl_focus_v1).toBeNull();
  await expect.poll(() => backend.tasks.find((task) => task.name === '今日 Alpha 计划')?.elapsed_seconds).toBe(60);
});

test('desktop reminder ownership suppresses web delivery and can be switched back', async ({ page, backend }) => {
  backend.metadata.dtl_reminder_owner_v1 = 'desktop';
  await openApp(page);
  await expect(page.getByText('任务提醒由桌宠接收，请保持桌宠运行。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '改由网页提醒', exact: true }).click();
  await expect.poll(() => backend.metadata.dtl_reminder_owner_v1).toBe('web');
  await expect(page.getByRole('button', { name: '改由网页提醒', exact: true })).toHaveCount(0);
});

test('a newly due reminder rechecks the receiver without waiting for the idle metadata refresh', async ({ page, backend }) => {
  backend.tasks[0].reminder_at = new Date(Date.parse(NOW) + 30000).toISOString();
  backend.tasks[0].reminder_method = 'dialog';
  await page.clock.install({ time: new Date(NOW) });
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, { keepClock: true });
  backend.metadata.dtl_reminder_owner_v1 = 'desktop';
  await page.clock.runFor(31000);
  await expect(page.getByRole('button', { name: '改由网页提醒', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '任务提醒', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '改由网页提醒', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '任务提醒', exact: true })).toContainText('今日 Alpha 计划');
});
