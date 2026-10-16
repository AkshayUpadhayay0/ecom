import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AdminReturnDetailDto, AdminReturnSummaryDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';
import { evidenceRefreshDelay } from './EvidenceGallery';

const RETURN_ID = '44444444-4444-4444-8444-444444444444';
const BANNER =
  'Refunds are not processed by this system yet. Return policy values are pending client confirmation.';

const SUMMARY: AdminReturnSummaryDto = {
  id: RETURN_ID,
  requestNumber: 'RR-2026-000042',
  status: 'UNDER_REVIEW',
  requestType: 'EXCHANGE',
  reasonCode: 'does_not_fit',
  quantity: 1,
  responsibility: 'REVIEW_REQUIRED',
  faultCause: null,
  payer: 'UNDECIDED',
  order: { id: 'o-1', orderNumber: 'UI-2026-000123' },
  customer: { id: 'c-1', fullName: 'Ada Obi', email: 'ada@example.com' },
  product: { name: 'Adire Kaftan', sku: 'ADK-M', sizeLabel: 'M' },
  submittedAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
};

function detail(overrides: Partial<AdminReturnDetailDto> = {}): AdminReturnDetailDto {
  return {
    ...SUMMARY,
    explanation: 'Too tight on the chest.',
    policy: null,
    conditionConfirmations: { originalTags: null, unwornUnwashed: null },
    item: {
      orderItemId: 'oi-1',
      productId: 'p-1',
      variantId: 'v-1',
      productName: 'Adire Kaftan',
      sku: 'ADK-M',
      sizeLabel: 'M',
      purchasedQuantity: 1,
      unitPriceMinor: 2_500_000,
    },
    orderDetails: {
      status: 'delivered',
      paymentStatus: 'paid',
      deliveredAt: '2026-10-12T10:00:00.000Z',
      currency: 'NGN',
    },
    blueprint: {
      decisionId: 'd-1',
      method: 'MANUAL_MEASUREMENTS',
      selectionMode: 'OVERRIDE',
      fitPreference: 'STANDARD',
      recommendedSize: 'L',
      selectedSize: 'M',
      charts: [{ group: 'male_top', version: 1 }],
      measurements: [{ code: 'chest', label: 'Chest', valueInches: 42, requiredSize: 'L' }],
    },
    responsibilityDetails: {
      setBy: 'SYSTEM',
      setAt: null,
      basis: 'does_not_fit_no_blueprint_decision',
    },
    adminDecision: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    exchange: {
      sizeId: 's-l',
      sizeLabel: 'L',
      replacementVariantId: 'v-2',
      replacementSku: 'ADK-L',
      reservationStatus: null,
      carrier: null,
      trackingReference: null,
      sentAt: null,
    },
    inspection: null,
    evidence: [
      {
        id: 'ev-1',
        mimeType: 'image/jpeg',
        status: 'ready',
        url: 'http://localhost:4000/media/private/ev-1?sig=first',
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    ],
    timeline: [
      {
        id: 'e-1',
        type: 'CREATED',
        fromStatus: null,
        toStatus: 'SUBMITTED',
        visibility: 'CUSTOMER',
        note: 'Customer request',
        actor: { type: 'CUSTOMER', id: 'c-1', name: 'Ada Obi' },
        createdAt: '2026-10-15T10:00:00.000Z',
      },
      {
        id: 'e-2',
        type: 'NOTE',
        fromStatus: null,
        toStatus: null,
        visibility: 'INTERNAL',
        note: 'Checked photos internally',
        actor: { type: 'ADMIN', id: 'a-1', name: 'Bisi Adewale' },
        createdAt: '2026-10-15T11:00:00.000Z',
      },
    ],
    allowedTransitions: [
      { toStatus: 'APPROVED', requiresReason: false, requiresInspection: false },
      { toStatus: 'REJECTED', requiresReason: true, requiresInspection: false },
      { toStatus: 'AWAITING_CUSTOMER', requiresReason: true, requiresInspection: false },
    ],
    refund: { executed: false, policy: 'PENDING_CLIENT_DECISION' },
    closedAt: null,
    ...overrides,
  };
}

let listUrls: URL[] = [];
let posts: { path: string; body: unknown }[] = [];
let detailRequests = 0;

beforeEach(() => {
  apiState.hasSession = true;
  listUrls = [];
  posts = [];
  detailRequests = 0;
  const record =
    (path: string) =>
    async ({ request }: { request: Request }) => {
      posts.push({ path, body: await request.json() });
      return HttpResponse.json({ data: detail() });
    };
  server.use(
    http.get(`${API}/admin/returns`, ({ request }) => {
      listUrls.push(new URL(request.url));
      return HttpResponse.json(listOf([SUMMARY]));
    }),
    http.get(`${API}/admin/returns/${RETURN_ID}`, () => {
      detailRequests += 1;
      return HttpResponse.json({ data: detail() });
    }),
    http.post(`${API}/admin/returns/${RETURN_ID}/approve`, record('approve')),
    http.post(`${API}/admin/returns/${RETURN_ID}/reject`, record('reject')),
    http.patch(`${API}/admin/returns/${RETURN_ID}/responsibility`, record('responsibility')),
  );
});

describe('returns list', () => {
  it('shows the refund banner and sends filters and search to the API', async () => {
    const { user } = renderApp('/returns?open=true&responsibility=REVIEW_REQUIRED');
    expect(await screen.findByText('RR-2026-000042')).toBeInTheDocument();
    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(listUrls[0]?.searchParams.get('open')).toBe('true');
    expect(listUrls[0]?.searchParams.get('responsibility')).toBe('REVIEW_REQUIRED');
    await user.type(screen.getByRole('searchbox', { name: 'Search returns' }), 'RR-2026');
    await waitFor(() => expect(listUrls.at(-1)?.searchParams.get('q')).toBe('RR-2026'));
  });
});

describe('return review', () => {
  it('shows Blueprint, evidence, split timeline and only the allowed actions', async () => {
    renderApp(`/returns/${RETURN_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Exchange RR-2026-000042' }),
    ).toBeInTheDocument();
    expect(screen.getByText(BANNER)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Blueprint decision' })).toHaveTextContent(
      'Customer override',
    );
    expect(screen.getByRole('img', { name: 'Customer evidence 1' })).toHaveAttribute(
      'src',
      expect.stringContaining('sig=first'),
    );
    // Card = heading -> CardHeader -> Card.
    const customerCard = screen.getByRole('heading', { name: 'Seen by the customer' }).parentElement
      ?.parentElement;
    const internalCard = screen.getByRole('heading', { name: 'Internal only' }).parentElement
      ?.parentElement;
    expect(customerCard).toHaveTextContent('Customer request');
    expect(customerCard).not.toHaveTextContent('Checked photos internally');
    expect(internalCard).toHaveTextContent('Checked photos internally');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request more information' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark item received' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record inspection' })).not.toBeInTheDocument();
  });

  it('approves with the expected status and states who pays and the exchange hold', async () => {
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/not decided yet/);
    expect(dialog).toHaveTextContent(/ADK-L/);
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(posts[0]).toEqual({ path: 'approve', body: { expectedStatus: 'UNDER_REVIEW' } }),
    );
  });

  it('requires a reason to reject', async () => {
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Worn item');
    await user.click(confirm);
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: 'reject',
        body: { expectedStatus: 'UNDER_REVIEW', reason: 'Worn item' },
      }),
    );
  });

  it('explains a status conflict with a reload option', async () => {
    server.use(
      http.post(`${API}/admin/returns/${RETURN_ID}/approve`, () =>
        errorResponse(409, 'RETURN_STATUS_CONFLICT', 'Status changed.', {
          currentStatus: 'REJECTED',
        }),
      ),
    );
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Someone else changed this request/,
    );
    expect(within(dialog).getByRole('button', { name: 'Reload request' })).toBeInTheDocument();
  });

  it('records the inspection only at RETURN_RECEIVED and reports the restock', async () => {
    server.use(
      http.get(`${API}/admin/returns/${RETURN_ID}`, () =>
        HttpResponse.json({
          data: detail({
            status: 'RETURN_RECEIVED',
            allowedTransitions: [
              { toStatus: 'EXCHANGE_PROCESSING', requiresReason: false, requiresInspection: true },
            ],
          }),
        }),
      ),
      http.post(`${API}/admin/returns/${RETURN_ID}/inspect`, async ({ request }) => {
        posts.push({ path: 'inspect', body: await request.json() });
        return HttpResponse.json({
          data: detail({
            status: 'RETURN_RECEIVED',
            inspection: {
              outcome: 'RESELLABLE',
              notes: null,
              inspectedAt: '2026-10-16T10:00:00.000Z',
              inspectedBy: { id: 'a-1', name: 'Bisi' },
              restockedQuantity: 1,
            },
          }),
        });
      }),
    );
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    expect(await screen.findByRole('button', { name: 'Start exchange' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Record inspection' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Record inspection' }));
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: 'inspect',
        body: { outcome: 'RESELLABLE', restockQuantity: 1 },
      }),
    );
    expect(await screen.findByText(/1 item\(s\) back in stock/)).toBeInTheDocument();
  });

  it('responsibility change is super admin only', async () => {
    apiState.role = 'admin';
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    const button = await screen.findByRole('button', { name: 'Change responsibility' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('responsibility change states who will pay and needs a note', async () => {
    const { user } = renderApp(`/returns/${RETURN_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Change responsibility' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Responsibility/ }),
      'BRAND_FAULT',
    );
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Urban Ibile (the brand) will pay for the return delivery.',
    );
    // The customer overrode the recommendation: Blueprint failure is not possible.
    expect(within(dialog).getByRole('option', { name: /Blueprint failure/ })).toBeDisabled();
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Cause/ }),
      'DEFECTIVE_ITEM',
    );
    const confirm = within(dialog).getByRole('button', { name: 'Save responsibility' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Note/ }), 'Seam split on arrival');
    await user.click(confirm);
    await waitFor(() =>
      expect(posts[0]).toEqual({
        path: 'responsibility',
        body: {
          responsibility: 'BRAND_FAULT',
          faultCause: 'DEFECTIVE_ITEM',
          note: 'Seam split on arrival',
        },
      }),
    );
  });

  it('refetches fresh signed evidence URLs when an image link has expired', async () => {
    renderApp(`/returns/${RETURN_ID}`);
    const img = await screen.findByRole('img', { name: 'Customer evidence 1' });
    server.use(
      http.get(`${API}/admin/returns/${RETURN_ID}`, () => {
        detailRequests += 1;
        const fresh = detail();
        const first = fresh.evidence[0];
        if (first) first.url = 'http://localhost:4000/media/private/ev-1?sig=second';
        return HttpResponse.json({ data: fresh });
      }),
    );
    const before = detailRequests;
    fireEvent.error(img);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Customer evidence 1' })).toHaveAttribute(
        'src',
        expect.stringContaining('sig=second'),
      ),
    );
    expect(detailRequests).toBeGreaterThan(before);
  });
});

describe('evidenceRefreshDelay', () => {
  const now = Date.parse('2026-10-16T10:00:00.000Z');
  const ev = (expiresAt: string | null, url: string | null = 'u') => ({
    id: 'x',
    mimeType: 'image/jpeg',
    status: 'ready',
    url,
    expiresAt,
  });

  it('refreshes 30 seconds before the earliest expiry', () => {
    expect(
      evidenceRefreshDelay([ev('2026-10-16T10:05:00.000Z'), ev('2026-10-16T10:02:00.000Z')], now),
    ).toBe(90_000);
  });

  it('refreshes soon when a link has already expired, never when nothing expires', () => {
    expect(evidenceRefreshDelay([ev('2026-10-16T09:00:00.000Z')], now)).toBe(1_000);
    expect(evidenceRefreshDelay([ev(null, null)], now)).toBe(false);
    expect(evidenceRefreshDelay(undefined, now)).toBe(false);
  });
});
