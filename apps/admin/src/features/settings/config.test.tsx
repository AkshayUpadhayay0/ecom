import { screen, waitFor, within } from '@testing-library/react';
import type { AdminHiddenPageDto, DeliveryZoneDto, SettingDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const ZONE: DeliveryZoneDto = {
  id: 'z-1',
  code: 'sample-a',
  name: 'SAMPLE zone A',
  feeMinor: null,
  estDaysMin: null,
  estDaysMax: null,
  isActive: false,
  isSampleData: true,
  sortOrder: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const SETTINGS: SettingDto[] = [
  {
    key: 'catalog.page_size',
    value: null,
    defaultValue: 20,
    description: 'Products per page',
    updatedAt: null,
    updatedBy: null,
  },
  {
    key: 'support.email',
    value: null,
    defaultValue: null,
    description: 'Pending',
    updatedAt: null,
    updatedBy: null,
  },
];
const PAGE: AdminHiddenPageDto = {
  id: 'hp-1',
  slotNumber: 1,
  slug: 'page-one',
  routeToken: 'tok123',
  publicUrl: 'http://localhost:3000/q/tok123',
  exclusiveOnly: false,
  isPublished: true,
  tokenLockedAt: null,
  title: 'Placeholder',
  body: 'Text',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const calls: { method: string; url: string; body: unknown; contentType: string | null }[] = [];

async function record(request: Request) {
  const contentType = request.headers.get('content-type');
  const text = await request.text();
  calls.push({
    method: request.method,
    url: request.url,
    body: contentType?.includes('json') ? (JSON.parse(text) as unknown) : text,
    contentType,
  });
}

beforeEach(() => {
  apiState.hasSession = true;
  calls.length = 0;
  server.use(
    http.get(`${API}/admin/delivery-zones`, () => HttpResponse.json(listOf([ZONE]))),
    http.post(`${API}/admin/delivery-zones`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ data: { ...ZONE, id: 'z-2' } }, { status: 201 });
    }),
    http.get(`${API}/admin/settings`, () => HttpResponse.json({ data: SETTINGS })),
    http.patch(`${API}/admin/settings/:key`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({ data: SETTINGS[0] });
    }),
    http.get(`${API}/admin/hidden-pages`, () => HttpResponse.json(listOf([PAGE]))),
    http.get(`${API}/admin/serial-batches`, () => HttpResponse.json(emptyList())),
    http.post(`${API}/admin/serial-imports`, async ({ request }) => {
      await record(request);
      return HttpResponse.json({
        data: {
          batchId: null,
          dryRun: true,
          totalRows: 2,
          imported: 2,
          byCategory: { GENERAL: 1, EXCLUSIVE: 1 },
          duplicates: [],
          invalid: [],
        },
      });
    }),
  );
});

describe('delivery zones', () => {
  it('marks SAMPLE zones and creates a zone with the fee in kobo', async () => {
    const { user } = renderApp('/delivery');
    expect(await screen.findByText('SAMPLE zone A')).toBeInTheDocument();
    expect(screen.getByText('SAMPLE')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New zone' }));
    const dialog = await screen.findByRole('dialog', { name: 'New delivery zone' });
    await user.type(within(dialog).getByRole('textbox', { name: /Code/ }), 'lagos-mainland');
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Lagos Mainland');
    await user.type(within(dialog).getByRole('textbox', { name: /Delivery fee/ }), '2500');
    await user.click(within(dialog).getByRole('button', { name: 'Create zone' }));
    await waitFor(() =>
      expect(calls[0]?.body).toMatchObject({
        code: 'lagos-mainland',
        name: 'Lagos Mainland',
        feeMinor: 250_000,
        isActive: false,
      }),
    );
  });
});

describe('settings', () => {
  it('shows pending values and lets a super admin save a typed value', async () => {
    const { user } = renderApp('/settings');
    expect(await screen.findByText('catalog.page_size')).toBeInTheDocument();
    expect(screen.getAllByText('Not provided')).toHaveLength(2);
    expect(screen.getByText(/using default 20/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0] ?? document.body);
    const dialog = await screen.findByRole('dialog', { name: /Edit catalog.page_size/ });
    const input = within(dialog).getByRole('spinbutton', { name: /Value/ });
    await user.clear(input);
    await user.type(input, '24');
    await user.click(within(dialog).getByRole('button', { name: 'Save setting' }));
    await waitFor(() => expect(calls[0]).toMatchObject({ method: 'PATCH', body: { value: 24 } }));
    expect(calls[0]?.url).toContain('/admin/settings/catalog.page_size');
  });

  it('a plain admin can edit contact settings only; sensitive ones are greyed out', async () => {
    apiState.role = 'admin';
    renderApp('/settings');
    await screen.findByText('catalog.page_size');
    const [pageSize, supportEmail] = screen.getAllByRole('button', { name: 'Edit' });
    expect(pageSize).toHaveAttribute('aria-disabled', 'true');
    expect(supportEmail).not.toHaveAttribute('aria-disabled');
  });
});

describe('QR pages and serials', () => {
  it('imports a CSV as text/csv (check only) and never shows serial values', async () => {
    const { user } = renderApp('/qr-pages');
    expect(await screen.findByText('Placeholder')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:3000/q/tok123')).toBeInTheDocument();
    // Developers (super_admin) apply the client's write-ups.
    expect(screen.getByRole('button', { name: 'Edit content' })).toBeInTheDocument();
    const csv = new File(
      ['serial,category,pageSlot\nGEN-SECRET-1,GENERAL,1\nEXC-SECRET-2,EXCLUSIVE,\n'],
      'serials.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText(/CSV file/), csv);
    await user.click(screen.getByRole('button', { name: 'Check only' }));
    expect(await screen.findByText(/Check only \(nothing saved\)/)).toBeInTheDocument();
    expect(calls[0]?.contentType).toContain('text/csv');
    expect(calls[0]?.url).toContain('dryRun=true');
    expect(document.body.textContent).not.toMatch(/GEN-SECRET-1|EXC-SECRET-2/);
  });

  it('QR Pages is internal: a plain admin gets the role message and no pages or batches', async () => {
    apiState.role = 'admin';
    let requests = 0;
    server.use(
      http.get(`${API}/admin/serial-batches`, () => {
        requests += 1;
        return HttpResponse.json(emptyList());
      }),
      http.get(`${API}/admin/hidden-pages`, () => {
        requests += 1;
        return HttpResponse.json(emptyList());
      }),
    );
    renderApp('/qr-pages');
    expect(await screen.findByText('Not available for your role')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit content' })).not.toBeInTheDocument();
    expect(requests).toBe(0);
  });
});

describe('audit log', () => {
  it('a plain admin sees the role message and no request is made', async () => {
    apiState.role = 'admin';
    let requests = 0;
    server.use(
      http.get(`${API}/admin/audit-logs`, () => {
        requests += 1;
        return HttpResponse.json(emptyList());
      }),
    );
    renderApp('/audit-log');
    expect(await screen.findByText('Not available for your role')).toBeInTheDocument();
    expect(requests).toBe(0);
  });

  it('sends the filters from the URL', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(`${API}/admin/audit-logs`, ({ request }) => {
        urls.push(new URL(request.url));
        return HttpResponse.json(emptyList());
      }),
    );
    renderApp('/audit-log?entityType=order&action=order.status_change');
    expect(await screen.findByText('No audit entries')).toBeInTheDocument();
    expect(urls[0]?.searchParams.get('entityType')).toBe('order');
    expect(urls[0]?.searchParams.get('action')).toBe('order.status_change');
  });

  it('explains when the role cannot see it (403)', async () => {
    server.use(
      http.get(`${API}/admin/audit-logs`, () =>
        errorResponse(403, 'FORBIDDEN', 'Your admin role cannot perform this action.'),
      ),
    );
    renderApp('/audit-log');
    expect(await screen.findByText('Not available for your role')).toBeInTheDocument();
  });
});
