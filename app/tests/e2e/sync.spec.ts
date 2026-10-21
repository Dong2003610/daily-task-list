import type {Page} from "@playwright/test";
import type {WeeklyTask} from "../../src/types";
import {NOW, rule, task, USER_ID} from "../factories";
import {repeatId, RULE_PREFIX} from "../../src/domain";
import {card, expect, MockBackend, openApp, test} from "./fixtures";

const goal = (overrides: Partial<WeeklyTask> = {}): WeeklyTask => ({
  id: "00000000-0000-4000-8000-000000000801", user_id: USER_ID, week_start: "2026-09-07",
  name: "周计划原稿", priority: "high", completed: false, completed_at: null,
  created_at: "2026-09-07T01:00:00Z", updated_at: "2026-09-07T01:00:00Z", ...overrides,
});
const reads = (backend: MockBackend, table: string) => backend.requests.filter(r => r.method === "GET" && r.path.endsWith(`/rest/v1/${table}`));
const selection = (request: {query: string}) => new URLSearchParams(request.query).get("select");
async function openPaused(page: Page) {
  await page.clock.install({time: new Date(NOW)}); await page.clock.pauseAt(new Date(NOW));
  await openApp(page, {keepClock: true});
  await expect(page.getByRole("button", {name: "添加周任务", exact: true})).toBeEnabled();
}

test("unchanged data uses only compact manifests, metadata is not polled every minute, and idle checks slow down", async ({page, backend}) => {
  backend.weeklyTasks.push(goal());
  await openPaused(page);
  const start = backend.requests.length;
  await page.clock.runFor(60_000);
  await expect.poll(() => reads(backend, "tasks").length).toBe(2);
  await expect.poll(() => reads(backend, "weekly_tasks").length).toBe(2);
  for (const table of ["tasks", "weekly_tasks"]) expect(reads(backend, table).slice(1).map(selection)).toEqual(["id,updated_at"]);
  expect(backend.requests.slice(start).some(r => r.path.endsWith("/auth/v1/user"))).toBe(false);
  await page.clock.runFor(240_000);
  expect(reads(backend, "tasks")).toHaveLength(2);
  await page.clock.runFor(60_000);
  await expect.poll(() => reads(backend, "tasks").length).toBe(3);
  await expect.poll(() => reads(backend, "weekly_tasks").length).toBe(3);
  for (const table of ["tasks", "weekly_tasks"]) expect(reads(backend, table).slice(1).every(r => selection(r) === "id,updated_at")).toBe(true);
});

test("remote daily and weekly additions, edits and hard deletions reconcile using only changed details", async ({page, backend}) => {
  backend.weeklyTasks.push(goal(), goal({id: "00000000-0000-4000-8000-000000000802", name: "要删除的周目标"}));
  await openPaused(page);
  backend.tasks[0] = {...backend.tasks[0], name: "另一个设备更新的任务", updated_at: "2026-09-08T02:00:01Z"};
  backend.tasks = backend.tasks.filter(t => !t.completed);
  backend.tasks.push(task({id: "00000000-0000-4000-8000-000000000109", name: "另一个设备新增任务", updated_at: "2026-09-08T02:00:02Z"}));
  backend.weeklyTasks = [goal({name: "新周计划内容", updated_at: "2026-09-08T02:00:01Z"}),
    goal({id: "00000000-0000-4000-8000-000000000803", name: "新增周目标"}),
    goal({id: "00000000-0000-4000-8000-000000000804", name: "不属于当前周", week_start: "2026-09-14"})];
  await page.clock.runFor(60_000);
  await expect(card(page, "另一个设备更新的任务")).toBeVisible();
  await expect(card(page, "另一个设备新增任务")).toBeVisible();
  await expect(card(page, "今日 Alpha 计划")).toHaveCount(0);
  await expect(card(page, "今日已完成")).toHaveCount(0);
  await expect(page.getByTestId("weekly-task")).toHaveCount(2);
  await expect(page.getByTestId("weekly-task").filter({hasText: "新周计划内容"})).toBeVisible();
  await expect(page.getByTestId("weekly-task").filter({hasText: "新增周目标"})).toBeVisible();
  for (const table of ["tasks", "weekly_tasks"]) {
    const requests = reads(backend, table).slice(1);
    expect(requests).toHaveLength(2); expect(selection(requests[0])).toBe("id,updated_at");
    const params = new URLSearchParams(requests[1].query);
    expect(params.get("id")).toMatch(/^in\.\(/);
    expect(params.get("user_id")).toBe(`eq.${USER_ID}`);
    if (table === "weekly_tasks") expect(params.get("week_start")).toBe("eq.2026-09-07");
  }
});

test("hidden or offline tabs make no automatic reads and recover on return without focus storms", async ({page, backend}) => {
  await openPaused(page);
  const count = backend.requests.length;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, value: "hidden"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(360_000); expect(backend.requests).toHaveLength(count);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {configurable: true, value: false}); window.dispatchEvent(new Event("offline"));
    Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"}); document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(360_000); expect(backend.requests).toHaveLength(count);
  backend.tasks[0] = {...backend.tasks[0], name: "离开期间的改动", updated_at: "2026-09-08T02:05:00Z"};
  await page.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {configurable: true, value: true});
    for (let i = 0; i < 10; i++) { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); }
  });
  await expect(card(page, "离开期间的改动")).toBeVisible();
  expect(reads(backend, "tasks").slice(1)).toHaveLength(2);
  expect(reads(backend, "weekly_tasks").slice(1)).toHaveLength(1);
});

test("manual refresh bypasses automatic cooldown and own edits save immediately", async ({page, backend}) => {
  await openPaused(page);
  backend.tasks[0] = {...backend.tasks[0], name: "手动刷新看见", updated_at: "2026-09-08T02:00:01Z"};
  await page.getByRole("button", {name: "刷新同步"}).click();
  await expect(card(page, "手动刷新看见")).toBeVisible();
  expect(selection(reads(backend, "tasks")[1])).toContain("name");
  await card(page, "手动刷新看见").getByRole("button", {name: "完成：手动刷新看见", exact: true}).click();
  await expect(card(page, "手动刷新看见").getByRole("button", {name: "标记未完成：手动刷新看见", exact: true})).toBeVisible();
  expect(backend.taskRequests("PATCH")).toHaveLength(1);
  expect(backend.tasks[0].completed).toBe(true);
  await page.clock.runFor(60_000);
  await expect.poll(() => reads(backend, "tasks").length).toBe(3);
  expect(selection(reads(backend, "tasks")[2])).toBe("id,updated_at");
  expect(reads(backend, "tasks")).toHaveLength(3);
});

test("a hidden tab defers next-day repeat generation until it is visible", async ({page, backend}) => {
  const recurrence = rule(); backend.metadata[RULE_PREFIX + recurrence.id] = recurrence;
  const time = new Date("2026-09-08T23:59:50+08:00");
  await page.clock.install({time}); await page.clock.pauseAt(time);
  await openApp(page, {keepClock: true});
  await expect(card(page, recurrence.name)).toBeVisible();
  await expect(page.locator(".sync-status")).toHaveText("已同步");
  const count = backend.requests.length;
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, value: "hidden"}); document.dispatchEvent(new Event("visibilitychange")); });
  await page.clock.runFor(31_000); expect(backend.requests).toHaveLength(count);
  const nextId = repeatId(recurrence.id, "2026-09-09");
  expect(backend.tasks.some(t => t.id === nextId)).toBe(false);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", {configurable: true, value: "visible"}); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(() => backend.tasks.some(t => t.id === nextId)).toBe(true);
  expect(backend.tasks.filter(t => t.id === nextId)).toHaveLength(1);
});

test("version manifests paginate past 500 rows and still reconcile a historical deletion", async ({page, backend}) => {
  for (let i = 0; i < 600; i++) backend.tasks.push(task({id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`, name: `历史归档 ${i}`, created_at: "2026-08-01T01:00:00Z"}));
  await openPaused(page);
  expect(reads(backend, "tasks")).toHaveLength(2);
  backend.tasks.pop();
  await page.clock.runFor(60_000);
  await expect.poll(() => reads(backend, "tasks").length).toBe(4);
  expect(reads(backend, "tasks").slice(2).map(selection)).toEqual(["id,updated_at", "id,updated_at"]);
  expect(new URLSearchParams(reads(backend, "tasks")[3].query).get("id")).toMatch(/^gt\./);
  await page.getByRole("button", {name: "导出备份", exact: true}).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", {name: "导出 JSON 完整备份"}).click();
  const {readFile} = await import("node:fs/promises");
  const backup = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  expect(backup.tasks).toHaveLength(603);
  expect(backup.tasks.some((t: {name: string}) => t.name === "历史归档 599")).toBe(false);
});
