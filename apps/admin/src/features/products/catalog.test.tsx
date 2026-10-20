import { screen, waitFor, within } from '@testing-library/react';
import type {
  ClothingTypeDto,
  LowStockVariantDto,
  MediaAssetDto,
  ProductDto,
  VariantDto,
} from '@urban-ibile/shared';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { koboToNairaInput, nairaToKobo } from '@/lib/money';
import { API, apiState, emptyList, errorResponse, listOf, server } from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

const TYPE: ClothingTypeDto = {
  id: 'ct-1',
  slug: 'kaftan',
  name: 'Kaftan',
  searchKeywords: '',
  sortOrder: 0,
  isActive: true,
};
const PRODUCT: ProductDto = {
  id: 'p-1',
  slug: 'fit-kaftan',
  name: 'Fit Kaftan',
  clothingType: { id: 'ct-1', slug: 'kaftan', name: 'Kaftan' },
  measurementProfile: { id: 'mp-1', code: 'male_top', name: 'Male top' },
  priceMinor: 1_500_000,
  currency: 'NGN',
  status: 'draft',
  displayOrder: 0,
  searchKeywords: '',
  videoAssetId: null,
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
  description: 'A tailored kaftan.',
  imageAssetIds: [],
  pendingMedia: { videoAssetId: null, imageAssetIds: null },
};
const VARIANT: VariantDto = {
  id: 'v-1',
  productId: 'p-1',
  size: { id: 's-l', code: 'L', label: 'Large' },
  sku: 'FIT-KAFTAN-L',
  stockOnHand: 4,
  stockReserved: 1,
  stockAvailable: 3,
  lowStockThreshold: 3,
  isLowStock: true,
  isActive: true,
  createdAt: '2026-10-10T10:00:00.000Z',
  updatedAt: '2026-10-10T10:00:00.000Z',
};

const requests: string[] = [];
const bodies: unknown[] = [];

function catalogHandlers() {
  return [
    http.get(`${API}/admin/products`, ({ request }) => {
      requests.push(new URL(request.url).search);
      return HttpResponse.json(listOf([PRODUCT]));
    }),
    http.get(`${API}/admin/products/:id`, () => HttpResponse.json({ data: PRODUCT })),
    http.post(`${API}/admin/products`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ data: { ...PRODUCT, id: 'p-new' } }, { status: 201 });
    }),
    http.get(`${API}/admin/clothing-types`, () => HttpResponse.json(listOf([TYPE]))),
    http.get(`${API}/admin/measurement-profiles`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/admin/sizes`, () => HttpResponse.json(emptyList())),
    http.get(`${API}/admin/products/:id/variants`, () => HttpResponse.json(listOf([VARIANT]))),
    http.post(`${API}/admin/variants/:id/stock-adjustments`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ data: { variant: VARIANT, movement: {} } }, { status: 201 });
    }),
    http.get(`${API}/catalog/products/:slug`, () =>
      errorResponse(404, 'NOT_FOUND', 'Product not found.'),
    ),
  ];
}

beforeEach(() => {
  apiState.hasSession = true;
  requests.length = 0;
  bodies.length = 0;
  server.use(...catalogHandlers());
});

describe('money input', () => {
  it('converts naira text to kobo without floats', () => {
    expect(nairaToKobo('15000')).toBe(1_500_000);
    expect(nairaToKobo('15,000.5')).toBe(1_500_050);
    expect(nairaToKobo('0.07')).toBe(7);
    expect(nairaToKobo('12.345')).toBeNull();
    expect(nairaToKobo('abc')).toBeNull();
    expect(koboToNairaInput(1_500_050)).toBe('15000.50');
    expect(koboToNairaInput(1_500_000)).toBe('15000');
  });
});

describe('products', () => {
  it('sends search and filters to the API and keeps them in the URL', async () => {
    const { user, router } = renderApp('/products');
    // First render of the app in this file: allow for a slow start under parallel test load.
    expect(
      await screen.findByRole('link', { name: 'Fit Kaftan' }, { timeout: 3000 }),
    ).toHaveAttribute('href', '/products/p-1');
    await user.type(screen.getByRole('searchbox', { name: 'Search products' }), 'kaftan');
    await waitFor(() => expect(requests.at(-1)).toContain('q=kaftan'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'active');
    await waitFor(() => expect(requests.at(-1)).toContain('status=active'));
    expect(router.state.location.search).toContain('status=active');
  });

  it('creates a product with the price converted to kobo', async () => {
    const { user, router } = renderApp('/products');
    await user.click(await screen.findByRole('button', { name: 'New product' }));
    const dialog = await screen.findByRole('dialog', { name: 'New product' });
    await user.type(within(dialog).getByRole('textbox', { name: /Name/ }), 'Blue Kaftan');
    expect(within(dialog).getByRole('textbox', { name: /URL slug/ })).toHaveValue('blue-kaftan');
    await user.type(within(dialog).getByRole('textbox', { name: /Price/ }), '15000.50');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: /Clothing type/ }),
      'ct-1',
    );
    await user.type(within(dialog).getByRole('textbox', { name: /Description/ }), 'Lovely.');
    await user.click(within(dialog).getByRole('button', { name: 'Create product' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products/p-new'));
    expect(bodies[0]).toMatchObject({
      name: 'Blue Kaftan',
      slug: 'blue-kaftan',
      priceMinor: 1_500_050,
      clothingTypeId: 'ct-1',
      status: 'draft',
      measurementProfileId: null,
    });
  });

  it('shows sizes and stock, adjusts stock with a reason, and previews storefront visibility', async () => {
    const { user } = renderApp('/products/p-1');
    expect(await screen.findByRole('heading', { name: 'Fit Kaftan' })).toBeInTheDocument();
    expect(await screen.findByText('FIT-KAFTAN-L')).toBeInTheDocument();
    expect(await screen.findByText('Not visible in the shop')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adjust' }));
    const dialog = await screen.findByRole('dialog', { name: /Adjust stock/ });
    await user.type(within(dialog).getByRole('spinbutton', { name: /Units to add/ }), '5');
    const save = within(dialog).getByRole('button', { name: 'Save stock change' });
    expect(save).toBeDisabled(); // reason required
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Tailor delivery');
    await user.click(save);
    await waitFor(() =>
      expect(bodies[0]).toEqual({ type: 'restock', quantity: 5, note: 'Tailor delivery' }),
    );
  });
});

describe('inventory and media', () => {
  it('lists low-stock sizes with links to the product', async () => {
    const low: LowStockVariantDto = {
      ...VARIANT,
      stockAvailable: 0,
      product: { id: 'p-1', name: 'Fit Kaftan', slug: 'fit-kaftan', status: 'active' },
    };
    server.use(
      http.get(`${API}/admin/inventory/low-stock`, () => HttpResponse.json(listOf([low]))),
    );
    renderApp('/inventory');
    expect(await screen.findByRole('link', { name: 'Fit Kaftan' })).toHaveAttribute(
      'href',
      '/products/p-1#stock',
    );
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
  });

  it('opens failed media from the dashboard link and uploads through the presigned flow', async () => {
    const asset: MediaAssetDto = {
      id: 'm-1',
      kind: 'image',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      visibility: 'public',
      status: 'failed',
      isTemporary: false,
      originalFilename: 'broken.jpg',
      durationMs: null,
      width: null,
      height: null,
      dominantColor: null,
      processingAttempts: 3,
      processingError: 'decode failed',
      publicUrl: null,
      renditions: [],
      createdAt: '2026-10-10T10:00:00.000Z',
      uploadedAt: null,
      retiredAt: null,
      purgedAt: null,
    };
    const calls: string[] = [];
    server.use(
      http.get(`${API}/admin/media`, ({ request }) => {
        calls.push(`list${new URL(request.url).search}`);
        return HttpResponse.json(listOf([asset]));
      }),
      http.post(`${API}/admin/media/uploads`, async ({ request }) => {
        calls.push('create');
        bodies.push(await request.json());
        return HttpResponse.json(
          {
            data: {
              asset: { ...asset, id: 'm-2', status: 'pending' },
              upload: {
                url: 'http://storage.test/put/m-2',
                method: 'PUT',
                headers: { 'Content-Type': 'image/jpeg' },
                expiresAt: '2026-10-16T10:00:00.000Z',
              },
            },
          },
          { status: 201 },
        );
      }),
      http.put('http://storage.test/put/m-2', () => {
        calls.push('put');
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(`${API}/admin/media/m-2/complete`, () => {
        calls.push('complete');
        return HttpResponse.json({ data: { ...asset, id: 'm-2', status: 'uploaded' } });
      }),
    );
    const { user } = renderApp('/media?status=failed');
    expect(await screen.findByText('broken.jpg')).toBeInTheDocument();
    expect(calls[0]).toContain('status=failed');
    expect(screen.getByText(/could not be processed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Upload' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload media' });
    const file = new File(['jpegbytes'], 'photo.jpg', { type: 'image/jpeg' });
    await user.upload(within(dialog).getByLabelText(/File/), file);
    await user.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(calls).toEqual(expect.arrayContaining(['create', 'put', 'complete'])),
    );
    expect(calls.indexOf('create')).toBeLessThan(calls.indexOf('put'));
    expect(calls.indexOf('put')).toBeLessThan(calls.indexOf('complete'));
    expect(bodies[0]).toMatchObject({
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      visibility: 'public',
      isTemporary: false,
    });
  });
});

describe('product deletion (soft delete)', () => {
  it('confirms in plain words, deletes and returns to the list', async () => {
    apiState.hasSession = true;
    let deleted = 0;
    server.use(
      ...catalogHandlers(),
      http.delete(`${API}/admin/products/p-1`, () => {
        deleted += 1;
        return HttpResponse.json({
          data: {
            id: 'p-1',
            deletedAt: '2026-10-20T10:00:00.000Z',
            removedCartLines: 2,
            detachedMediaIds: [],
            deactivatedVariants: 1,
          },
        });
      }),
    );
    const { user, router } = renderApp('/products/p-1');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Fit Kaftan?' });
    expect(dialog).toHaveTextContent(/removed from the shop/);
    expect(dialog).toHaveTextContent(/Order history keeps its own copy/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete product' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/products'));
    expect(deleted).toBe(1);
    expect(await screen.findByText(/removed from 2 customer cart/)).toBeInTheDocument();
  });

  it('shows why a deletion is blocked and keeps the product', async () => {
    apiState.hasSession = true;
    server.use(
      ...catalogHandlers(),
      http.delete(`${API}/admin/products/p-1`, () =>
        errorResponse(
          409,
          'PRODUCT_DELETE_BLOCKED',
          'This product cannot be deleted yet: 1 unpaid order(s) still include it. Finish or cancel those first.',
        ),
      ),
    );
    const { user, router } = renderApp('/products/p-1');
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Fit Kaftan?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete product' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/unpaid order/);
    expect(router.state.location.pathname).toBe('/products/p-1');
  });
});

describe('size (variant) deletion = archive', () => {
  function archiveHandler(calls: unknown[]) {
    return http.delete(`${API}/admin/variants/v-1`, async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json({
        data: {
          variantId: 'v-1',
          archivedAt: '2026-10-20T10:00:00.000Z',
          writtenOff: 4,
          movementId: '91',
          removedCartLines: 0,
          productStillSellable: false,
        },
      });
    });
  }

  it('product page: warns about the write-off and the last size, then deletes', async () => {
    apiState.hasSession = true;
    const calls: unknown[] = [];
    server.use(...catalogHandlers(), archiveHandler(calls));
    const { user } = renderApp('/products/p-1');
    const row = (await screen.findByText('FIT-KAFTAN-L')).closest('tr');
    await user.click(within(row ?? document.body).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete size Large/ });
    expect(dialog).toHaveTextContent(/remaining 4 unit\(s\) will be written off/);
    expect(await within(dialog).findByText(/last size on sale/)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Order history, returns and the stock ledger keep it/);
    await user.type(within(dialog).getByRole('textbox', { name: /Reason/ }), 'Damaged batch');
    await user.click(within(dialog).getByRole('button', { name: 'Delete size' }));
    await waitFor(() => expect(calls).toEqual([{ note: 'Damaged batch' }]));
    expect(await screen.findByText(/4 unit\(s\) written off/)).toBeInTheDocument();
  });

  it('inventory: opens and deletes a low-stock size; a blocked delete shows why', async () => {
    apiState.hasSession = true;
    const low: LowStockVariantDto = {
      ...VARIANT,
      stockOnHand: 0,
      stockReserved: 0,
      stockAvailable: 0,
      product: { id: 'p-1', name: 'Fit Kaftan', slug: 'fit-kaftan', status: 'active' },
    };
    server.use(
      ...catalogHandlers(),
      http.get(`${API}/admin/inventory/low-stock`, () => HttpResponse.json(listOf([low]))),
      http.delete(`${API}/admin/variants/v-1`, () =>
        errorResponse(
          409,
          'VARIANT_DELETE_BLOCKED',
          'This size cannot be deleted yet: units of this size are reserved by an open checkout or exchange. Finish or cancel those first.',
        ),
      ),
    );
    const { user } = renderApp('/inventory');
    const row = (await screen.findByText('FIT-KAFTAN-L')).closest('tr');
    expect(within(row ?? document.body).getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      '/products/p-1#stock',
    );
    await user.click(within(row ?? document.body).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: /Delete size Large/ });
    // No stock left: no write-off warning and no reason field.
    expect(dialog).not.toHaveTextContent(/written off/);
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Delete size' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/reserved/);
  });
});
