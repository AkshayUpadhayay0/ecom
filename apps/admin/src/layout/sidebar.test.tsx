import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const MAIN = [
  'Dashboard',
  'Orders',
  'Payment Review',
  'Returns',
  'Customers',
  'Products',
  'Inventory',
  'Content',
  'Delivery',
  'Settings',
];
const INTERNAL = ['Media Library', 'Sizes & Charts', 'QR Pages', 'Audit Log'];

async function navLinks(): Promise<string[]> {
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent.trim());
}

beforeEach(() => {
  apiState.hasSession = true;
});

describe('sidebar per role (decision 19 Oct 2026)', () => {
  it('a normal admin sees exactly the 10 client pages and no Internal group', async () => {
    apiState.role = 'admin';
    renderApp('/dashboard');
    expect(await navLinks()).toEqual(MAIN);
    expect(screen.queryByRole('heading', { name: 'Internal' })).not.toBeInTheDocument();
  });

  it('a super admin sees the 10 pages plus the Internal group below them', async () => {
    apiState.role = 'super_admin';
    renderApp('/dashboard');
    expect(await navLinks()).toEqual([...MAIN, ...INTERNAL]);
    const internal = screen.getByRole('heading', { name: 'Internal' }).closest('section');
    expect(internal).not.toBeNull();
    expect(
      within(internal ?? document.body)
        .getAllByRole('link')
        .map((l) => l.textContent.trim()),
    ).toEqual(INTERNAL);
  });

  it.each(['/media', '/sizes/charts', '/qr-pages', '/audit-log'])(
    'a normal admin opening %s directly sees the role message and no internal data is requested',
    async (path) => {
      apiState.role = 'admin';
      let internalRequests = 0;
      server.use(
        http.get(`${API}/admin/media`, () => {
          internalRequests += 1;
          return HttpResponse.json(emptyList());
        }),
        http.get(`${API}/admin/size-chart-groups`, () => {
          internalRequests += 1;
          return HttpResponse.json({ data: [] });
        }),
        http.get(`${API}/admin/hidden-pages`, () => {
          internalRequests += 1;
          return HttpResponse.json(emptyList());
        }),
        http.get(`${API}/admin/audit-logs`, () => {
          internalRequests += 1;
          return HttpResponse.json(emptyList());
        }),
      );
      renderApp(path);
      expect(await screen.findByText('Not available for your role')).toBeInTheDocument();
      expect(internalRequests).toBe(0);
    },
  );
});
