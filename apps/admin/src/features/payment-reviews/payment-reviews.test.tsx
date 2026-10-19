import { screen, waitFor, within } from '@testing-library/react';
import type { PaymentReviewDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';

const REVIEW: PaymentReviewDto = {
  paymentId: PAYMENT_ID,
  reference: 'UI-REF-77',
  reason: 'AMOUNT_MISMATCH',
  paymentStatus: 'needs_review',
  order: {
    id: 'o-1',
    orderNumber: 'UI-2026-000777',
    orderStatus: 'payment_review',
    paymentStatus: 'unpaid',
    totalMinor: 2_000_000,
    currency: 'NGN',
  },
  customer: { id: 'c-1', fullName: 'Ada Obi', email: 'ada@example.com' },
  receivedAmountMinor: 1_500_000,
  receivedCurrency: 'NGN',
  refundOwedMinor: null,
  open: true,
  createdAt: '2026-10-15T10:00:00.000Z',
  resolutions: [],
};

let listUrls: URL[] = [];
let resolveBodies: unknown[] = [];

beforeEach(() => {
  apiState.hasSession = true;
  listUrls = [];
  resolveBodies = [];
  server.use(
    http.get(`${API}/admin/payment-reviews`, ({ request }) => {
      listUrls.push(new URL(request.url));
      return HttpResponse.json(listOf([REVIEW]));
    }),
    http.post(`${API}/admin/payment-reviews/${PAYMENT_ID}/resolve`, async ({ request }) => {
      resolveBodies.push(await request.json());
      return HttpResponse.json({ data: { ...REVIEW, open: false } });
    }),
  );
});

describe('payment review queue', () => {
  it('shows reason, amounts and the manual-refund statement; open items by default', async () => {
    renderApp('/payment-reviews');
    expect(await screen.findByText('UI-2026-000777')).toBeInTheDocument();
    expect(screen.getByText(/amount received is different/)).toBeInTheDocument();
    expect(screen.getByText(/₦15,000\.00 NGN/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is refunded automatically/)).toBeInTheDocument();
    expect(listUrls[0]?.searchParams.get('state')).toBe('open');
  });

  it('requires a note before fulfilling', async () => {
    const { user } = renderApp('/payment-reviews');
    await user.click(await screen.findByRole('button', { name: 'Fulfil order' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Fulfil order' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Customer topped up');
    await user.click(confirm);
    await waitFor(() =>
      expect(resolveBodies[0]).toEqual({ action: 'FULFIL', note: 'Customer topped up' }),
    );
  });

  it('records a refund owed in kobo, capped at the amount received', async () => {
    const { user } = renderApp('/payment-reviews');
    await user.click(await screen.findByRole('button', { name: 'Mark refund required' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByRole('textbox', { name: /Refund owed/ });
    await user.clear(amount);
    await user.type(amount, '20000');
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Refund all');
    expect(within(dialog).getByRole('button', { name: 'Mark refund required' })).toBeDisabled();
    await user.clear(amount);
    await user.type(amount, '15000');
    await user.click(within(dialog).getByRole('button', { name: 'Mark refund required' }));
    await waitFor(() =>
      expect(resolveBodies[0]).toEqual({
        action: 'MARK_REFUND_REQUIRED',
        note: 'Refund all',
        amountMinor: 1_500_000,
      }),
    );
  });

  it('a plain admin (client staff) can resolve, with the note still required', async () => {
    apiState.role = 'admin';
    const { user } = renderApp('/payment-reviews');
    const fulfil = await screen.findByRole('button', { name: 'Fulfil order' });
    expect(fulfil).not.toHaveAttribute('aria-disabled');
    await user.click(fulfil);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Fulfil order' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Approved by staff');
    await user.click(within(dialog).getByRole('button', { name: 'Fulfil order' }));
    await waitFor(() =>
      expect(resolveBodies[0]).toEqual({ action: 'FULFIL', note: 'Approved by staff' }),
    );
  });
});
