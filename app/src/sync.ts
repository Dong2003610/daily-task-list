export interface RowVersion { id: string; updated_at?: string | null }

// Includes IDs so hard deletes on another device are detected without tombstones.
// Compare opaque server timestamps; never use the client's clock as a data cursor.
export async function syncRows<T extends RowVersion>(
  previous: T[],
  loadVersions: () => Promise<RowVersion[]>,
  loadChanged: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  const versions = await loadVersions();
  const known = new Map(previous.map((row) => [row.id, row]));
  const changed = versions.filter((row) => !row.updated_at || row.updated_at !== known.get(row.id)?.updated_at);
  const loaded = new Map<string, T>();
  for (let index = 0; index < changed.length; index += 100) {
    const rows = await loadChanged(changed.slice(index, index + 100).map((row) => row.id));
    for (const row of rows) loaded.set(row.id, row);
  }
  const changedIds = new Set(changed.map((row) => row.id));
  // A row deleted between the version check and the detail fetch stays deleted.
  return versions.flatMap(({ id }) => {
    const row = changedIds.has(id) ? loaded.get(id) : known.get(id);
    return row ? [row] : [];
  });
}

export const ACTIVE_SYNC_MS = 60_000;
export const IDLE_SYNC_MS = 300_000;
export const IDLE_AFTER_MS = 120_000;
const WAKE_THROTTLE_MS = 30_000;

/** Background reads only. Writes and the explicit refresh button bypass this. */
export function startAutoSync(refresh: () => Promise<boolean | void>): () => void {
  let lastAttempt = Date.now(), lastActivity = Date.now();
  let failures = 0, retryAt = 0, running = false, disposed = false;
  const activity = () => { lastActivity = Date.now(); };
  const check = async (wake: boolean) => {
    const now = Date.now();
    if (disposed || running || !navigator.onLine || document.visibilityState !== "visible") return;
    const interval = wake ? WAKE_THROTTLE_MS : now - lastActivity >= IDLE_AFTER_MS ? IDLE_SYNC_MS : ACTIVE_SYNC_MS;
    if (now < retryAt || now - lastAttempt < interval) return;
    lastAttempt = now; running = true;
    try {
      const result = await refresh();
      failures = result === false ? failures + 1 : 0;
    } catch { failures++; }
    finally {
      retryAt = failures ? Date.now() + Math.min(IDLE_SYNC_MS, ACTIVE_SYNC_MS * 2 ** (failures - 1)) : 0;
      running = false;
    }
  };
  const wake = () => { activity(); void check(true); };
  const visibility = () => { if (document.visibilityState === "visible") wake(); };
  const poll = window.setInterval(() => void check(false), 15_000);
  for (const event of ["pointerdown", "keydown", "wheel"]) window.addEventListener(event, activity, { passive: true });
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", visibility);
  return () => {
    disposed = true; window.clearInterval(poll);
    for (const event of ["pointerdown", "keydown", "wheel"]) window.removeEventListener(event, activity);
    window.removeEventListener("focus", wake); window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", visibility);
  };
}
