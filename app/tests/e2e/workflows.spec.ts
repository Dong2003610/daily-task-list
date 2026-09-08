import {readFile} from 'node:fs/promises';
import {carryId, repeatId, RULE_PREFIX} from '../../src/domain';
import {NOW, rule, seedTasks, task, TODAY} from '../factories';
import {card, expect, FAKE_ACCESS_TOKEN, openApp, test} from './fixtures';

test('quick add trims a task, persists priority and survives reload', async ({page, backend}, testInfo) => {
  await openApp(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', {name: '快速添加任务'}).fill('  新的高优先级任务  ');
  await page.getByRole('combobox', {name: '快速任务优先级'}).selectOption('high');
  await page.getByRole('textbox', {name: '快速添加任务'}).press('Enter');
  await expect(card(page, '新的高优先级任务')).toBeVisible();
  await expect(page.getByRole('textbox', {name: '快速添加任务'})).toHaveValue('');
  const saved = backend.tasks.find(t => t.name === '新的高优先级任务');
  expect(saved).toMatchObject({priority: 'high', completed: false, elapsed_seconds: 0, reminder_at: null});
  expect(backend.taskRequests('POST')).toHaveLength(1);
  await page.reload();
  await expect(card(page, '新的高优先级任务')).toBeVisible();
  expect(backend.tasks.filter(t => t.id === saved!.id)).toHaveLength(1);
  await page.screenshot({path: testInfo.outputPath('desktop.png'), fullPage: true});
});

test('failed form save retains the full draft and retry writes it once', async ({page, backend}) => {
  await openApp(page);
  await page.getByRole('button', {name: '详细添加'}).click();
  const dialog = page.getByRole('dialog', {name: '新建任务'});
  await dialog.getByRole('textbox', {name: '任务名称', exact: true}).fill('保留失败草稿');
  await dialog.getByLabel('优先级', {exact: true}).selectOption('low');
  await dialog.getByLabel('提醒时间（可选）', {exact: true}).fill('2026-09-09T14:35');
  await dialog.getByLabel('提醒方式', {exact: true}).selectOption('sound');
  backend.failNext('POST', '/rest/v1/tasks');
  await dialog.getByRole('button', {name: '保存任务', exact: true}).click();
  await expect(dialog.getByRole('alert')).toContainText('测试保存失败');
  await expect(dialog.getByRole('textbox', {name: '任务名称', exact: true})).toHaveValue('保留失败草稿');
  await expect(dialog.getByLabel('优先级', {exact: true})).toHaveValue('low');
  await expect(dialog.getByLabel('提醒时间（可选）', {exact: true})).toHaveValue('2026-09-09T14:35');
  await expect(dialog.getByLabel('提醒方式', {exact: true})).toHaveValue('sound');
  expect(backend.tasks.some(t => t.name === '保留失败草稿')).toBe(false);
  await dialog.getByRole('button', {name: '保存任务', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(card(page, '保留失败草稿')).toBeVisible();
  expect(backend.tasks.filter(t => t.name === '保留失败草稿')).toEqual([expect.objectContaining({priority: 'low', reminder_at: '2026-09-09T06:35:00.000Z', reminder_method: 'sound'})]);
});

test('selected carry preserves history, resets elapsed, and a stale tab replay cannot overwrite the child', async ({page, context, backend}) => {
  const prior = structuredClone(backend.tasks[2]), older = structuredClone(backend.tasks[3]);
  await openApp(page);
  const stale = await context.newPage();
  await openApp(stale);
  for (const tab of [page, stale]) {
    await tab.getByRole('button', {name: /项未完成任务等待继续/}).click();
    const picker = tab.getByRole('dialog', {name: '把未完成的事，接到今天'});
    await picker.getByRole('checkbox', {name: new RegExp(prior.name)}).check();
    await expect(picker.getByRole('checkbox', {name: new RegExp(older.name)})).not.toBeChecked();
  }
  await page.getByRole('button', {name: '迁移 1 项到今天', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const childId = carryId(prior.id, TODAY);
  expect(backend.tasks.find(t => t.id === childId)).toMatchObject({name: prior.name, priority: prior.priority, completed: false, elapsed_seconds: 0, completed_at: null});
  await card(page, prior.name).getByRole('button', {name: `完成：${prior.name}`, exact: true}).click();
  await expect(card(page, prior.name).getByRole('button', {name: `标记未完成：${prior.name}`, exact: true})).toHaveAttribute('aria-pressed', 'true');
  const childBeforeReplay = structuredClone(backend.tasks.find(t => t.id === childId));
  await stale.getByRole('button', {name: '迁移 1 项到今天', exact: true}).click();
  await expect(stale.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(card(page, prior.name)).toBeVisible();
  expect(backend.tasks.filter(t => t.id === childId)).toEqual([childBeforeReplay]);
  expect(backend.tasks.find(t => t.id === prior.id)).toEqual(prior);
  expect(backend.tasks.find(t => t.id === older.id)).toEqual(older);
  expect(backend.tasks.some(t => t.id === carryId(older.id, TODAY))).toBe(false);
  expect(backend.metadata.dtl_carry_prompt_v2).toBe(TODAY);
  await page.getByRole('tab', {name: '历史任务', exact: true}).click();
  await expect(card(page, prior.name)).toContainText('01:01:11');
  await stale.close();
});

test('missed reminders catch up on load and dismissal survives reload without completing the task', async ({page, backend}) => {
  const overdue = task({name: '错过的提醒', reminder_at: '2026-09-08T01:00:00Z', reminder_method: 'dialog'});
  backend.tasks = [overdue, task({id: 'future-reminder', name: '稍后的提醒', reminder_at: '2026-09-08T04:00:00Z', reminder_method: 'dialog'})];
  await openApp(page);
  const dialog = page.getByRole('dialog', {name: '任务提醒', exact: true});
  await expect(dialog).toContainText('错过的提醒');
  await expect(dialog).toContainText('你可能错过了这项提醒');
  await dialog.getByRole('button', {name: '知道了', exact: true}).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(card(page, overdue.name)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(dialog).toHaveCount(0);
  expect(backend.tasks[0]).toEqual(overdue);
  expect(backend.taskRequests('PATCH')).toHaveLength(0);
});

test('search, date and completion filters compose and clear without leaking today into history', async ({page}) => {
  await openApp(page);
  await page.getByRole('textbox', {name: '搜索任务', exact: true}).fill(' aLpHa ');
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(card(page, '今日 Alpha 计划')).toBeVisible();
  await page.getByRole('tab', {name: '历史任务', exact: true}).click();
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  await expect(card(page, '今日 Alpha 计划')).toHaveCount(0);
  await page.getByLabel('历史日期', {exact: true}).fill('2026-09-07');
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(card(page, '昨天 Alpha 计划')).toBeVisible();
  await page.getByRole('combobox', {name: '完成状态筛选'}).selectOption('done');
  await expect(page.getByTestId('task-card')).toHaveCount(0);
  await expect(page.getByRole('heading', {name: '没有符合条件的任务'})).toBeVisible();
  await page.getByRole('button', {name: '清除筛选', exact: true}).click();
  await expect(page.getByLabel('历史日期', {exact: true})).toHaveValue('');
  await expect(page.getByRole('textbox', {name: '搜索任务', exact: true})).toHaveValue('');
  await expect(page.getByTestId('task-card')).toHaveCount(2);
  await page.getByRole('tab', {name: /今日任务/}).click();
  await page.getByRole('combobox', {name: '完成状态筛选'}).selectOption('done');
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(card(page, '今日已完成')).toBeVisible();
});

test('delete can be undone, remains pending through reload, and only commits after eight seconds', async ({page, backend}) => {
  await page.clock.install({time: new Date(NOW)});
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  const original = structuredClone(backend.tasks[0]);
  await card(page, original.name).getByRole('button', {name: `删除：${original.name}`, exact: true}).click();
  await expect(card(page, original.name)).toHaveCount(0);
  await page.clock.runFor(7_500);
  expect(backend.taskRequests('DELETE')).toHaveLength(0);
  expect(backend.tasks.find(t => t.id === original.id)).toEqual(original);
  await page.getByRole('button', {name: '撤销', exact: true}).click();
  await page.clock.runFor(1_000);
  await expect(card(page, original.name)).toBeVisible();
  expect(backend.taskRequests('DELETE')).toHaveLength(0);
  await card(page, original.name).getByRole('button', {name: `删除：${original.name}`, exact: true}).click();
  await page.clock.runFor(3_000);
  await page.reload();
  await expect(page.getByRole('button', {name: '撤销', exact: true})).toBeVisible();
  await expect(card(page, original.name)).toHaveCount(0);
  await page.clock.runFor(4_500);
  expect(backend.taskRequests('DELETE')).toHaveLength(0);
  await page.clock.runFor(1_000);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(1);
  await expect(page.getByRole('button', {name: '撤销', exact: true})).toHaveCount(0);
  expect(backend.tasks.some(t => t.id === original.id)).toBe(false);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, original.name)).toHaveCount(0);
});

test('a saved repeat rule persists metadata, creates only today once, and does not overwrite completed occurrences on reload', async ({page, backend}) => {
  await openApp(page);
  await page.getByRole('button', {name: '重复任务', exact: true}).click();
  const panel = page.getByRole('dialog', {name: '重复任务', exact: true});
  await panel.getByRole('textbox', {name: '重复任务名称', exact: true}).fill('每天站会');
  await panel.getByLabel('优先级', {exact: true}).selectOption('high');
  await panel.getByLabel('开始日期', {exact: true}).fill('2026-09-01');
  await panel.getByRole('button', {name: '保存规则', exact: true}).click();
  await expect(panel.getByRole('list', {name: '重复规则'})).toContainText('每天站会');
  await panel.getByRole('button', {name: '关闭面板', exact: true}).click();
  await expect(card(page, '每天站会')).toBeVisible();
  const entry = Object.entries(backend.metadata).find(([key]) => key.startsWith(RULE_PREFIX));
  expect(entry).toBeDefined();
  const savedRule = entry![1] as ReturnType<typeof rule>;
  expect(savedRule).toMatchObject({name: '每天站会', frequency: 'daily', priority: 'high', startDate: '2026-09-01', enabled: true});
  const generatedId = repeatId(savedRule.id, TODAY);
  expect(backend.tasks.filter(t => t.name === '每天站会')).toEqual([expect.objectContaining({id: generatedId})]);
  await card(page, '每天站会').getByRole('button', {name: '完成：每天站会', exact: true}).click();
  await expect(card(page, '每天站会').getByRole('button', {name: '标记未完成：每天站会', exact: true})).toBeVisible();
  const completed = structuredClone(backend.tasks.find(t => t.id === generatedId));
  for (let reload = 0; reload < 2; reload++) {
    const before = backend.taskRequests('POST').length;
    await page.reload();
    await expect(card(page, '每天站会')).toBeVisible();
    await expect.poll(() => backend.taskRequests('POST').length).toBeGreaterThan(before);
    await expect(page.locator('.sync-status')).toHaveText('已同步');
    expect(backend.tasks.filter(t => t.name === '每天站会')).toEqual([completed]);
  }
  expect(backend.metadata.profile_label).toBe('unchanged account setting');
  expect(backend.metadata[entry![0]]).toEqual(savedRule);
  await page.getByRole('button', {name: '重复任务', exact: true}).click();
  await expect(panel.getByRole('list', {name: '重复规则'})).toContainText('每天站会');
});

test('deleting a repeated occurrence persists its skip marker so reload cannot recreate it', async ({page, backend}) => {
  const recurrence = rule();
  backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  await page.clock.install({time: new Date(NOW)});
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  await expect(card(page, recurrence.name)).toBeVisible();
  await card(page, recurrence.name).getByRole('button', {name: `删除：${recurrence.name}`, exact: true}).click();
  await page.clock.runFor(8_500);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(1);
  await expect(page.getByRole('button', {name: '撤销', exact: true})).toHaveCount(0);
  expect(backend.metadata['dtl_skip_v2_' + recurrence.id]).toBe(TODAY);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, recurrence.name)).toHaveCount(0);
  expect(backend.tasks.some(t => t.id === repeatId(recurrence.id, TODAY))).toBe(false);
});

test('mobile tasks precede an idle timer and a selected timer stays fixed without overflow', async ({page, backend}, testInfo) => {
  const longName = 'MobileLongUnbrokenTaskName'.repeat(12);
  backend.tasks.push(task({id: 'long-mobile-task', name: longName}));
  await page.setViewportSize({width: 375, height: 812});
  await openApp(page);
  await expect(card(page, longName)).toBeVisible();
  const toggle = page.getByRole('button', {name: '展开或收起计时器'});
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.timer-body')).toHaveCount(1);
  await expect(page.locator('.timer-body')).toBeHidden();
  const layout = await page.evaluate(() => {
    const taskArea = document.querySelector('.task-area')!.getBoundingClientRect();
    const timer = document.querySelector('.timer-panel')!.getBoundingClientRect();
    return {width: document.documentElement.clientWidth, scroll: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), taskBottom: taskArea.bottom, timerTop: timer.top};
  });
  expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
  expect(layout.taskBottom).toBeLessThanOrEqual(layout.timerTop);
  await page.screenshot({path: testInfo.outputPath('mobile.png'), fullPage: true});
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('combobox', {name: '计时方式', exact: true})).toBeVisible();
  await card(page, '今日 Alpha 计划').getByRole('button', {name: '计时：今日 Alpha 计划', exact: true}).click();
  const selectedTimer = page.locator('.timer-panel');
  await expect(selectedTimer).toHaveCSS('position', 'fixed');
  await expect(selectedTimer.getByRole('button', {name: '暂停', exact: true})).toBeVisible();
  const selectedLayout = await selectedTimer.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)};
  });
  expect(selectedLayout.left).toBeGreaterThanOrEqual(0);
  expect(selectedLayout.top).toBeGreaterThanOrEqual(0);
  expect(selectedLayout.right).toBeLessThanOrEqual(selectedLayout.viewportWidth);
  expect(selectedLayout.bottom).toBeLessThanOrEqual(selectedLayout.viewportHeight);
  expect(selectedLayout.viewportHeight - selectedLayout.bottom).toBeLessThanOrEqual(32);
  expect(selectedLayout.scrollWidth).toBeLessThanOrEqual(selectedLayout.viewportWidth + 1);
  await page.screenshot({path: testInfo.outputPath('mobile-selected-timer.png')});
  await toggle.click();
  await expect(page.locator('.timer-body')).toBeHidden();
  await expect(selectedTimer).toHaveCSS('position', 'fixed');
});

test('JSON/CSV downloads include all tasks and JSON settings, excluding session credentials', async ({page, backend}) => {
  const recurrence = rule({enabled: false});
  backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  await openApp(page);
  await page.getByRole('textbox', {name: '搜索任务', exact: true}).fill('does not match');
  await expect(page.getByTestId('task-card')).toHaveCount(0);
  async function download(label: string) {
    await page.getByRole('button', {name: '导出备份', exact: true}).click();
    const pending = page.waitForEvent('download');
    await page.getByRole('dialog', {name: '导出任务备份'}).getByRole('button', {name: label, exact: true}).click();
    const file = await pending;
    expect(await file.failure()).toBeNull();
    const contents = await readFile((await file.path())!, 'utf8');
    expect(contents).not.toContain(FAKE_ACCESS_TOKEN);
    expect(contents).not.toMatch(/access_token|refresh_token|sb-backend-auth-token|test-only-not-a-real-refresh-token/);
    return {contents, name: file.suggestedFilename()};
  }
  const json = await download('导出 JSON 完整备份');
  expect(json.name).toBe(`每日任务清单-${TODAY}.json`);
  const backup = JSON.parse(json.contents);
  expect(backup).toMatchObject({format: 'daily-task-list', version: 2, timezone: 'Asia/Shanghai'});
  expect(backup.tasks).toEqual(expect.arrayContaining(seedTasks()));
  expect(backup.tasks).toHaveLength(backend.tasks.length);
  expect(backup.settings).toEqual({dtl_carry_prompt_v2: TODAY, [RULE_PREFIX + recurrence.id]: recurrence});
  const csv = await download('导出 CSV 表格');
  expect(csv.name).toBe(`每日任务清单-${TODAY}.csv`);
  expect(csv.contents.startsWith('\ufeff')).toBe(true);
  for (const row of backend.tasks) { expect(csv.contents).toContain(row.name); expect(csv.contents).toContain(row.id); }
});

test('crossing midnight updates today, offers yesterday carry, and creates the next repeat occurrence once', async ({page, backend}) => {
  const recurrence = rule();
  backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  const beforeMidnight = new Date('2026-09-08T23:59:50+08:00');
  await page.clock.install({time: beforeMidnight});
  await page.clock.pauseAt(beforeMidnight);
  await openApp(page, {keepClock: true});
  await expect(card(page, recurrence.name)).toBeVisible();
  const yesterdayId = repeatId(recurrence.id, TODAY), nextId = repeatId(recurrence.id, '2026-09-09');
  await page.clock.runFor(31_000);
  const picker = page.getByRole('dialog', {name: '把未完成的事，接到今天'});
  await expect(picker).toBeVisible();
  await picker.getByRole('button', {name: '今天不再提示', exact: true}).click();
  await expect(picker).toHaveCount(0);
  await expect.poll(() => backend.tasks.some(t => t.id === nextId)).toBe(true);
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(card(page, recurrence.name)).toBeVisible();
  await expect(card(page, '今日 Alpha 计划')).toHaveCount(0);
  await page.reload();
  await expect(card(page, recurrence.name)).toBeVisible();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  expect(backend.tasks.filter(t => t.id === nextId)).toHaveLength(1);
  expect(backend.tasks.filter(t => t.id === yesterdayId)).toHaveLength(1);
  expect(backend.metadata.dtl_carry_prompt_v2).toBe('2026-09-09');
});

test('task pagination retains all history beyond a 500-row backend page', async ({page, backend}) => {
  backend.tasks = Array.from({length: 501}, (_, i) => task({id: `task-${String(i).padStart(4, '0')}`, name: `历史分页 ${i}`, created_at: '2026-09-07T01:00:00Z'}));
  await openApp(page);
  await page.getByRole('tab', {name: '历史任务', exact: true}).click();
  await page.getByRole('textbox', {name: '搜索任务', exact: true}).fill('历史分页 500');
  await expect(card(page, '历史分页 500')).toBeVisible();
  expect(backend.taskRequests('GET').some(r => {
    const query = new URLSearchParams(r.query);
    return query.get('id') === 'gt.task-0499' && query.get('limit') === '500';
  })).toBe(true);
});
