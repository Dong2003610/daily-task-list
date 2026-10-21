import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutoSync, syncRows } from "../src/sync";

describe("version-based synchronization", () => {
  const a = {id: "a", updated_at: "v1", name: "unchanged"};
  const b = {id: "b", updated_at: "v1", name: "deleted"};
  it("does not download unchanged details and preserves row references", async () => {
    const details = vi.fn();
    const result = await syncRows([a], async () => [{id: "a", updated_at: "v1"}], details);
    expect(result[0]).toBe(a);
    expect(details).not.toHaveBeenCalled();
  });
  it("fetches only additions and modifications, and reconciles hard deletes", async () => {
    const changed = {...a, updated_at: "v2", name: "edited"};
    const added = {...b, id: "c"};
    const details = vi.fn().mockResolvedValue([changed, added]);
    const result = await syncRows([a, b], async () => [changed, added], details);
    expect(details).toHaveBeenCalledExactlyOnceWith(["a", "c"]);
    expect(result).toEqual([changed, added]);
  });
  it("does not resurrect a row deleted between manifest and detail requests", async () => {
    expect(await syncRows([a], async () => [{id: "a", updated_at: "v2"}], async () => [])).toEqual([]);
  });
  it("treats server timestamps as opaque, even if older than the local value", async () => {
    const old = {...a, updated_at: "2020-01-01"};
    const details = vi.fn().mockResolvedValue([old]);
    expect(await syncRows([a], async () => [old], details)).toEqual([old]);
    expect(details).toHaveBeenCalled();
  });
  it("refreshes legacy rows without a timestamp", async () => {
    const details = vi.fn().mockResolvedValue([a]);
    await syncRows([a], async () => [{id: "a"}], details);
    expect(details).toHaveBeenCalledExactlyOnceWith(["a"]);
  });
  it("limits detail batches to 100 IDs", async () => {
    const rows = Array.from({length: 251}, (_, i) => ({id: String(i), updated_at: "v1"}));
    const details = vi.fn(async (ids: string[]) => rows.filter(row => ids.includes(row.id)));
    expect(await syncRows([], async () => rows, details)).toEqual(rows);
    expect(details.mock.calls.map(([ids]) => ids.length)).toEqual([100, 100, 51]);
  });
  it("propagates manifest and detail errors without modifying the previous snapshot", async () => {
    const previous = [a, b];
    await expect(syncRows(previous, async () => { throw new Error("offline"); }, vi.fn())).rejects.toThrow("offline");
    await expect(syncRows(previous, async () => [{id: "a", updated_at: "v2"}], async () => { throw new Error("failed"); })).rejects.toThrow("failed");
    expect(previous).toEqual([a, b]);
  });
  it("reconciles an empty server dataset without requesting details", async () => {
    const details = vi.fn();
    expect(await syncRows([a], async () => [], details)).toEqual([]);
    expect(details).not.toHaveBeenCalled();
  });
});

describe("adaptive automatic synchronization", () => {
  let win: EventTarget;
  let doc: EventTarget & {visibilityState: string};
  let network: {onLine: boolean};
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    win = new EventTarget();
    doc = Object.assign(new EventTarget(), {visibilityState: "visible"});
    network = {onLine: true};
    vi.stubGlobal("window", Object.assign(win, {setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval}));
    vi.stubGlobal("document", doc); vi.stubGlobal("navigator", network);
  });
  afterEach(() => { stop?.(); stop = undefined; vi.unstubAllGlobals(); vi.useRealTimers(); });
  it("checks every minute while active and slows to five minutes after inactivity", async () => {
    const refresh = vi.fn().mockResolvedValue(true); stop = startAutoSync(refresh);
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(299_999); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1); expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("stops background reads while hidden or offline and catches up on return", async () => {
    const refresh = vi.fn().mockResolvedValue(true); stop = startAutoSync(refresh);
    doc.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(600_000); expect(refresh).not.toHaveBeenCalled();
    doc.visibilityState = "visible"; network.onLine = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300_000); expect(refresh).not.toHaveBeenCalled();
    network.onLine = true; win.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0); expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("coalesces focus/online/visibility storms with a 30-second cooldown", async () => {
    const refresh = vi.fn().mockResolvedValue(true); stop = startAutoSync(refresh);
    await vi.advanceTimersByTimeAsync(30_000);
    for (let i = 0; i < 10; i++) {
      win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("online"));
      doc.dispatchEvent(new Event("visibilitychange"));
    }
    await vi.advanceTimersByTimeAsync(0); expect(refresh).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(29_999); expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); win.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("never overlaps requests", async () => {
    let finish!: (result: boolean) => void;
    const refresh = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    stop = startAutoSync(refresh);
    await vi.advanceTimersByTimeAsync(600_000);
    win.dispatchEvent(new Event("focus")); expect(refresh).toHaveBeenCalledTimes(1);
    finish(true); await vi.advanceTimersByTimeAsync(0);
    win.dispatchEvent(new Event("focus")); expect(refresh).toHaveBeenCalledTimes(2);
    finish(true);
  });
  it("backs off repeated failures and resets after success", async () => {
    const refresh = vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("offline")).mockResolvedValue(true);
    stop = startAutoSync(refresh);
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new Event("pointerdown"));
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000); win.dispatchEvent(new Event("focus"));
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(90_000); expect(refresh).toHaveBeenCalledTimes(3);
    win.dispatchEvent(new Event("wheel"));
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledTimes(4);
  });
  it("removes all timers and listeners on disposal", async () => {
    const refresh = vi.fn().mockResolvedValue(true); stop = startAutoSync(refresh); stop();
    await vi.advanceTimersByTimeAsync(600_000); win.dispatchEvent(new Event("focus"));
    win.dispatchEvent(new Event("online")); doc.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});
