import { useQuery } from '@tanstack/react-query';
import type { DeliveryZoneDto } from '@urban-ibile/shared';
import { Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { InfoBanner, PageHeader } from '@/components/PageHeader';
import { ListCard, QueryView } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { configApi } from '@/lib/api/config-api';
import { formatNaira } from '@/lib/format';
import { koboToNairaInput, nairaToKobo } from '@/lib/money';
import { useAdminMutation } from '@/lib/use-admin-mutation';

export const deliveryKeys = { zones: ['config', 'zones'] as const };

interface ZoneDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  zone: DeliveryZoneDto | null;
}

/** Mounted only while open (fresh form each time). */
function ZoneDialog(props: ZoneDialogProps) {
  return props.open ? <ZoneForm key={props.zone?.id ?? 'new'} {...props} /> : null;
}

function ZoneForm({ open, onOpenChange, zone }: ZoneDialogProps) {
  const [code, setCode] = useState(zone?.code ?? '');
  const [name, setName] = useState(zone?.name ?? '');
  const [fee, setFee] = useState(
    zone?.feeMinor === null || zone === null ? '' : koboToNairaInput(zone.feeMinor),
  );
  const [minDays, setMinDays] = useState(
    zone?.estDaysMin === null || zone === null ? '' : String(zone.estDaysMin),
  );
  const [maxDays, setMaxDays] = useState(
    zone?.estDaysMax === null || zone === null ? '' : String(zone.estDaysMax),
  );
  const feeMinor = fee.trim() === '' ? null : nairaToKobo(fee);
  const invalidFee = fee.trim() !== '' && feeMinor === null;
  const days = (text: string) => (text.trim() === '' ? null : Number(text));

  const save = useAdminMutation(
    () => {
      const body = {
        name: name.trim(),
        feeMinor,
        estDaysMin: days(minDays),
        estDaysMax: days(maxDays),
      };
      return zone
        ? configApi.updateZone(zone.id, body)
        : configApi.createZone({ ...body, code: code.trim(), isActive: false, sortOrder: 0 });
    },
    {
      success: zone ? 'Zone saved.' : 'Zone created (inactive until you activate it).',
      invalidate: [deliveryKeys.zones],
    },
  );

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={zone ? `Edit ${zone.name}` : 'New delivery zone'}
      description="Fees and areas are pending client confirmation. A zone without a fee cannot be activated."
      confirmLabel={zone ? 'Save' : 'Create zone'}
      confirmDisabled={name.trim() === '' || (!zone && code.trim() === '') || invalidFee}
      onConfirm={() => save.mutateAsync(undefined)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {zone ? null : (
          <Field
            label="Code"
            required
            hint="Lowercase letters, digits and dashes. Cannot be changed later."
          >
            <Input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          </Field>
        )}
        <Field label="Name" required>
          <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Delivery fee (₦)"
          hint="Leave empty while the fee is not decided."
          error={invalidFee ? 'Enter a naira amount' : undefined}
        >
          <Input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Field>
        <Field label="Days (min)">
          <Input
            type="number"
            min={0}
            value={minDays}
            onChange={(e) => setMinDays(e.target.value)}
          />
        </Field>
        <Field label="Days (max)">
          <Input
            type="number"
            min={0}
            value={maxDays}
            onChange={(e) => setMaxDays(e.target.value)}
          />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

export function DeliveryPage() {
  const zones = useQuery({
    queryKey: deliveryKeys.zones,
    queryFn: async () => (await configApi.zones({})).data,
  });
  const [editing, setEditing] = useState<DeliveryZoneDto | null>(null);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState<DeliveryZoneDto | null>(null);
  const toggle = useAdminMutation(
    (z: DeliveryZoneDto) => configApi.updateZone(z.id, { isActive: !z.isActive }),
    {
      success: (z) =>
        z.isActive ? 'Zone activated: customers can order to it.' : 'Zone deactivated.',
      invalidate: [deliveryKeys.zones],
    },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery"
        description="Delivery zones and fees used at checkout. Customers can only choose active zones with a fee."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden="true" /> New zone
          </Button>
        }
      />
      <InfoBanner>
        Delivery areas, fees and timing are pending client confirmation. Zones marked SAMPLE are
        placeholders. There is no courier integration.
      </InfoBanner>
      <ListCard>
        <QueryView
          query={zones}
          what="delivery zones"
          isEmpty={(d) => d.length === 0}
          empty={{
            icon: Truck,
            title: 'No delivery zones',
            description: 'Create a zone and set its fee before activating it.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Zone</TableHead>
                  <TableHead scope="col" className="text-right">
                    Fee
                  </TableHead>
                  <TableHead scope="col">Delivery time</TableHead>
                  <TableHead scope="col">State</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((z) => (
                  <TableRow key={z.id}>
                    <TableCell>
                      <span className="font-medium">{z.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{z.code}</span>
                      {z.isSampleData ? (
                        <Badge tone="accent" className="ml-2">
                          SAMPLE
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {z.feeMinor === null ? (
                        <span className="text-muted-foreground">Not set</span>
                      ) : (
                        formatNaira(z.feeMinor)
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {z.estDaysMin !== null && z.estDaysMax !== null
                        ? `${z.estDaysMin}–${z.estDaysMax} days`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {z.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(z);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setToggling(z)}>
                        {z.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      <ZoneDialog open={open} onOpenChange={setOpen} zone={editing} />
      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(o) => !o && setToggling(null)}
        title={
          toggling?.isActive ? `Deactivate ${toggling.name}?` : `Activate ${toggling?.name ?? ''}?`
        }
        description={
          toggling?.isActive
            ? 'Customers will no longer be able to choose this zone at checkout.'
            : 'Customers will be able to choose this zone at checkout. It needs a fee.'
        }
        confirmLabel={toggling?.isActive ? 'Deactivate' : 'Activate'}
        onConfirm={() => (toggling ? toggle.mutateAsync(toggling) : Promise.resolve())}
      />
    </div>
  );
}
