import type {
  BlueprintRequirementsDto,
  BodyScanSessionDto,
  DecisionDto,
  RecommendationDto,
} from '@urban-ibile/shared';
import { bff } from '@/lib/client/bff';
import type { DecisionRequestBody } from './machine';

/** Blueprint calls go through the BFF (customer session required). */
export const blueprintApi = {
  requirements: (productId: string) =>
    bff<BlueprintRequirementsDto>(`blueprint/products/${productId}/requirements`),
  preview: (body: Record<string, unknown>) =>
    bff<RecommendationDto>('blueprint/recommendations', { method: 'POST', json: body }),
  decide: (body: DecisionRequestBody) =>
    bff<DecisionDto>('blueprint/decisions', { method: 'POST', json: body }),
  startScan: (productId: string) =>
    bff<BodyScanSessionDto>('body-scan/sessions', { method: 'POST', json: { productId } }),
  scan: (id: string) => bff<BodyScanSessionDto>(`body-scan/sessions/${id}`),
};

const SCAN_POLL_MS = 1000;
const SCAN_MAX_POLLS = 30;

/** Creates a Body Scan session and waits until it completes (the MOCK provider is immediate). */
export async function runBodyScan(productId: string): Promise<BodyScanSessionDto> {
  let session = await blueprintApi.startScan(productId);
  for (let polls = 0; session.status !== 'COMPLETED' && polls < SCAN_MAX_POLLS; polls += 1) {
    if (session.status === 'FAILED') break;
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
    session = await blueprintApi.scan(session.id);
  }
  return session;
}
