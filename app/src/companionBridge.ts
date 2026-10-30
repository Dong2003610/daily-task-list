import { api } from './api';
import type { Metadata } from './types';

export interface FocusLease {
  client: string; owner: 'web' | 'desktop'; phase: string; expiresAt: number;
  taskId?: string; name?: string; seconds?: number; remaining?: number;
}
export function activeFocus(metadata: Metadata, now = Date.now()): FocusLease | undefined {
  const value = metadata.dtl_focus_v1 as FocusLease | null;
  return value && typeof value.client === 'string' && value.phase === 'running' && typeof value.expiresAt === 'number' && value.expiresAt > now ? value : undefined;
}
export const reminderOwner = (metadata: Metadata): 'desktop' | 'web' => metadata.dtl_reminder_owner_v1 === 'desktop' ? 'desktop' : 'web';

// Bounded heartbeat: a crashed client cannot block the account indefinitely.
// Serial release/claim prevents an old pause request from releasing a new round.
export function createFocusBridge(userId: string) {
  const client = `web:${crypto.randomUUID()}`; let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> { const result = queue.then(run); queue = result.catch(() => {}); return result; }
  return {
    claim: (input: Pick<FocusLease, 'taskId' | 'name' | 'seconds' | 'remaining'>) => serial(async () => {
      const current = activeFocus(await api.metadata(userId));
      if (current && current.client !== client) throw new Error(`已有${current.owner === 'desktop' ? '桌宠' : '另一网页'}正在专注，请先在那里暂停或结束。`);
      const lease: FocusLease = { ...input, client, owner: 'web', phase: 'running', expiresAt: Date.now() + 90000 };
      await api.patchMetadata(userId, { dtl_focus_v1: lease });
      const verified = activeFocus(await api.metadata(userId));
      if (verified?.client !== client) throw new Error('另一端刚刚开始了专注，请刷新后重试。');
    }),
    release: () => serial(async () => {
      const meta = await api.metadata(userId);
      if ((meta.dtl_focus_v1 as FocusLease | null)?.client === client) await api.patchMetadata(userId, { dtl_focus_v1: null });
    }),
  };
}
