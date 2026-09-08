import {repeatId, RULE_PREFIX} from '../../src/domain';
import {rule, task, TODAY} from '../factories';
import {card, expect, openApp, test} from './fixtures';

const devices = [
  {zone: 'UTC', now: '2026-09-08T00:30:00+08:00', deviceDay: '2026-09-07'},
  {zone: 'America/Los_Angeles', now: '2026-09-08T00:30:00+08:00', deviceDay: '2026-09-07'},
  {zone: 'Pacific/Kiritimati', now: '2026-09-08T23:30:00+08:00', deviceDay: '2026-09-09'},
];

for (const device of devices) {
  test.describe(`device timezone ${device.zone}`, () => {
    test.use({timezoneId: device.zone});

    test('today, Tuesday recurrence and form reminders retain the Shanghai calendar', async ({page, backend}) => {
      const recurrence = rule({frequency: 'weekly', weekdays: [2], reminderTime: '23:59'});
      const preciseReminder = '2026-09-10T06:35:27.123Z';
      backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
      backend.tasks = [
        task({name: '上海零点后的任务', created_at: '2026-09-07T16:01:00Z', reminder_at: preciseReminder, reminder_method: 'dialog'}),
        task({id: 'late-shanghai-task', name: '上海午夜前的任务', created_at: '2026-09-08T15:59:00Z'}),
        task({id: 'previous-shanghai-day', name: '上海昨天的任务', created_at: '2026-09-07T15:59:00Z'}),
      ];
      await page.clock.setFixedTime(new Date(device.now));
      await openApp(page, {keepClock: true});
      const browserCalendar = await page.evaluate(() => ({
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        day: new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date()),
      }));
      expect(browserCalendar).toEqual({zone: device.zone, day: device.deviceDay});
      expect(browserCalendar.day).not.toBe(TODAY);
      await expect(card(page, '上海零点后的任务')).toBeVisible();
      await expect(card(page, '上海午夜前的任务')).toBeVisible();
      await expect(card(page, '上海昨天的任务')).toHaveCount(0);
      await expect(card(page, recurrence.name)).toBeVisible();
      expect(backend.tasks.filter(t => t.name === recurrence.name)).toEqual([expect.objectContaining({
        id: repeatId(recurrence.id, TODAY), reminder_at: '2026-09-08T15:59:00.000Z',
      })]);

      // Editing only the name preserves the original sub-minute timestamp.
      await card(page, '上海零点后的任务').getByRole('button', {name: '编辑：上海零点后的任务', exact: true}).click();
      const editor = page.getByRole('dialog', {name: '编辑任务', exact: true});
      await expect(editor.getByLabel('提醒时间（可选）', {exact: true})).toHaveValue('2026-09-10T14:35');
      await editor.getByRole('textbox', {name: '任务名称', exact: true}).fill('跨时区编辑保留精度');
      await editor.getByRole('button', {name: '保存任务', exact: true}).click();
      await expect(editor).toHaveCount(0);
      expect(backend.tasks.find(t => t.name === '跨时区编辑保留精度')?.reminder_at).toBe(preciseReminder);

      // A newly entered wall time is also interpreted as Shanghai (+08).
      await page.getByRole('button', {name: '详细添加'}).click();
      const create = page.getByRole('dialog', {name: '新建任务', exact: true});
      await create.getByRole('textbox', {name: '任务名称', exact: true}).fill('跨时区新提醒');
      await create.getByLabel('提醒时间（可选）', {exact: true}).fill('2026-09-09T14:35');
      await create.getByRole('button', {name: '保存任务', exact: true}).click();
      await expect(create).toHaveCount(0);
      await expect(card(page, '跨时区新提醒')).toBeVisible();
      expect(backend.tasks.find(t => t.name === '跨时区新提醒')?.reminder_at).toBe('2026-09-09T06:35:00.000Z');

      await page.reload();
      await expect(card(page, '跨时区新提醒')).toBeVisible();
      await expect(page.locator('.sync-status')).toHaveText('已同步');
      expect(backend.tasks.filter(t => t.name === recurrence.name)).toHaveLength(1);
      await page.getByRole('tab', {name: '历史任务', exact: true}).click();
      await page.getByLabel('历史日期', {exact: true}).fill('2026-09-07');
      await expect(page.getByTestId('task-card')).toHaveCount(1);
      await expect(card(page, '上海昨天的任务')).toBeVisible();
    });
  });
}
