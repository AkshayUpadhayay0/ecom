import { toast } from 'sonner';
import { ApiError } from '@/lib/api/client';

const HTTP_FORBIDDEN = 403;

/** The API's friendly message (it is written for people), or a safe fallback. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === HTTP_FORBIDDEN)
      return 'Your admin role cannot do this. Ask a super admin.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export const notify = {
  success(message: string): void {
    toast.success(message);
  },
  error(error: unknown, fallbackTitle?: string): void {
    const message = errorMessage(error);
    toast.error(fallbackTitle ?? message, fallbackTitle ? { description: message } : undefined);
  },
};
