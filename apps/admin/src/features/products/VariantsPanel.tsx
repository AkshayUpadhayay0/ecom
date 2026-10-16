import { useQuery } from '@tanstack/react-query';
import type { StockAdjustmentRequest, VariantDto } from '@urban-ibile/shared';
import { History, PackagePlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Pagination } from '@/components/Pagination';
import { QueryView } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { catalogApi } from '@/lib/api/catalog';
import { formatDateTime } from '@/lib/format';
import { notify } from '@/lib/notify';
import { humanise } from '@/lib/status';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { catalogKeys, useSizesList, useVariants } from './products.queries';

type AdjustKind = StockAdjustmentRequest['type'];

function AdjustStockDialog({
  variant,
  onClose,
}: {
  variant: VariantDto | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<AdjustKind>('restock');
  const [amount, setAmount] = useState('');
  const adjust = useAdminMutation(
    (body: StockAdjustmentRequest) => catalogApi.adjustStock(variant?.id ?? '', body),
    { success: 'Stock updated.', invalidate: [catalogKeys.all] },
  );
  const value = Number(amount);
  const valid =
    amount.trim() !== '' &&
    Number.isInteger(value) &&
    (kind === 'adjustment' ? value !== 0 : kind === 'restock' ? value > 0 : value >= 0);

  return (
    <ConfirmDialog
      open={variant !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setAmount('');
        }
      }}
      title={`Adjust stock · ${variant?.size.label ?? ''}`}
      description={`On hand ${variant?.stockOnHand ?? 0}, reserved ${variant?.stockReserved ?? 0}. Every change is written to the stock ledger with your reason.`}
      confirmLabel="Save stock change"
      confirmDisabled={!valid}
      note={{ label: 'Reason', required: true, placeholder: 'e.g. New delivery from the tailor' }}
      onConfirm={(note) =>
        adjust.mutateAsync(
          kind === 'restock'
            ? { type: 'restock', quantity: value, note }
            : kind === 'initial'
              ? { type: 'initial', newOnHand: value, note }
              : { type: 'adjustment', quantity: value, note },
        )
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as AdjustKind)}>
            <option value="restock">Restock (add units)</option>
            <option value="adjustment">Correction (+/- units)</option>
            <option value="initial">First count (set on hand)</option>
          </NativeSelect>
        </Field>
        <Field
          label={
            kind === 'initial'
              ? 'On hand'
              : kind === 'restock'
                ? 'Units to add'
                : 'Change (e.g. -2)'
          }
          hint={kind === 'initial' ? 'Only before any stock movement exists.' : undefined}
        >
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

function MovementsDialog({
  variant,
  onClose,
}: {
  variant: VariantDto | null;
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const movements = useQuery({
    queryKey: catalogKeys.movements(variant?.id ?? '', page),
    queryFn: () => catalogApi.movements(variant?.id ?? '', { page, pageSize: 20 }),
    enabled: variant !== null,
  });
  return (
    <Dialog open={variant !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Stock ledger · {variant?.sku}</DialogTitle>
          <DialogDescription>
            Every stock change, newest first. Reservations show units held for unpaid orders.
          </DialogDescription>
        </DialogHeader>
        <QueryView
          query={movements}
          what="stock movements"
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: History,
            title: 'No movements yet',
            description: 'Stock changes will appear here.',
          }}
        >
          {(data) => (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead scope="col">When</TableHead>
                    <TableHead scope="col">Type</TableHead>
                    <TableHead scope="col" className="text-right">
                      Change
                    </TableHead>
                    <TableHead scope="col">Reference</TableHead>
                    <TableHead scope="col">Note / by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.data.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(new Date(m.createdAt))}
                      </TableCell>
                      <TableCell>{humanise(m.type)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${m.quantityDelta < 0 ? 'text-destructive' : 'text-success'}`}
                      >
                        {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.referenceType ? humanise(m.referenceType) : '—'}
                      </TableCell>
                      <TableCell className="text-xs">
                        {m.note ?? '—'}
                        {m.admin ? (
                          <span className="block text-muted-foreground">{m.admin.displayName}</span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination meta={data.meta} onPage={setPage} />
            </>
          )}
        </QueryView>
      </DialogContent>
    </Dialog>
  );
}

function AddVariantDialog({
  productId,
  open,
  onOpenChange,
  used,
}: {
  productId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  used: Set<string>;
}) {
  const sizes = useSizesList();
  const [sizeId, setSizeId] = useState('');
  const [sku, setSku] = useState('');
  const [threshold, setThreshold] = useState('3');
  const create = useAdminMutation(
    () =>
      catalogApi.createVariant(productId, {
        sizeId,
        sku: sku.trim(),
        lowStockThreshold: Number(threshold) || 0,
        isActive: true,
      }),
    { success: 'Size added.', invalidate: [catalogKeys.variants(productId)] },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add a size"
      description="Creates the size for this product with 0 stock. Then record the first count."
      confirmLabel="Add size"
      confirmDisabled={sizeId === '' || sku.trim() === ''}
      onConfirm={async () => {
        await create.mutateAsync(undefined);
        setSizeId('');
        setSku('');
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Size" required>
          <NativeSelect value={sizeId} onChange={(e) => setSizeId(e.target.value)}>
            <option value="">Choose…</option>
            {(sizes.data ?? [])
              .filter((s) => s.isActive && !used.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} ({s.code})
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="SKU" required>
          <Input value={sku} maxLength={64} onChange={(e) => setSku(e.target.value)} />
        </Field>
        <Field label="Low-stock alert at">
          <Input
            type="number"
            min={0}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

/** Sizes (variants) of a product with stock; changes go through the ledger only. */
export function VariantsPanel({ productId }: { productId: string }) {
  const variants = useVariants(productId);
  const [adjusting, setAdjusting] = useState<VariantDto | null>(null);
  const [ledger, setLedger] = useState<VariantDto | null>(null);
  const [adding, setAdding] = useState(false);
  const toggle = useAdminMutation(
    (variant: VariantDto) => catalogApi.updateVariant(variant.id, { isActive: !variant.isActive }),
    {
      success: (v) => (v.isActive ? 'Size is on sale again.' : 'Size taken off sale.'),
      invalidate: [catalogKeys.variants(productId)],
    },
  );

  return (
    <Card id="stock" className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Sizes &amp; stock</CardTitle>
          <CardDescription>
            Available = on hand − reserved for unpaid orders. Stock changes are recorded in the
            ledger.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden="true" />
          Add size
        </Button>
      </CardHeader>
      <QueryView
        query={variants}
        what="sizes"
        isEmpty={(d) => d.length === 0}
        empty={{
          icon: PackagePlus,
          title: 'No sizes yet',
          description: 'Add the sizes this product is made in.',
        }}
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">Size</TableHead>
                <TableHead scope="col">SKU</TableHead>
                <TableHead scope="col" className="text-right">
                  On hand
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Reserved
                </TableHead>
                <TableHead scope="col" className="text-right">
                  Available
                </TableHead>
                <TableHead scope="col">State</TableHead>
                <TableHead scope="col" className="text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.size.label}</TableCell>
                  <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.stockOnHand}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.stockReserved}</TableCell>
                  <TableCell className="text-right tabular-nums">{v.stockAvailable}</TableCell>
                  <TableCell>
                    {!v.isActive ? (
                      <Badge>Off sale</Badge>
                    ) : v.stockAvailable <= 0 ? (
                      <Badge tone="danger">Out of stock</Badge>
                    ) : v.isLowStock ? (
                      <Badge tone="warning">Low</Badge>
                    ) : (
                      <Badge tone="success">OK</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setAdjusting(v)}>
                        Adjust
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setLedger(v)}>
                        Ledger
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate(v, { onError: (err) => notify.error(err) })}
                      >
                        {v.isActive ? 'Take off sale' : 'Put on sale'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryView>
      <AdjustStockDialog variant={adjusting} onClose={() => setAdjusting(null)} />
      <MovementsDialog variant={ledger} onClose={() => setLedger(null)} />
      <AddVariantDialog
        productId={productId}
        open={adding}
        onOpenChange={setAdding}
        used={new Set((variants.data ?? []).map((v) => v.size.id))}
      />
    </Card>
  );
}
