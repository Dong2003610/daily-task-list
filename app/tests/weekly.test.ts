import { describe, expect, it } from "vitest";
import { shiftDay, weekStart, weeklyDailyRow } from "../src/weekly";
import type { WeeklyTask } from "../src/types";
import { USER_ID } from "./factories";

describe("weekly calendar boundaries and scheduling", () => {
  it.each([
    ["2026-10-12", "2026-10-12"], ["2026-10-18", "2026-10-12"],
    ["2026-10-19", "2026-10-19"], ["2027-01-01", "2026-12-28"],
    ["2024-03-01", "2024-02-26"],
  ])("assigns %s to the Monday %s", (day, monday) => expect(weekStart(day)).toBe(monday));
  it("moves across month/year and leap-day boundaries", () => {
    expect(shiftDay("2026-12-28", 7)).toBe("2027-01-04");
    expect(shiftDay("2024-02-26", 6)).toBe("2024-03-03");
  });
  it("retries scheduling with the same ID, keeps a new day separate and leaves the goal unchanged", () => {
    const goal: WeeklyTask = { id: "00000000-0000-4000-8000-000000000801", user_id: USER_ID,
      name: "交付周报", week_start: "2026-10-12", priority: "high", completed: false,
      completed_at: null, created_at: "2026-10-12T01:00:00Z" };
    const before = structuredClone(goal);
    const first = weeklyDailyRow(goal, USER_ID, new Date("2026-10-13T00:00:00Z"));
    expect(weeklyDailyRow(goal, USER_ID, new Date("2026-10-13T15:59:59Z")).id).toBe(first.id);
    expect(weeklyDailyRow(goal, USER_ID, new Date("2026-10-13T16:00:00Z")).id).not.toBe(first.id);
    expect(goal).toEqual(before);
    expect(first).toMatchObject({ name: goal.name, priority: "high", completed: false, elapsed_seconds: 0 });
  });
});
