import { Router, type RequestHandler } from 'express';
import { paymentReferenceSchema } from '@urban-ibile/shared';
import { HTTP_STATUS } from '../../lib/http-status.js';
import { formatMoney } from '../notifications/email-templates.js';
import type { MockOutcome, MockPaymentProvider } from './provider/mock-provider.js';

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem;color:#222}.badge{background:#b45309;color:#fff;padding:.2rem .5rem;border-radius:.3rem;font-size:.8rem}button{font-size:1rem;padding:.6rem 1.2rem;margin:.3rem .3rem 0 0;cursor:pointer}code{word-break:break-all}</style></head><body>${body}</body></html>`;
}

/**
 * MOCK provider's checkout page (dev/test only; mounted only while PAYMENT_PROVIDER=mock, which
 * production refuses). Pay / Fail only records what the provider would report; the order is
 * still confirmed exclusively through verify / webhook -> the confirmation routine.
 */
export function createMockCheckoutRouter(provider: MockPaymentProvider): Router {
  const router = Router();

  const show: RequestHandler = async (req, res) => {
    const reference = paymentReferenceSchema.safeParse(req.params.reference);
    const tx = reference.success ? await provider.get(reference.data) : null;
    if (!tx) {
      res
        .status(HTTP_STATUS.NOT_FOUND)
        .type('html')
        .send(page('Not found', '<p>Unknown MOCK payment.</p>'));
      return;
    }
    const ref = escapeHtml(tx.reference);
    res.type('html').send(
      page(
        'MOCK checkout',
        `<p><span class="badge">MOCKED - no real payment</span></p>
<h1>Pay ${escapeHtml(formatMoney(tx.amountMinor, tx.currency))}</h1>
<p>Order ${escapeHtml(tx.metadata.orderNumber)}<br>Reference <code>${ref}</code><br>Current state: <strong>${escapeHtml(tx.status)}</strong></p>
<form method="post" action="${ref}/pay"><button type="submit">Pay (success)</button></form>
<form method="post" action="${ref}/fail"><button type="submit">Decline (failed)</button></form>`,
      ),
    );
  };

  const outcome =
    (status: MockOutcome['status']): RequestHandler =>
    async (req, res) => {
      const reference = paymentReferenceSchema.safeParse(req.params.reference);
      if (!reference.success || !(await provider.get(reference.data))) {
        res
          .status(HTTP_STATUS.NOT_FOUND)
          .type('html')
          .send(page('Not found', '<p>Unknown MOCK payment.</p>'));
        return;
      }
      await provider.setOutcome(reference.data, { status });
      res.type('html').send(
        page(
          'MOCK checkout done',
          `<p><span class="badge">MOCKED</span></p><h1>Payment ${status === 'success' ? 'approved' : 'declined'} (mock)</h1>
<p>Nothing is confirmed yet. The app now calls <code>GET /api/v1/payments/verify?reference=${escapeHtml(reference.data)}</code> (or a webhook arrives).</p>`,
        ),
      );
    };

  router.get('/:reference', show);
  router.post('/:reference/pay', outcome('success'));
  router.post('/:reference/fail', outcome('failed'));
  return router;
}
