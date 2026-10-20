import { InfoBanner } from '@/components/PageHeader';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { catalogApi } from '@/lib/api/catalog';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { catalogKeys, useVariants } from './products.queries';

export interface VariantToDelete {
  id: string;
  productId: string;
  sizeLabel: string;
  sku: string;
  stockOnHand: number;
}

/**
 * Delete a size = archive it (20 Oct 2026). The API writes remaining stock off through the ledger
 * first and keeps the row for order history, returns and the ledger. Mounted only while open.
 */
export function DeleteVariantDialog({
  variant,
  onClose,
}: {
  variant: VariantToDelete | null;
  onClose: () => void;
}) {
  return variant ? <DeleteVariant variant={variant} onClose={onClose} /> : null;
}

function DeleteVariant({ variant, onClose }: { variant: VariantToDelete; onClose: () => void }) {
  const siblings = useVariants(variant.productId);
  const activeOthers = (siblings.data ?? []).filter((v) => v.isActive && v.id !== variant.id);
  const isLastActiveSize = siblings.data !== undefined && activeOthers.length === 0;
  const remove = useAdminMutation(
    (note: string) => catalogApi.archiveVariant(variant.id, note === '' ? {} : { note }),
    {
      success: (r) =>
        [
          `Size ${variant.sizeLabel} deleted.`,
          r.writtenOff > 0 ? `${r.writtenOff} unit(s) written off in the ledger.` : '',
          r.productStillSellable ? '' : 'The product has no size on sale now.',
        ]
          .filter(Boolean)
          .join(' '),
      invalidate: [catalogKeys.all],
    },
  );

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Delete size ${variant.sizeLabel} (${variant.sku})?`}
      description="It is removed from the shop, customers’ carts and the admin lists. Order history, returns and the stock ledger keep it."
      confirmLabel="Delete size"
      destructive
      {...(variant.stockOnHand > 0 && {
        note: { label: 'Reason for the write-off (optional)', required: false },
      })}
      onConfirm={(note) => remove.mutateAsync(note)}
    >
      {variant.stockOnHand > 0 ? (
        <InfoBanner tone="warning">
          The remaining {variant.stockOnHand} unit(s) will be written off: a stock adjustment to
          zero is recorded in the ledger before the size is deleted.
        </InfoBanner>
      ) : null}
      {isLastActiveSize ? (
        <InfoBanner tone="warning">
          This is the product’s last size on sale: the product will no longer be sellable in the
          shop until you add a size.
        </InfoBanner>
      ) : null}
    </ConfirmDialog>
  );
}
