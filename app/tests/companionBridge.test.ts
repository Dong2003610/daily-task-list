import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ metadata: vi.fn(), patchMetadata: vi.fn() }));
vi.mock('../src/api', () => ({ api: mocks }));
import { activeFocus, createFocusBridge, reminderOwner } from '../src/companionBridge';
const user = 'test-user';
let meta: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks(); meta = {};
  mocks.metadata.mockImplementation(async () => structuredClone(meta));
  mocks.patchMetadata.mockImplementation(async (_user: string, patch: Record<string, unknown>) => { Object.assign(meta, structuredClone(patch)); return meta; });
});
it('uses the account notification channel and treats absent settings as web', () => {
  expect(reminderOwner({})).toBe('web'); expect(reminderOwner({ dtl_reminder_owner_v1: 'desktop' })).toBe('desktop');
});
it('blocks an active desktop timer before publishing any web claim', async () => {
  meta.dtl_focus_v1 = { client: 'desktop:one', owner: 'desktop', phase: 'running', expiresAt: Date.now() + 90000 };
  await expect(createFocusBridge(user).claim({ taskId: 'task' })).rejects.toThrow('桌宠');
  expect(mocks.patchMetadata).not.toHaveBeenCalled();
});
it('recovers from an expired client and serializes release before the next claim', async () => {
  meta.dtl_focus_v1 = { client: 'desktop:one', owner: 'desktop', phase: 'running', expiresAt: Date.now() - 1 };
  const bridge = createFocusBridge(user); await bridge.claim({ taskId: 'task' });
  expect(activeFocus(meta)?.owner).toBe('web');
  const release = bridge.release(); const claim = bridge.claim({ taskId: 'second' });
  await Promise.all([release, claim]); expect(activeFocus(meta)?.taskId).toBe('second');
});
it('cannot release another client and rejects a claim lost during verification', async () => {
  const bridge = createFocusBridge(user); await bridge.claim({ taskId: 'task' });
  meta.dtl_focus_v1 = { client: 'other', owner: 'desktop', phase: 'running', expiresAt: Date.now() + 90000 };
  await bridge.release(); expect(activeFocus(meta)?.client).toBe('other');
  meta = {}; mocks.patchMetadata.mockImplementation(async () => { meta.dtl_focus_v1 = { client: 'racing', owner: 'desktop', phase: 'running', expiresAt: Date.now() + 90000 }; return meta; });
  await expect(bridge.claim({ taskId: 'task' })).rejects.toThrow('另一端');
});
