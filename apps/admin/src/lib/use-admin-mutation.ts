import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { notify } from '@/lib/notify';

/**
 * A write that toasts the outcome and refreshes the listed queries. Errors are re-thrown so a
 * ConfirmDialog can keep showing them.
 */
export function useAdminMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  options: { success: string | ((result: TResult) => string); invalidate: QueryKey[] },
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result) => {
      notify.success(
        typeof options.success === 'string' ? options.success : options.success(result),
      );
      await Promise.all(
        options.invalidate.map((queryKey) => client.invalidateQueries({ queryKey })),
      );
    },
  });
}
