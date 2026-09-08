import {readFile} from 'node:fs/promises';
import {carryRow, CARRY_CANCEL, repeatId, repeatRow, RULE_PREFIX, SKIP_PREFIX} from '../../src/domain';
import {NOW, rule, task, TODAY, USER_ID} from '../factories';
import {card, expect, openApp, test} from './fixtures';

test('late repeat insertion is reconciled against a concurrent skip before it becomes visible', async ({page, backend}) => {
  const recurrence = rule();
  const occurrenceId = repeatId(recurrence.id, TODAY);
  backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  backend.afterNextTaskInsert = inserted => {
    expect(inserted.map(t => t.id)).toEqual([occurrenceId]);
    // The other device's cancellation becomes visible after this tab's stale
    // generation decision; the inserted row must be removed by reconciliation.
    backend.metadata[SKIP_PREFIX + recurrence.id] = TODAY;
  };
  await openApp(page);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(1);
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, recurrence.name)).toHaveCount(0);
  expect(backend.tasks.some(t => t.id === occurrenceId)).toBe(false);
  const deletion = backend.taskRequests('DELETE')[0];
  expect(new URLSearchParams(deletion.query).get('id')).toBe(`eq.${occurrenceId}`);
  expect(backend.tasks).toHaveLength(4);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, recurrence.name)).toHaveCount(0);
  expect(backend.metadata[SKIP_PREFIX + recurrence.id]).toBe(TODAY);
});

test('deleting today then yesterday for the same rule preserves today’s skip', async ({page, backend}) => {
  const recurrence = rule();
  const previous = repeatRow(recurrence, USER_ID, new Date('2026-09-07T10:00:00+08:00'));
  backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  backend.tasks.push(previous);
  await page.clock.install({time: new Date(NOW)});
  await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  await expect(card(page, recurrence.name)).toBeVisible();
  await card(page, recurrence.name).getByRole('button', {name: `删除：${recurrence.name}`, exact: true}).click();
  await page.clock.runFor(8_500);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(1);
  await expect(page.getByRole('button', {name: '撤销', exact: true})).toHaveCount(0);
  expect(backend.metadata[SKIP_PREFIX + recurrence.id]).toBe(TODAY);

  await page.getByRole('tab', {name: '历史任务', exact: true}).click();
  await expect(card(page, recurrence.name)).toBeVisible();
  await card(page, recurrence.name).getByRole('button', {name: `删除：${recurrence.name}`, exact: true}).click();
  await page.clock.runFor(8_500);
  await expect.poll(() => backend.taskRequests('DELETE').length).toBe(2);
  await expect(page.getByRole('button', {name: '撤销', exact: true})).toHaveCount(0);
  expect(backend.metadata[SKIP_PREFIX + recurrence.id]).toBe(TODAY);
  expect(backend.tasks.some(t => t.id === previous.id)).toBe(false);
  expect(backend.tasks.some(t => t.id === repeatId(recurrence.id, TODAY))).toBe(false);
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(card(page, recurrence.name)).toHaveCount(0);
  expect(backend.tasks.some(t => t.name === recurrence.name)).toBe(false);
});

test('cancelled IDs are excluded from visible tasks and backup even if stale rows remain in storage', async ({page, backend}) => {
  const recurrence = rule({enabled: false});
  const source = task({id: 'carry-root', name: '已取消的迁移', created_at: '2026-09-07T01:00:00Z'});
  const copy = carryRow(source, USER_ID, new Date(NOW));
  const repeated = repeatRow(recurrence, USER_ID, new Date(NOW));
  const independent = task({id: 'independent-copy-name', name: copy.name});
  backend.metadata = {
    ...backend.metadata, [RULE_PREFIX + recurrence.id]: recurrence,
    [SKIP_PREFIX + recurrence.id]: TODAY, [CARRY_CANCEL + source.id]: copy.id,
  };
  backend.tasks = [source, copy, repeated, independent];
  await openApp(page);
  await expect(page.getByTestId('task-card')).toHaveCount(1);
  await expect(card(page, independent.name)).toBeVisible();
  await expect(card(page, recurrence.name)).toHaveCount(0);
  await expect(page.getByRole('button', {name: /项未完成任务等待继续/})).toHaveCount(0);
  expect(backend.tasks).toHaveLength(4);
  expect(backend.taskRequests('DELETE')).toHaveLength(0);
  await page.getByRole('button', {name: '导出备份', exact: true}).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('dialog', {name: '导出任务备份'}).getByRole('button', {name: '导出 JSON 完整备份', exact: true}).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.tasks.map((t: {id: string}) => t.id).sort()).toEqual([source.id, independent.id].sort());
  await page.reload();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
  await expect(page.getByTestId('task-card')).toHaveCount(1);
});
