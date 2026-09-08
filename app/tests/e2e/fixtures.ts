import {test as base, expect, type Page, type Route} from '@playwright/test';
import type {Metadata, Task} from '../../src/types';
import {NOW, seedTasks, TODAY, USER_ID} from '../factories';

const APP_ORIGIN = 'http://127.0.0.1:4173';
const BACKEND_HOST = 'backend.appmiaoda.com';
const jwtPart = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
export const FAKE_ACCESS_TOKEN = `${jwtPart({alg: 'HS256', typ: 'JWT'})}.${jwtPart({sub: USER_ID, aud: 'authenticated', role: 'authenticated', exp: 4102444800})}.${Buffer.from('test-only-fake-signature').toString('base64url')}`;

type RequestRecord = {method: string; path: string; query: string; body: unknown};
type Failure = {method: string; suffix: string; message: string};

/** A per-test database shared by that test's tabs; no network-backed client. */
export class MockBackend {
  tasks = seedTasks();
  metadata: Metadata = {dtl_carry_prompt_v2: TODAY, profile_label: 'unchanged account setting'};
  requests: RequestRecord[] = [];
  unexpected: string[] = [];
  blockedExternal: string[] = [];
  // Deterministically model another device's change between insertion and the
  // application's post-insert metadata read, without timing-dependent sleeps.
  afterNextTaskInsert?: (inserted: Task[]) => void;
  loseNextTaskInsertResponse = false;
  loseNextTaskDeleteResponse = false;
  private failures: Failure[] = [];

  failNext(method: string, suffix: string, message = '测试保存失败，请重试') {
    this.failures.push({method, suffix, message});
  }

  user() {
    return {
      id: USER_ID, aud: 'authenticated', role: 'authenticated',
      email: 'isolated-test@example.invalid', app_metadata: {provider: 'email', providers: ['email']},
      user_metadata: structuredClone(this.metadata), identities: [],
      created_at: '2026-01-01T00:00:00Z', confirmed_at: '2026-01-01T00:00:00Z',
    };
  }

  taskRequests(method: string) { return this.requests.filter(r => r.method === method && r.path.endsWith('/rest/v1/tasks')); }

  async handle(route: Route) {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    let body: unknown = null;
    if (request.postData()) {
      try { body = request.postDataJSON(); } catch { body = request.postData(); }
    }
    this.requests.push({method, path: url.pathname, query: url.search, body});
    const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({status, contentType: 'application/json', headers, body: JSON.stringify(data)});
    const error = (message: string, status = 503) => json({code: 'TEST_BACKEND_ERROR', message, details: null, hint: null}, status);
    if (method === 'OPTIONS') return route.fulfill({status: 204, headers: {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,PUT,POST,PATCH,DELETE,OPTIONS'}});
    const failed = this.failures.findIndex(f => f.method === method && url.pathname.endsWith(f.suffix));
    if (failed >= 0) return error(this.failures.splice(failed, 1)[0].message);

    if (url.pathname.endsWith('/auth/v1/user') && (method === 'GET' || method === 'PUT')) {
      if (method === 'PUT') {
        const update = body as {data?: Metadata};
        this.metadata = {...this.metadata, ...structuredClone(update.data || {})};
      }
      return json(this.user());
    }
    if (!url.pathname.endsWith('/rest/v1/tasks')) {
      this.unexpected.push(`${method} ${url.pathname}`);
      return error('Unmocked endpoint blocked; no external request was sent');
    }

    const matches = (row: Task) => [...url.searchParams].every(([field, filter]) => {
      const separator = filter.indexOf('.');
      const operator = filter.slice(0, separator), operand = filter.slice(separator + 1);
      const value = row[field as keyof Task], actual = String(value);
      if (operator === 'eq') return actual === operand;
      if (operator === 'in') return operand.slice(1, -1).split(',').map(item => item.replace(/^"|"$/g, '')).includes(actual);
      const left = typeof value === 'number' ? value : actual;
      const right = typeof value === 'number' ? Number(operand) : operand;
      if (operator === 'gt') return left > right;
      if (operator === 'gte') return left >= right;
      if (operator === 'lt') return left < right;
      if (operator === 'lte') return left <= right;
      return true;
    });
    const single = request.headers().accept?.includes('application/vnd.pgrst.object+json');
    const result = (rows: Task[], status = 200) => single
      ? rows.length === 1 ? json(rows[0], status) : error('Expected exactly one task', 406)
      : json(rows, status);

    if (method === 'GET') {
      let rows = this.tasks.filter(matches).map(row => ({...row}));
      const ordering = url.searchParams.get('order');
      if (ordering) rows.sort((a, b) => {
        for (const part of ordering.split(',')) {
          const [column, direction] = part.split('.');
          const left = a[column as keyof Task], right = b[column as keyof Task];
          const comparison = left === right ? 0 : left == null ? -1 : right == null ? 1 : left < right ? -1 : 1;
          if (comparison) return direction === 'desc' ? -comparison : comparison;
        }
        return 0;
      });
      const range = request.headers().range?.match(/(?:items=)?(\d+)-(\d+)/);
      const offset = Number(url.searchParams.get('offset') ?? range?.[1] ?? 0);
      const limit = Number(url.searchParams.get('limit') ?? (range ? Number(range[2]) - offset + 1 : rows.length));
      const total = rows.length;
      rows = rows.slice(offset, offset + limit);
      if (single) return result(rows);
      return json(rows, 200, {'content-range': rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`});
    }
    if (method === 'POST') {
      const rows = (Array.isArray(body) ? body : [body]) as Task[];
      if (rows.some(row => !row?.id || row.user_id !== USER_ID)) {
        this.unexpected.push('Attempt to write an invalid/foreign task');
        return error('Test ownership check failed', 403);
      }
      const ignoreDuplicates = request.headers().prefer?.includes('resolution=ignore-duplicates');
      if (!ignoreDuplicates && rows.some(row => this.tasks.some(existing => existing.id === row.id))) {
        return json({code: '23505', message: 'duplicate key value violates tasks primary key', details: null, hint: null}, 409);
      }
      const inserted: Task[] = [];
      for (const row of rows) {
        if (this.tasks.some(existing => existing.id === row.id)) continue;
        const saved = structuredClone(row);
        this.tasks.push(saved); inserted.push(saved);
      }
      const afterInsert = this.afterNextTaskInsert;
      this.afterNextTaskInsert = undefined;
      afterInsert?.(inserted);
      if (this.loseNextTaskInsertResponse) {
        this.loseNextTaskInsertResponse = false;
        return route.abort('failed');
      }
      return result(inserted, 201);
    }
    if (method === 'PATCH' || method === 'DELETE') {
      if (!url.searchParams.has('id') || url.searchParams.get('user_id') !== `eq.${USER_ID}`) {
        this.unexpected.push(`${method} without explicit task and owner filters`);
        return error('Unscoped mutation blocked', 403);
      }
      const rows = this.tasks.filter(matches);
      if (method === 'PATCH') {
        for (const row of rows) Object.assign(row, structuredClone(body));
        return result(rows);
      }
      this.tasks = this.tasks.filter(row => !matches(row));
      if (this.loseNextTaskDeleteResponse) {
        this.loseNextTaskDeleteResponse = false;
        return route.abort('failed');
      }
      return route.fulfill({status: 204});
    }
    this.unexpected.push(`${method} ${url.pathname}`);
    return error('Unmocked method blocked');
  }
}

export const test = base.extend<{backend: MockBackend}>({
  backend: [async ({context}, use) => {
    const backend = new MockBackend();
    // This single allowlist runs for all pages and popups, before app navigation.
    // Unknown backend routes fail closed; fonts and every other host are aborted.
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.hostname === BACKEND_HOST) return backend.handle(route);
      if (url.origin === APP_ORIGIN) return route.continue();
      backend.blockedExternal.push(url.href);
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket(/.*/, socket => {
      const url = new URL(socket.url());
      if (url.hostname === '127.0.0.1' && url.port === '4173') socket.connectToServer();
      else { backend.blockedExternal.push(url.href); socket.close(); }
    });
    await context.addInitScript(({token, user}) => {
      if (location.origin !== 'http://127.0.0.1:4173') return;
      if (!localStorage.getItem('sb-backend-auth-token')) localStorage.setItem('sb-backend-auth-token', JSON.stringify({
        access_token: token, refresh_token: 'test-only-not-a-real-refresh-token',
        token_type: 'bearer', expires_in: 86400, expires_at: 4102444800, user,
      }));
    }, {token: FAKE_ACCESS_TOKEN, user: backend.user()});
    await use(backend);
    expect(backend.unexpected, 'No unmocked backend endpoint or unscoped mutation is allowed').toEqual([]);
  }, {auto: true}],
});

export {expect};

export async function openApp(page: Page, options: {keepClock?: boolean} = {}) {
  if (!options.keepClock) await page.clock.setFixedTime(new Date(NOW));
  await page.goto('/');
  await expect(page.getByRole('heading', {name: '每日任务清单', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: '刷新同步'})).toBeEnabled();
  await expect(page.locator('.sync-status')).toHaveText('已同步');
}

export function card(page: Page, name: string) {
  return page.getByTestId('task-card').filter({has: page.getByRole('heading', {name, exact: true})});
}
