import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {USER_ID} from './factories';

const mocks = vi.hoisted(() => ({getUser: vi.fn(), getSession: vi.fn(), fetch: vi.fn()}));
vi.mock('../src/client', () => ({
  supabase: {auth: {getUser: mocks.getUser, getSession: mocks.getSession}},
  url: 'https://backend.appmiaoda.com/test-only', anon: 'not-a-real-api-key',
}));
import {api} from '../src/api';

const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const token = 'synthetic-token-for-unit-tests';
const userResult = (id = USER_ID, metadata: Record<string, unknown> = {}) => ({data: {user: {id, user_metadata: metadata}}, error: null});
const sessionResult = (id = USER_ID, access_token = token) => ({data: {session: {user: {id}, access_token}}, error: null});

beforeEach(() => {
  vi.resetAllMocks();
  // Both client auth and direct fetch are mocked before any API function runs.
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.getUser.mockResolvedValue(userResult());
  mocks.getSession.mockResolvedValue(sessionResult());
});
afterEach(() => vi.unstubAllGlobals());

describe('metadata account binding', () => {
  it('rejects metadata for a different user before returning settings or writing', async () => {
    mocks.getUser.mockResolvedValue(userResult(OTHER_USER, {dtl_private: 'other account'}));
    await expect(api.metadata(USER_ID)).rejects.toThrow('账号已切换');
    await expect(api.patchMetadata(USER_ID, {dtl_setting: true})).rejects.toThrow('账号已切换');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('cancels a write if the session changes after verifying user metadata', async () => {
    mocks.getSession.mockResolvedValue(sessionResult(OTHER_USER, 'other-account-token'));
    await expect(api.patchMetadata(USER_ID, {dtl_setting: true})).rejects.toThrow('账号已切换');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('sends only the patch with the captured verified token and returns merged metadata', async () => {
    const previous = {dtl_existing: true, profile: 'x'.repeat(10_000)};
    const patch = {dtl_carry_prompt_v2: '2026-09-08'};
    mocks.getUser.mockResolvedValue(userResult(USER_ID, previous));
    mocks.fetch.mockImplementation(async () => {
      // A later account switch must not change this already constructed request.
      mocks.getSession.mockResolvedValue(sessionResult(OTHER_USER, 'other-account-token'));
      return new Response(JSON.stringify({id: USER_ID, user_metadata: {...previous, ...patch}}));
    });
    await expect(api.patchMetadata(USER_ID, patch)).resolves.toEqual({...previous, ...patch});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://backend.appmiaoda.com/test-only/auth/v1/user');
    expect(request.method).toBe('PUT');
    expect(new Headers(request.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(JSON.parse(request.body as string)).toEqual({data: patch});
  });

  it('rejects a mismatched user in the PUT response', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({id: OTHER_USER, user_metadata: {dtl_setting: true}})));
    await expect(api.patchMetadata(USER_ID, {dtl_setting: true})).rejects.toThrow('账号验证失败');
  });

  it('propagates failed metadata writes instead of returning success', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({message: 'mock metadata write failed'}), {status: 503}));
    await expect(api.patchMetadata(USER_ID, {dtl_setting: true})).rejects.toThrow('mock metadata write failed');
  });
});

describe('metadata storage budget', () => {
  it('counts merged app settings in UTF-8 bytes and blocks oversized writes before fetch', async () => {
    mocks.getUser.mockResolvedValue(userResult(USER_ID, {dtl_existing: 'x'.repeat(5000)}));
    // 400 Han characters occupy 1,200 UTF-8 bytes, though only 400 JS code units.
    await expect(api.patchMetadata(USER_ID, {dtl_new: '中'.repeat(400)})).rejects.toThrow('设置空间已满');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
