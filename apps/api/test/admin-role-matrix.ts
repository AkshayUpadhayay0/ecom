/**
 * The role rule of EVERY route registered under /admin (CLAUDE.md rule 13). The regression test
 * (src/modules/admin-role-matrix.test.ts) fails when a route exists that is not listed here, or a
 * listed route no longer exists, so a new admin route cannot ship without an explicit role rule.
 *
 * - public:      no admin token needed (sign-in flow only)
 * - any_admin:   role admin and super_admin
 * - super_admin: role admin gets 403
 * - setting_key: PATCH /admin/settings/:key - admin only for ADMIN_EDITABLE_SETTING_KEYS
 */
export type RoleRule = 'public' | 'any_admin' | 'super_admin' | 'setting_key';

export const ADMIN_ROLE_MATRIX: Record<string, RoleRule> = {
  // Sign-in (admin auth)
  'POST /admin/auth/login': 'public',
  'POST /admin/auth/refresh': 'public',
  'POST /admin/auth/logout': 'public',
  'GET /admin/auth/me': 'any_admin',
  'POST /admin/auth/change-password': 'any_admin',

  // Dashboard
  'GET /admin/stats/overview': 'any_admin',

  // Orders, payment review, customers
  'GET /admin/orders': 'any_admin',
  'GET /admin/orders/:id': 'any_admin',
  'PATCH /admin/orders/:id/status': 'any_admin',
  'GET /admin/orders/:id/notes': 'any_admin',
  'POST /admin/orders/:id/notes': 'any_admin',
  'GET /admin/payment-reviews': 'any_admin',
  'GET /admin/payment-reviews/:paymentId': 'any_admin',
  'POST /admin/payment-reviews/:paymentId/resolve': 'any_admin',
  'GET /admin/customers': 'any_admin',
  'GET /admin/customers/:id': 'any_admin',
  'PATCH /admin/customers/:id/status': 'super_admin',

  // Returns
  'GET /admin/returns': 'any_admin',
  'GET /admin/returns/:id': 'any_admin',
  'POST /admin/returns/:id/approve': 'any_admin',
  'POST /admin/returns/:id/reject': 'any_admin',
  'POST /admin/returns/:id/request-info': 'any_admin',
  'POST /admin/returns/:id/mark-received': 'any_admin',
  'POST /admin/returns/:id/status': 'any_admin',
  'POST /admin/returns/:id/inspect': 'any_admin',
  'PATCH /admin/returns/:id/responsibility': 'any_admin',
  'POST /admin/returns/:id/notes': 'any_admin',

  // Products, clothing types, sizes (names), variants, inventory
  'GET /admin/products': 'any_admin',
  'POST /admin/products': 'any_admin',
  'GET /admin/products/:id': 'any_admin',
  'PATCH /admin/products/:id': 'any_admin',
  'DELETE /admin/products/:id': 'any_admin',
  'POST /admin/products/:id/status': 'any_admin',
  'PUT /admin/products/:id/video': 'any_admin',
  'PUT /admin/products/:id/images': 'any_admin',
  'GET /admin/clothing-types': 'any_admin',
  'POST /admin/clothing-types': 'any_admin',
  'GET /admin/clothing-types/:id': 'any_admin',
  'PATCH /admin/clothing-types/:id': 'any_admin',
  'GET /admin/sizes': 'any_admin',
  'GET /admin/sizes/:id': 'any_admin',
  'GET /admin/measurement-profiles': 'any_admin',
  'GET /admin/products/:productId/variants': 'any_admin',
  'POST /admin/products/:productId/variants': 'any_admin',
  'PATCH /admin/variants/:id': 'any_admin',
  'DELETE /admin/variants/:id': 'any_admin',
  'POST /admin/variants/:id/stock-adjustments': 'any_admin',
  'GET /admin/variants/:id/stock-movements': 'any_admin',
  'GET /admin/inventory/low-stock': 'any_admin',

  // Media Library + product-form media (every admin since 22 Oct 2026). For BOTH roles these
  // only reach public media no customer owns; private files / evidence are 404 here.
  'GET /admin/media': 'any_admin',
  'GET /admin/media/:id/url': 'any_admin',
  'POST /admin/media/uploads': 'any_admin',
  'POST /admin/media/:id/complete': 'any_admin',
  'GET /admin/media/:id': 'any_admin',
  'GET /admin/media/picker': 'any_admin',
  'POST /admin/media/:id/retry': 'any_admin',
  'GET /admin/media/:id/usage': 'any_admin',
  'DELETE /admin/media/:id': 'any_admin',

  // Content, delivery, settings
  'GET /admin/content-blocks': 'any_admin',
  'GET /admin/content-blocks/:key': 'any_admin',
  'POST /admin/content-blocks/:key/publish': 'any_admin',
  'POST /admin/content-blocks/:key/unpublish': 'any_admin',
  'PUT /admin/content-blocks/:key/media': 'any_admin',
  'PUT /admin/content-blocks/:key/text': 'any_admin',
  // Reset a text block to its seeded default (developer recovery).
  'POST /admin/content-blocks/:key/reset': 'super_admin',
  'GET /admin/delivery-zones': 'any_admin',
  'POST /admin/delivery-zones': 'any_admin',
  'GET /admin/delivery-zones/:id': 'any_admin',
  'PATCH /admin/delivery-zones/:id': 'any_admin',
  'GET /admin/settings': 'any_admin',
  'PATCH /admin/settings/:key': 'setting_key',

  // Physical purge of stored media files (super_admin only)
  'POST /admin/media/:id/purge': 'super_admin',
  'POST /admin/media/purge-retired': 'super_admin',
  // Internal: Sizes & Charts
  'GET /admin/size-chart-groups': 'super_admin',
  'GET /admin/size-chart-groups/:groupId/charts': 'super_admin',
  'GET /admin/size-charts/:chartId': 'super_admin',
  'PUT /admin/sizes/order': 'super_admin',
  // Internal: QR Pages + serials
  'GET /admin/hidden-pages': 'super_admin',
  'GET /admin/hidden-pages/:id': 'super_admin',
  'PUT /admin/hidden-pages/:id/content': 'super_admin',
  'POST /admin/serial-imports': 'super_admin',
  'GET /admin/serial-batches': 'super_admin',
  'POST /admin/serials/deactivate': 'super_admin',
  // Internal: Audit Log
  'GET /admin/audit-logs': 'super_admin',
};
