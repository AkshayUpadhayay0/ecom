import { screen, waitFor, within } from '@testing-library/react';
import type { AdminOrderDetailDto, AdminOrderSummaryDto } from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { API, apiState, emptyList, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const SUMMARY: AdminOrderSummaryDto = {
  id: ORDER_ID,
  orderNumber: 'UI-2026-000123',
  orderStatus: 'being_prepared',
  paymentStatus: 'paid',
  needsAttention: false,
  customer: { id: 'c-1', fullName: 'Ada Obi', email: 'ada@example.com' },
  recipientName: 'Ada Obi',
  contactPhone: '+2348000000000',
  deliveryZoneName: 'SAMPLE zone A',
  currency: 'NGN',
  totalMinor: 2_750_000,
  itemCount: 1,
  placedAt: '2026-10-15T10:00:00.000Z',
  paidAt: '2026-10-15T10:05:00.000Z',
};

function detail(overrides: Partial<AdminOrderDetailDto> = {}): AdminOrderDetailDto {
  return {
    ...SUMMARY,
    sourceClient: 'web',
    languageCode: 'en',
    subtotalMinor: 2_500_000,
    deliveryFeeMinor: 250_000,
    contact: { email: 'ada@example.com', phone: '+2348000000000' },
    delivery: {
      recipientName: 'Ada Obi',
      addressLine1: '1 Test Street',
      addressLine2: null,
      city: 'Lagos',
      state: 'Lagos',
      landmark: null,
      zoneId: 'z-1',
      zoneName: 'SAMPLE zone A',
    },
    carrier: null,
    trackingReference: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    reservationExpiresAt: null,
    items: [
      {
        id: 'oi-1',
        productId: 'p-1',
        variantId: 'v-1',
        productName: 'Adire Kaftan',
        clothingTypeName: 'Kaftan',
        sizeLabel: 'M',
        sku: 'ADK-M',
        quantity: 1,
        unitPriceMinor: 2_500_000,
        lineTotalMinor: 2_500_000,
        fit: {
          decisionId: 'd-1',
          method: 'MANUAL_MEASUREMENTS',
          selectionMode: 'OVERRIDE',
          fitPreference: 'STANDARD',
          recommendedSize: 'S',
          selectedSize: 'M',
          charts: [{ group: 'male_top', version: 1 }],
        },
        measurements: [{ code: 'chest', label: 'Chest', valueInches: 38, requiredSize: 'S' }],
      },
    ],
    payments: [
      {
        id: 'pay-1',
        reference: 'UI-REF-1',
        provider: 'paystack',
        status: 'success',
        amountMinor: 2_750_000,
        currency: 'NGN',
        channel: 'card',
        failureReason: null,
        createdAt: '2026-10-15T10:01:00.000Z',
        verifiedAt: '2026-10-15T10:05:00.000Z',
        paidAt: '2026-10-15T10:05:00.000Z',
      },
    ],
    history: [
      {
        id: 'h-1',
        fromStatus: 'pending_payment',
        toStatus: 'being_prepared',
        note: null,
        actor: { type: 'system', id: null, name: null },
        createdAt: '2026-10-15T10:05:00.000Z',
      },
    ],
    notes: [],
    reviewResolutions: [],
    allowedTransitions: [{ toStatus: 'sent_out', requiresPaid: true, requiresReason: false }],
    ...overrides,
  };
}

let listRequests: URL[] = [];
let statusBodies: unknown[] = [];

beforeEach(() => {
  apiState.hasSession = true;
  listRequests = [];
  statusBodies = [];
  server.use(
    http.get(`${API}/admin/orders`, ({ request }) => {
      listRequests.push(new URL(request.url));
      return HttpResponse.json(listOf([SUMMARY]));
    }),
    http.get(`${API}/admin/delivery-zones`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/admin/orders/${ORDER_ID}`, () => HttpResponse.json({ data: detail() })),
  );
});

describe('orders list', () => {
  it('sends URL filters and the search term to the API', async () => {
    const { user } = renderApp('/orders?orderStatus=being_prepared&needsAttention=true');
    expect(await screen.findByText('UI-2026-000123')).toBeInTheDocument();
    expect(listRequests[0]?.searchParams.get('orderStatus')).toBe('being_prepared');
    expect(listRequests[0]?.searchParams.get('needsAttention')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'Needs attention only' })).toBeChecked();
    await user.type(screen.getByRole('searchbox', { name: 'Search orders' }), 'ada@example');
    await waitFor(() => expect(listRequests.at(-1)?.searchParams.get('q')).toBe('ada@example'));
    expect(listRequests.at(-1)?.searchParams.get('page')).toBe('1');
  });

  it('shows an empty state for filters with no match', async () => {
    server.use(http.get(`${API}/admin/orders`, () => HttpResponse.json(emptyList())));
    renderApp('/orders?paymentStatus=refunded');
    expect(await screen.findByText('No orders match these filters')).toBeInTheDocument();
  });
});

describe('order detail', () => {
  it('shows items with the Blueprint panel, totals and only the allowed transitions', async () => {
    renderApp(`/orders/${ORDER_ID}`);
    expect(
      await screen.findByRole('heading', { name: 'Order UI-2026-000123' }),
    ).toBeInTheDocument();
    const blueprint = screen.getByRole('region', { name: 'Blueprint decision' });
    expect(within(blueprint).getByText('Customer override')).toBeInTheDocument();
    expect(within(blueprint).getByText('Chest')).toBeInTheDocument();
    expect(screen.getByText('UI-REF-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark sent out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('sends carrier, tracking and the expected status when marking sent out', async () => {
    server.use(
      http.patch(`${API}/admin/orders/${ORDER_ID}/status`, async ({ request }) => {
        statusBodies.push(await request.json());
        return HttpResponse.json({
          data: detail({ orderStatus: 'sent_out', allowedTransitions: [] }),
        });
      }),
    );
    const { user } = renderApp(`/orders/${ORDER_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Mark sent out' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: /Carrier/ }), 'GIG');
    await user.type(within(dialog).getByRole('textbox', { name: /Tracking/ }), 'TRK-9');
    await user.click(within(dialog).getByRole('button', { name: 'Mark sent out' }));
    await waitFor(() =>
      expect(statusBodies[0]).toEqual({
        toStatus: 'sent_out',
        expectedStatus: 'being_prepared',
        carrier: 'GIG',
        trackingReference: 'TRK-9',
      }),
    );
  });

  it('explains a conflict when someone else changed the order', async () => {
    server.use(
      http.patch(`${API}/admin/orders/${ORDER_ID}/status`, () =>
        errorResponse(409, 'ORDER_STATUS_CONFLICT', 'The order status changed meanwhile.', {
          currentStatus: 'sent_out',
        }),
      ),
    );
    const { user } = renderApp(`/orders/${ORDER_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Mark sent out' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Mark sent out' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      /Someone else changed this order/,
    );
    expect(within(dialog).getByRole('button', { name: 'Reload order' })).toBeInTheDocument();
  });

  it('requires a reason to cancel and offers "Cancel anyway" when a payment is in progress', async () => {
    server.use(
      http.get(`${API}/admin/orders/${ORDER_ID}`, () =>
        HttpResponse.json({
          data: detail({
            orderStatus: 'pending_payment',
            paymentStatus: 'unpaid',
            allowedTransitions: [
              { toStatus: 'cancelled', requiresPaid: false, requiresReason: true },
            ],
          }),
        }),
      ),
      http.patch(`${API}/admin/orders/${ORDER_ID}/status`, async ({ request }) => {
        const body = (await request.json()) as { confirmInFlight?: boolean };
        statusBodies.push(body);
        if (body.confirmInFlight !== true) {
          return errorResponse(409, 'PAYMENT_IN_PROGRESS', 'A payment is in progress.', {
            graceMinutes: 30,
          });
        }
        return HttpResponse.json({
          data: detail({ orderStatus: 'cancelled', allowedTransitions: [] }),
        });
      }),
    );
    const { user } = renderApp(`/orders/${ORDER_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Cancel order' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Customer asked');
    await user.click(confirm);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/started paying/);
    // The reason typed earlier is kept after the error.
    expect(within(dialog).getByRole('textbox', { name: /Reason/ })).toHaveValue('Customer asked');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel anyway' }));
    await waitFor(() =>
      expect(statusBodies[1]).toEqual({
        toStatus: 'cancelled',
        expectedStatus: 'pending_payment',
        reason: 'Customer asked',
        confirmInFlight: true,
      }),
    );
  });

  it('adds an append-only note', async () => {
    let noteBody: unknown = null;
    server.use(
      http.post(`${API}/admin/orders/${ORDER_ID}/notes`, async ({ request }) => {
        noteBody = await request.json();
        return HttpResponse.json(
          {
            data: {
              id: 'n-1',
              body: 'Called customer',
              author: { id: 'a', name: 'B' },
              createdAt: SUMMARY.placedAt,
            },
          },
          { status: 201 },
        );
      }),
    );
    const { user } = renderApp(`/orders/${ORDER_ID}`);
    await user.type(await screen.findByRole('textbox', { name: 'New note' }), 'Called customer');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(noteBody).toEqual({ body: 'Called customer' }));
  });
});
