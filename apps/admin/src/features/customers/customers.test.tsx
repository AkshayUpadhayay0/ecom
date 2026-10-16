import { screen, waitFor, within } from '@testing-library/react';
import type { AdminCustomerDetailDto, AdminCustomerSummaryDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333';

const SUMMARY: AdminCustomerSummaryDto = {
  id: CUSTOMER_ID,
  fullName: 'Ada Obi',
  email: 'ada@example.com',
  phone: '+2348000000000',
  status: 'active',
  emailVerified: true,
  orderCount: 1,
  paidTotalMinor: 2_750_000,
  createdAt: '2026-10-01T00:00:00.000Z',
  lastLoginAt: null,
};

const DETAIL: AdminCustomerDetailDto = {
  ...SUMMARY,
  preferredLanguage: 'en',
  lockedUntil: null,
  addresses: [
    {
      id: 'a-1',
      label: 'Home',
      recipientName: 'Ada Obi',
      phone: '+2348000000000',
      addressLine1: '1 Test Street',
      addressLine2: null,
      city: 'Lagos',
      state: 'Lagos',
      landmark: null,
      zoneName: 'SAMPLE zone A',
      isDefault: true,
    },
  ],
  orders: [
    {
      id: 'o-1',
      orderNumber: 'UI-2026-000123',
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      currency: 'NGN',
      totalMinor: 2_750_000,
      placedAt: '2026-10-02T00:00:00.000Z',
    },
  ],
};

/** Fields that must never be rendered even if an API bug ever sent them. */
const LEAKED = {
  passwordHash: '$argon2id$v=19$SECRET-HASH',
  refreshTokenHash: 'REFRESH-SECRET',
  emailVerificationToken: 'VERIFY-SECRET',
};

let listUrls: URL[] = [];
let statusBodies: unknown[] = [];

beforeEach(() => {
  apiState.hasSession = true;
  listUrls = [];
  statusBodies = [];
  server.use(
    http.get(`${API}/admin/customers`, ({ request }) => {
      listUrls.push(new URL(request.url));
      return HttpResponse.json(listOf([{ ...SUMMARY, ...LEAKED }]));
    }),
    http.get(`${API}/admin/customers/${CUSTOMER_ID}`, () =>
      HttpResponse.json({ data: { ...DETAIL, ...LEAKED } }),
    ),
    http.patch(`${API}/admin/customers/${CUSTOMER_ID}/status`, async ({ request }) => {
      statusBodies.push(await request.json());
      return HttpResponse.json({ data: { ...DETAIL, status: 'suspended' } });
    }),
  );
});

describe('customers', () => {
  it('searches and filters through the API and never shows secrets', async () => {
    const { user } = renderApp('/customers?status=active');
    expect(await screen.findByText('Ada Obi')).toBeInTheDocument();
    expect(listUrls[0]?.searchParams.get('status')).toBe('active');
    await user.type(screen.getByRole('searchbox', { name: 'Search customers' }), 'obi');
    await waitFor(() => expect(listUrls.at(-1)?.searchParams.get('q')).toBe('obi'));
    expect(document.body.textContent).not.toMatch(/SECRET/);
  });

  it('detail shows profile, addresses and orders without secrets', async () => {
    renderApp(`/customers/${CUSTOMER_ID}`);
    expect(await screen.findByRole('heading', { name: 'Ada Obi' })).toBeInTheDocument();
    expect(screen.getByText('UI-2026-000123')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/SECRET|argon2/);
  });

  it('suspending warns that sessions end and requires a reason', async () => {
    const { user } = renderApp(`/customers/${CUSTOMER_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Suspend customer' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/all their sessions end/);
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Chargeback fraud');
    await user.click(confirm);
    await waitFor(() =>
      expect(statusBodies[0]).toEqual({ status: 'suspended', reason: 'Chargeback fraud' }),
    );
  });

  it('a plain admin cannot suspend', async () => {
    apiState.role = 'admin';
    renderApp(`/customers/${CUSTOMER_ID}`);
    expect(await screen.findByRole('button', { name: 'Suspend customer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
