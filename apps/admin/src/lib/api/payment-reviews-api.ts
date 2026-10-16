import type { PaymentReviewDto, ResolvePaymentReviewRequest } from '@urban-ibile/shared';
import { getData, getList, send } from './http';

/** Payment review queue (Phase 7a API). Reading: every admin. Resolving: super_admin only. */
export const paymentReviewsApi = {
  list: (params: { state?: string; page?: number }) =>
    getList<PaymentReviewDto>('/admin/payment-reviews', params),
  get: (paymentId: string) => getData<PaymentReviewDto>(`/admin/payment-reviews/${paymentId}`),
  resolve: (paymentId: string, body: ResolvePaymentReviewRequest) =>
    send<PaymentReviewDto>('POST', `/admin/payment-reviews/${paymentId}/resolve`, body),
};
