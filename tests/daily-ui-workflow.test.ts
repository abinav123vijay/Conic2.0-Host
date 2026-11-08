import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const require = createRequire(`${process.cwd()}\\tests\\daily-ui-workflow.test.ts`);
require.extensions['.css'] = () => undefined;

test('daily entry UI supports submit, edit, confirmed delete, and refreshed rows', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'MutationObserver', 'getComputedStyle'] as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const key of globals) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === 'window' ? dom.window :
        key === 'document' ? dom.window.document :
        key === 'navigator' ? dom.window.navigator :
        key === 'HTMLElement' ? dom.window.HTMLElement :
        key === 'Node' ? dom.window.Node :
        key === 'MutationObserver' ? dom.window.MutationObserver :
        dom.window.getComputedStyle.bind(dom.window)
    });
  }
  const originalFetch = globalThis.fetch;
  const originalActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  type Entry = {
    _id: string;
    date: string;
    onlineSales: number;
    cashSales: number;
    expenses: Record<string, number>;
    expensePaidOnline: number;
    expensePaidCash: number;
    notes: string;
  };
  let rows: Entry[] = [];
  const calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method, body });

    if (url === '/api/daily' && method === 'GET') return Response.json(rows);
    if (url === '/api/settings') return Response.json({ expenseCategories: ['Food'] });
    if (url === '/api/auth/me') return Response.json({ role: 'owner' });
    if (url === '/api/daily' && method === 'POST') {
      rows = [{ ...body as unknown as Entry, _id: 'daily-ui-entry' }];
      return Response.json({ id: 'daily-ui-entry' });
    }
    if (url === '/api/daily/daily-ui-entry' && method === 'PATCH') {
      rows = [{ ...rows[0], ...body as Partial<Entry> }];
      return Response.json({ ok: true });
    }
    if (url === '/api/daily/daily-ui-entry' && method === 'DELETE') {
      rows = [];
      return Response.json({ ok: true });
    }
    return Response.json({ error: `Unexpected request: ${method} ${url}` }, { status: 500 });
  };

  try {
    const { render, screen, fireEvent, waitFor } = await import('@testing-library/react');
    const { createElement } = await import('react');
    const { default: DailyPage } = await import('../app/entries/daily/page');
    const view = render(createElement(DailyPage));

    await screen.findByRole('heading', { name: 'Daily Entries' });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-08' } });
    fireEvent.change(screen.getByLabelText('Online Sales'), { target: { value: '1200' } });
    fireEvent.change(screen.getByLabelText('Cash Sales'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Food'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Daily Salary'), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText('Expense Paid Online'), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText('Expense Paid Cash'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Opening entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Daily Entry' }));
    await screen.findByText('Opening entry');
    assert.equal(calls.find(call => call.method === 'POST')?.body?.onlineSales, 1200);
    assert.equal((calls.find(call => call.method === 'POST')?.body?.expenses as Record<string, number>).Salary, 50);

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Online Sales'), { target: { value: '1400' } });
    fireEvent.change(screen.getByLabelText('Daily Salary'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Edited entry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await screen.findByText('Edited entry');
    assert.equal(calls.find(call => call.method === 'PATCH')?.body?.onlineSales, 1400);
    assert.equal((calls.find(call => call.method === 'PATCH')?.body?.expenses as Record<string, number>).Salary, 75);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry' }));
    await waitFor(() => assert.equal(screen.queryByText('Edited entry'), null));
    assert.ok(calls.some(call => call.method === 'DELETE' && call.url === '/api/daily/daily-ui-entry'));
    assert.equal(rows.length, 0);
    await new Promise(resolve => setTimeout(resolve, 0));
    view.unmount();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of globals) {
      const descriptor = originals.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    if (originalActEnvironment === undefined) delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
    else (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = originalActEnvironment;
    dom.window.close();
  }
});
