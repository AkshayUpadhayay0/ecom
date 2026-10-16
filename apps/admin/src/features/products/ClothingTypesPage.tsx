import type { ClothingTypeDto } from '@urban-ibile/shared';
import { Plus, Tags } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { PageHeader } from '@/components/PageHeader';
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
import { catalogApi } from '@/lib/api/catalog';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { slugify } from './ProductFormDialog';
import { catalogKeys, useClothingTypes } from './products.queries';

interface ClothingTypeDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  type: ClothingTypeDto | null;
}

/** Mounted only while open, so each opening starts from the row's values. */
function ClothingTypeDialog(props: ClothingTypeDialogProps) {
  return props.open ? <ClothingTypeForm key={props.type?.id ?? 'new'} {...props} /> : null;
}

function ClothingTypeForm({ open, onOpenChange, type }: ClothingTypeDialogProps) {
  const [name, setName] = useState(type?.name ?? '');
  const [slug, setSlug] = useState(type?.slug ?? '');
  const [keywords, setKeywords] = useState(type?.searchKeywords ?? '');
  const [order, setOrder] = useState(String(type?.sortOrder ?? 0));
  const save = useAdminMutation(
    () => {
      const body = {
        name: name.trim(),
        slug: slug.trim(),
        searchKeywords: keywords.trim(),
        sortOrder: Number(order) || 0,
      };
      return type
        ? catalogApi.updateClothingType(type.id, body)
        : catalogApi.createClothingType({ ...body, isActive: true });
    },
    {
      success: type ? 'Clothing type saved.' : 'Clothing type created.',
      invalidate: [catalogKeys.clothingTypes()],
    },
  );
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={type ? 'Edit clothing type' : 'New clothing type'}
      confirmLabel={type ? 'Save' : 'Create'}
      confirmDisabled={name.trim() === '' || slug.trim() === ''}
      onConfirm={() => save.mutateAsync(undefined)}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input
            value={name}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              if (!type) setSlug(slugify(e.target.value));
            }}
          />
        </Field>
        <Field label="Slug" required>
          <Input value={slug} maxLength={100} onChange={(e) => setSlug(e.target.value)} />
        </Field>
        <Field label="Search keywords" className="sm:col-span-2">
          <Input value={keywords} maxLength={500} onChange={(e) => setKeywords(e.target.value)} />
        </Field>
        <Field label="Sort order">
          <Input type="number" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
        </Field>
      </div>
    </ConfirmDialog>
  );
}

export function ClothingTypesPage() {
  const types = useClothingTypes();
  const [editing, setEditing] = useState<ClothingTypeDto | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useAdminMutation(
    (t: ClothingTypeDto) => catalogApi.updateClothingType(t.id, { isActive: !t.isActive }),
    {
      success: (t) => (t.isActive ? 'Clothing type activated.' : 'Clothing type deactivated.'),
      invalidate: [catalogKeys.clothingTypes()],
    },
  );
  const [confirmToggle, setConfirmToggle] = useState<ClothingTypeDto | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clothing types"
        description="Kaftan, agbada, fila… Used to group and search products. Types are never deleted, only deactivated."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus aria-hidden="true" /> New clothing type
          </Button>
        }
      />
      <ListCard>
        <QueryView
          query={types}
          what="clothing types"
          isEmpty={(d) => d.length === 0}
          empty={{ icon: Tags, title: 'No clothing types', description: 'Create the first one.' }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Slug</TableHead>
                  <TableHead scope="col" className="text-right">
                    Order
                  </TableHead>
                  <TableHead scope="col">State</TableHead>
                  <TableHead scope="col" className="text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{t.slug}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.sortOrder}</TableCell>
                    <TableCell>
                      {t.isActive ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(t);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmToggle(t)}>
                        {t.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      <ClothingTypeDialog open={open} onOpenChange={setOpen} type={editing} />
      <ConfirmDialog
        open={confirmToggle !== null}
        onOpenChange={(o) => !o && setConfirmToggle(null)}
        title={confirmToggle?.isActive ? 'Deactivate clothing type?' : 'Activate clothing type?'}
        description={
          confirmToggle?.isActive
            ? 'It can no longer be chosen for new products. Existing products keep it.'
            : undefined
        }
        confirmLabel={confirmToggle?.isActive ? 'Deactivate' : 'Activate'}
        onConfirm={() => (confirmToggle ? toggle.mutateAsync(confirmToggle) : Promise.resolve())}
      />
    </div>
  );
}
