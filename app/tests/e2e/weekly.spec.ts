import { readFile } from "node:fs/promises";
import { USER_ID } from "../factories";
import type { WeeklyTask } from "../../src/types";
import { card, expect, openApp, test } from "./fixtures";

function goal(overrides: Partial<WeeklyTask> = {}): WeeklyTask {
  return { id: "00000000-0000-4000-8000-000000000801", user_id: USER_ID,
    name: "本周客户方案评审", priority: "high", week_start: "2026-09-07",
    completed: false, completed_at: null, created_at: "2026-09-07T01:00:00Z", ...overrides };
}
test("weekly plans persist, keep daily completion separate, preserve custom order and appear in full backup", async ({ page, backend }, info) => {
  backend.weeklyTasks.push(goal());
  backend.tasks[0].sort_order = 1000;
  await openApp(page);
  const panel = page.getByRole("region", { name: "每周总任务" });
  await expect(panel.getByRole("heading", { name: "本周客户方案评审" })).toBeVisible();
  await panel.getByRole("button", { name: "安排到今天：本周客户方案评审", exact: true }).click();
  await expect(card(page, "本周客户方案评审")).toBeVisible();
  expect(backend.tasks.find(t => t.name === "本周客户方案评审")?.sort_order).toBe(2000);
  await card(page, "本周客户方案评审").getByRole("button", { name: "完成：本周客户方案评审", exact: true }).click();
  await expect(card(page, "本周客户方案评审").getByRole("button", { name: "标记未完成：本周客户方案评审", exact: true })).toBeVisible();
  expect(backend.weeklyTasks[0].completed).toBe(false);
  await panel.getByRole("button", { name: "完成周任务：本周客户方案评审" }).click();
  await expect(panel.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  await page.reload();
  await expect(panel.getByRole("button", { name: "恢复周任务：本周客户方案评审" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON 完整备份" }).click();
  const downloaded = await downloading;
  const backup = JSON.parse(await readFile((await downloaded.path())!, "utf8"));
  expect(backup.weeklyTasks[0]).toMatchObject({ name: "本周客户方案评审", completed: true });
  await page.screenshot({ path: info.outputPath("weekly-desktop.png"), fullPage: true });
});

test("lost create response keeps the weekly draft and retries once without duplicates; editing and deleting preserve daily tasks", async ({ page, backend }) => {
  await openApp(page);
  await page.getByRole("button", { name: "添加周任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "添加周任务" });
  await dialog.getByLabel("周任务名称").fill("周一会议安排");
  await dialog.getByLabel("周任务优先级").selectOption("high");
  backend.loseNextWeeklyInsertResponse = true;
  await dialog.getByRole("button", { name: "保存周任务" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("周任务名称")).toHaveValue("周一会议安排");
  await dialog.getByRole("button", { name: "保存周任务" }).click();
  await expect(dialog).not.toBeVisible();
  expect(backend.weeklyTasks).toHaveLength(1);
  await page.getByRole("button", { name: "编辑周任务：周一会议安排" }).click();
  const edit = page.getByRole("dialog", { name: "编辑周任务" });
  await edit.getByLabel("周任务名称").fill("完成团队周报");
  await edit.getByRole("button", { name: "保存周任务" }).click();
  await expect(page.getByRole("button", { name: "安排到今天：完成团队周报" })).toBeVisible();
  await page.getByRole("button", { name: "安排到今天：完成团队周报" }).click();
  await expect(card(page, "完成团队周报")).toBeVisible();
  await page.getByRole("button", { name: "删除周任务：完成团队周报" }).click();
  await page.getByRole("dialog", { name: "删除周任务" }).getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByTestId("weekly-task")).toHaveCount(0);
  await expect(card(page, "完成团队周报")).toBeVisible();
});

test("switching weeks archives plans, supports next-week planning and advances automatically on Monday", async ({ page, backend }) => {
  backend.weeklyTasks.push(goal());
  await openApp(page);
  await page.getByRole("button", { name: "下一周", exact: true }).click();
  await expect(page.getByTestId("weekly-task")).toHaveCount(0);
  await page.getByRole("button", { name: "添加周任务", exact: true }).click();
  await page.getByLabel("周任务名称").fill("下周发布方案");
  await page.getByRole("button", { name: "保存周任务" }).click();
  await expect(page.getByTestId("weekly-task")).toHaveCount(1);
  expect(backend.weeklyTasks[1].week_start).toBe("2026-09-14");
  await page.getByRole("button", { name: "回到本周" }).click();
  await expect(page.getByTestId("weekly-task")).toContainText("本周客户方案评审");
  await page.clock.setFixedTime(new Date("2026-09-14T00:00:00+08:00"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByTestId("weekly-task")).toContainText("下周发布方案");
  expect(backend.weeklyTasks).toHaveLength(2);
});

test("desktop weekly sidebar stays visible during scrolling; mobile weekly entry stays accessible without overflow", async ({ page, backend }, info) => {
  backend.weeklyTasks.push(goal(), goal({ id: "00000000-0000-4000-8000-000000000802", name: "核对预算与部门交付清单，提交完整季度目标", priority: "medium" }));
  for (let i = 0; i < 18; i++) backend.tasks.push({ ...backend.tasks[0], id: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`, name: `今日工作安排 ${i}` });
  await openApp(page);
  const panel = page.getByRole("region", { name: "每周总任务" });
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath("weekly-mobile.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 1100));
  await expect(page.getByRole("button", { name: "查看每周总任务" })).toBeVisible();
  await page.getByRole("button", { name: "查看每周总任务" }).click();
  await expect.poll(async () => (await panel.boundingBox())!.y).toBeGreaterThanOrEqual(-2);
});

test("weekly sync failure does not block daily task creation", async ({ page, backend }) => {
  backend.failNext("GET", "/rest/v1/weekly_tasks", "周计划连接暂不可用", 400);
  await openApp(page);
  await expect(page.getByRole("region", { name: "每周总任务" }).getByRole("alert")).toContainText("周计划连接暂不可用");
  await page.getByRole("textbox", { name: "快速添加任务" }).fill("照常处理每日工作");
  await page.getByRole("textbox", { name: "快速添加任务" }).press("Enter");
  await expect(card(page, "照常处理每日工作")).toBeVisible();
  await page.getByRole("region", { name: "每周总任务" }).getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加周任务", exact: true })).toBeEnabled();
});
