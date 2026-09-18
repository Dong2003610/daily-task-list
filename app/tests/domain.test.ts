import { describe, expect, it } from "vitest";
import {
  carryCandidates,
  carryId,
  carryRow,
  dateFromDay,
  dayKey,
  dayLabel,
  dueReminders,
  exportCsv,
  isRuleDue,
  reminderKey,
  repeatId,
  repeatRow,
  RULE_PREFIX,
  rulesFromMetadata,
  validInput,
  yesterday,
  cancelledSources,
  cancelledTaskIds,
  CARRY_CANCEL,
  SKIP_PREFIX,
  sortTasks,
} from "../src/domain";
import { NOW, rule, task, TODAY, USER_ID } from "./factories";

describe("Shanghai calendar boundaries", () => {
  it.each([
    ["2026-01-01", "2025-12-31"],
    ["2026-05-01", "2026-04-30"],
    ["2026-03-01", "2026-02-28"],
    ["2024-03-01", "2024-02-29"],
    ["2000-03-01", "2000-02-29"],
    ["2100-03-01", "2100-02-28"],
  ])("%s has previous Shanghai day %s", (day, previous) => {
    expect(yesterday(day)).toBe(previous);
    expect(dayKey(dateFromDay(day))).toBe(day);
    expect(dateFromDay(day).toISOString()).toBe(`${day}T04:00:00.000Z`);
    expect(dayLabel(previous, day)).toBe("昨天");
  });

  it("uses Shanghai dates across UTC midnight and labels older dates literally", () => {
    expect(dayKey("2026-12-31T16:00:00Z")).toBe("2027-01-01");
    expect(dayKey("2026-12-31T15:59:59Z")).toBe("2026-12-31");
    expect(dayLabel("2027-01-01", "2027-01-01")).toBe("今天");
    expect(dayLabel("2026-12-30", "2027-01-01")).toBe("2026-12-30");
  });

  it("handles invalid dates without throwing or manufacturing a calendar key", () => {
    expect(dayKey("invalid")).toBe("");
    expect(dayKey(new Date(NaN))).toBe("");
  });
});

describe("task ordering", () => {
  it("uses priority by default and lets persisted manual positions override it", () => {
    const high = task({ id: "high", name: "高", priority: "high" });
    const medium = task({ id: "medium", name: "中", priority: "medium" });
    const low = task({ id: "low", name: "低", priority: "low" });
    expect(sortTasks([low, medium, high]).map((t) => t.id)).toEqual([
      "high",
      "medium",
      "low",
    ]);
    expect(
      sortTasks([
        { ...high, sort_order: 3000 },
        { ...medium, sort_order: 1000 },
        { ...low, sort_order: 2000 },
      ]).map((t) => t.id),
    ).toEqual(["medium", "low", "high"]);
  });

  it("places a newly added unpositioned task after an existing custom sequence", () => {
    const first = task({ id: "first", sort_order: 1000, priority: "low" });
    const second = task({ id: "second", sort_order: 2000, priority: "high" });
    const fresh = task({ id: "fresh", sort_order: null, priority: "high" });
    expect(sortTasks([fresh, second, first]).map((t) => t.id)).toEqual([
      "first",
      "second",
      "fresh",
    ]);
  });
});

describe("cancellation metadata compatibility", () => {
  it("suppresses legacy and current carry sources, hiding only explicitly identified copies", () => {
    const source = task({
      id: "cancelled-source",
      created_at: "2026-09-07T01:00:00Z",
    });
    const independent = { ...source, id: "independent-homonym" };
    const copyId = carryId(source.id, TODAY);
    const metadata = {
      [CARRY_CANCEL + source.id]: copyId,
      [CARRY_CANCEL + "legacy-source"]: true,
      [CARRY_CANCEL + "cleared-source"]: null,
      unrelated: copyId,
    };
    expect([...cancelledSources(metadata)].sort()).toEqual(
      [source.id, "legacy-source"].sort(),
    );
    expect([...cancelledTaskIds(metadata)]).toEqual([copyId]);
    expect(
      carryCandidates([source, independent], TODAY, cancelledSources(metadata)),
    ).toEqual([independent]);
  });

  it("maps a rule skip to its exact occurrence without suppressing other days or rules", () => {
    const recurrence = rule();
    const metadata = {
      [SKIP_PREFIX + recurrence.id]: TODAY,
      [SKIP_PREFIX + "bad"]: "not-a-day",
      [SKIP_PREFIX + "empty"]: null,
    };
    const ids = cancelledTaskIds(metadata);
    expect([...ids]).toEqual([repeatId(recurrence.id, TODAY)]);
    expect(ids.has(repeatId(recurrence.id, "2026-09-07"))).toBe(false);
    expect(ids.has(repeatId("different-rule", TODAY))).toBe(false);
  });
});

describe("carry lineage and replay identity", () => {
  it("suppresses every ancestor when a completed descendant exists, retaining independent homonyms", () => {
    const root = task({ created_at: "2026-09-01T01:00:00Z", name: "同名任务" });
    const child = carryRow(
      root,
      USER_ID,
      new Date("2026-09-03T10:00:00+08:00"),
    );
    const grandchild = {
      ...carryRow(child, USER_ID, new Date("2026-09-06T10:00:00+08:00")),
      completed: true,
    };
    const independent = task({
      id: "unrelated-root",
      name: root.name,
      created_at: root.created_at,
    });
    const current = task({ id: "current-day" });
    const future = task({
      id: "future-day",
      created_at: "2026-09-09T01:00:00Z",
    });
    const rows = [grandchild, independent, future, child, current, root];
    expect(carryCandidates(rows, TODAY).map((t) => t.id)).toEqual([
      independent.id,
    ]);
    expect(
      carryCandidates([...rows].reverse(), TODAY).map((t) => t.id),
    ).toEqual([independent.id]);
    expect(
      carryCandidates([root, child, independent], TODAY)
        .map((t) => t.id)
        .sort(),
    ).toEqual([child.id, independent.id].sort());
  });

  it("uses stable namespaced UUIDs, distinguishing source, day, and operation", () => {
    const ids = [
      carryId("source-a", TODAY),
      carryId("source-b", TODAY),
      carryId("source-a", "2026-09-09"),
      repeatId("source-a", TODAY),
    ];
    expect(new Set(ids).size).toBe(4);
    for (const id of ids)
      expect(id).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      );
    expect(carryId("source-a", TODAY)).toBe(ids[0]);
    expect(repeatId("source-a", TODAY)).toBe(ids[3]);
    // Persisted occurrence IDs are a compatibility contract across releases.
    expect(ids[0]).toBe("b9b8dad9-00c7-537d-8bb8-d032c48f39b6");
    expect(ids[3]).toBe("8cad7a8c-490f-5d8a-9acb-d1ea9015d645");
  });

  it.each([null, "2026-09-08T01:59:59Z", "2026-09-08T02:00:00Z", "invalid"])(
    "resets elapsed/completion and clears expired or invalid reminder %s without changing history",
    (reminder_at) => {
      const source = task({
        created_at: "2026-09-07T01:00:00Z",
        elapsed_seconds: 7200,
        completed_at: "2026-09-07T03:00:00Z",
        reminder_at,
        reminder_method: "sound",
      });
      const before = structuredClone(source);
      const copy = carryRow(source, USER_ID, new Date(NOW));
      expect(copy).toMatchObject({
        id: carryId(source.id, TODAY),
        name: source.name,
        priority: source.priority,
        elapsed_seconds: 0,
        completed: false,
        completed_at: null,
        reminder_at: null,
        reminder_method: null,
      });
      expect(dayKey(copy.created_at)).toBe(TODAY);
      expect(source).toEqual(before);
    },
  );

  it("retains a future reminder and its delivery method", () => {
    const source = task({
      reminder_at: "2026-09-09T03:00:00Z",
      reminder_method: "sound",
    });
    expect(carryRow(source, USER_ID, new Date(NOW))).toMatchObject({
      reminder_at: source.reminder_at,
      reminder_method: "sound",
    });
  });
});

describe("recurrence calendar and occurrence identity", () => {
  it.each([
    [
      "daily",
      [],
      [
        "2026-09-07",
        "2026-09-08",
        "2026-09-09",
        "2026-09-10",
        "2026-09-11",
        "2026-09-12",
        "2026-09-13",
      ],
    ],
    [
      "weekdays",
      [],
      ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"],
    ],
    ["weekly", [0, 2, 6], ["2026-09-08", "2026-09-12", "2026-09-13"]],
  ] as const)(
    "%s selects the correct dates in a full week",
    (frequency, weekdays, expected) => {
      const recurrence = rule({ frequency, weekdays: [...weekdays] });
      const week = Array.from(
        { length: 7 },
        (_, i) => `2026-09-${String(i + 7).padStart(2, "0")}`,
      );
      expect(week.filter((day) => isRuleDue(recurrence, day))).toEqual(
        expected,
      );
    },
  );

  it("never runs before start, while paused/deleted, or for an empty weekly selection", () => {
    for (const frequency of ["daily", "weekdays", "weekly"] as const) {
      const recurrence = rule({ frequency, weekdays: [2], startDate: TODAY });
      expect(isRuleDue(recurrence, "2026-09-01")).toBe(false);
      expect(isRuleDue(recurrence, TODAY)).toBe(true);
      expect(isRuleDue({ ...recurrence, enabled: false }, TODAY)).toBe(false);
      expect(isRuleDue({ ...recurrence, deleted: true }, TODAY)).toBe(false);
    }
    expect(isRuleDue(rule({ frequency: "weekly" }), TODAY)).toBe(false);
  });

  it("creates only the requested Shanghai day with a +08 reminder and stable ID across reload times", () => {
    const recurrence = rule({
      startDate: "2020-01-01",
      reminderTime: "09:15",
      reminderMethod: "sound",
    });
    const first = repeatRow(recurrence, USER_ID, new Date(NOW));
    const replay = repeatRow(
      recurrence,
      USER_ID,
      new Date("2026-09-08T23:59:00+08:00"),
    );
    expect(first).toMatchObject({
      id: repeatId(recurrence.id, TODAY),
      elapsed_seconds: 0,
      completed: false,
      reminder_at: "2026-09-08T01:15:00.000Z",
      reminder_method: "sound",
    });
    expect(dayKey(first.created_at)).toBe(TODAY);
    expect(replay.id).toBe(first.id);
    expect(
      repeatRow(recurrence, USER_ID, new Date("2026-09-09T00:01:00+08:00")).id,
    ).not.toBe(first.id);
    expect(repeatRow(rule(), USER_ID, new Date(NOW))).toMatchObject({
      reminder_at: null,
      reminder_method: null,
    });
  });

  it("ignores malformed or unrelated metadata without losing valid settings", () => {
    const valid = rule();
    expect(
      rulesFromMetadata({
        [RULE_PREFIX + valid.id]: valid,
        arbitrary: valid,
        [RULE_PREFIX + "bad"]: { ...valid, reminderTime: "25:90" },
        [RULE_PREFIX + "null"]: null,
      }),
    ).toEqual([valid]);
  });
});

// Independent RFC-4180 reader: assertions compare exported values, including
// embedded commas, quotes and newlines, rather than mirroring the encoder.
function csvRecords(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const text = csv.replace(/^\ufeff/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\r" || c === "\n")) {
      row.push(field);
      field = "";
      if (c !== ",") {
        rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows;
}

describe("CSV fidelity and spreadsheet formula safety", () => {
  it("round-trips Unicode, commas, quotes and embedded line breaks with a BOM", () => {
    const name = '中文, "quoted"\r\n第二行';
    const csv = exportCsv([task({ name, elapsed_seconds: 3671 })]);
    expect(csv.startsWith("\ufeff")).toBe(true);
    const records = csvRecords(csv);
    expect(records).toHaveLength(2);
    expect(records[0]).toHaveLength(8);
    expect(records[1]).toEqual([
      name,
      "中",
      "未完成",
      TODAY,
      "",
      "3671",
      "",
      task().id,
    ]);
  });

  it.each([
    '=HYPERLINK("https://invalid.example")',
    "+SUM(1,2)",
    "-1+2",
    "@SUM(A1)",
    "  =1+1",
    "\t=1+1",
    "\r=1+1",
  ])("neutralizes formula-like cell %j", (name) => {
    expect(csvRecords(exportCsv([task({ name })]))[1][0]).toBe("'" + name);
  });
});

describe("reminder validation and catch-up", () => {
  it("rejects invalid timestamps and normalizes absent or default reminder methods", () => {
    const input = {
      name: "  保留任务  ",
      priority: "medium" as const,
      reminder_at: null,
      reminder_method: "sound" as const,
    };
    expect(validInput(input)).toMatchObject({
      name: "保留任务",
      reminder_method: null,
    });
    expect(() => validInput({ ...input, reminder_at: "not-a-date" })).toThrow(
      "提醒时间无效",
    );
    expect(
      validInput({ ...input, reminder_at: NOW, reminder_method: null })
        .reminder_method,
    ).toBe("dialog");
  });

  it("catches overdue and exactly-due reminders chronologically, excluding invalid, future, completed and dismissed occurrences", () => {
    const rows = [
      task({ id: "due", reminder_at: "2026-09-08T02:00:00Z" }),
      task({ id: "invalid", reminder_at: "invalid" }),
      task({ id: "old", reminder_at: "2026-09-01T02:00:00Z" }),
      task({ id: "future", reminder_at: "2026-09-08T02:00:01Z" }),
      task({
        id: "done",
        completed: true,
        reminder_at: "2026-09-08T01:00:00Z",
      }),
      task({ id: "dismissed", reminder_at: "2026-09-08T01:00:00Z" }),
      task({ id: "none" }),
    ];
    const seen = new Set([reminderKey(rows[5])]);
    expect(dueReminders(rows, seen, Date.parse(NOW)).map((t) => t.id)).toEqual([
      "old",
      "due",
    ]);
    const rescheduled = { ...rows[5], reminder_at: "2026-09-08T01:30:00Z" };
    expect(dueReminders([rescheduled], seen, Date.parse(NOW))).toEqual([
      rescheduled,
    ]);
  });
});
