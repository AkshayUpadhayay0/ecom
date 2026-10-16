import type { ProductDto } from '@urban-ibile/shared';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { catalogApi } from '@/lib/api/catalog';
import { koboToNairaInput, nairaToKobo } from '@/lib/money';
import { errorMessage } from '@/lib/notify';
import { useAdminMutation } from '@/lib/use-admin-mutation';
import { catalogKeys, useClothingTypes, useProfiles } from './products.queries';

const SLUG_MAX = 100;

/** "Ankara Kaftan (Blue)" -> "ankara-kaftan-blue". */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX);
}

interface FormState {
  name: string;
  slug: string;
  clothingTypeId: string;
  measurementProfileId: string;
  price: string;
  description: string;
  searchKeywords: string;
  displayOrder: string;
  status: 'draft' | 'active' | 'inactive';
}

function initialState(product: ProductDto | undefined): FormState {
  return {
    name: product?.name ?? '',
    slug: product?.slug ?? '',
    clothingTypeId: product?.clothingType.id ?? '',
    measurementProfileId: product?.measurementProfile?.id ?? '',
    price: product ? koboToNairaInput(product.priceMinor) : '',
    description: product?.description ?? '',
    searchKeywords: product?.searchKeywords ?? '',
    displayOrder: String(product?.displayOrder ?? 0),
    status: 'draft',
  };
}

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product?: ProductDto;
  onSaved?: (product: ProductDto) => void;
}

/** Create or edit a product. Names are canonical (never translated). Mounted only while open. */
export function ProductFormDialog(props: ProductFormDialogProps) {
  return props.open ? <ProductForm key={props.product?.id ?? 'new'} {...props} /> : null;
}

function ProductForm({ open, onOpenChange, product, onSaved }: ProductFormDialogProps) {
  const types = useClothingTypes();
  const profiles = useProfiles();
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [slugTouched, setSlugTouched] = useState(product !== undefined);
  const [error, setError] = useState<string | null>(null);

  const save = useAdminMutation(
    async (state: FormState) => {
      const priceMinor = nairaToKobo(state.price);
      if (priceMinor === null) throw new Error('Enter the price in naira, e.g. 15000 or 15000.50.');
      const common = {
        name: state.name.trim(),
        slug: state.slug.trim(),
        clothingTypeId: state.clothingTypeId,
        description: state.description.trim(),
        priceMinor,
        measurementProfileId: state.measurementProfileId === '' ? null : state.measurementProfileId,
        searchKeywords: state.searchKeywords.trim(),
        displayOrder: Number(state.displayOrder) || 0,
      };
      return product
        ? catalogApi.updateProduct(product.id, common)
        : catalogApi.createProduct({ ...common, status: state.status });
    },
    {
      success: product ? 'Product saved.' : 'Product created.',
      invalidate: [catalogKeys.all],
    },
  );

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const saved = await save.mutateAsync(form);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      setError(err instanceof Error && !('code' in err) ? err.message : errorMessage(err));
    }
  }

  const invalidPrice = form.price !== '' && nairaToKobo(form.price) === null;
  const incomplete =
    form.name.trim() === '' ||
    form.slug.trim() === '' ||
    form.clothingTypeId === '' ||
    form.description.trim() === '' ||
    nairaToKobo(form.price) === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product ? 'Edit product' : 'New product'}</DialogTitle>
          <DialogDescription>
            Product names are never translated. Prices are in naira and stored exactly in kobo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <Input
              value={form.name}
              maxLength={120}
              onChange={(event) => {
                set('name', event.target.value);
                if (!slugTouched) set('slug', slugify(event.target.value));
              }}
            />
          </Field>
          <Field
            label="URL slug"
            required
            hint="Used in the product link. Lowercase letters, digits and dashes."
          >
            <Input
              value={form.slug}
              maxLength={SLUG_MAX}
              onChange={(event) => {
                setSlugTouched(true);
                set('slug', event.target.value);
              }}
            />
          </Field>
          <Field
            label="Price (₦)"
            required
            error={invalidPrice ? 'Enter a naira amount, e.g. 15000.50' : undefined}
          >
            <Input
              inputMode="decimal"
              value={form.price}
              onChange={(event) => set('price', event.target.value)}
            />
          </Field>
          <Field label="Clothing type" required>
            <NativeSelect
              value={form.clothingTypeId}
              onChange={(event) => set('clothingTypeId', event.target.value)}
            >
              <option value="">Choose…</option>
              {(types.data ?? []).map((type) => (
                <option key={type.id} value={type.id} disabled={!type.isActive}>
                  {type.name ?? type.slug}
                  {type.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Blueprint measurement profile"
            hint="Which body measurements Find My Size asks for. None = no Blueprint."
          >
            <NativeSelect
              value={form.measurementProfileId}
              onChange={(event) => set('measurementProfileId', event.target.value)}
            >
              <option value="">None (no Blueprint)</option>
              {(profiles.data ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Description" required className="sm:col-span-2">
            <Textarea
              value={form.description}
              maxLength={5000}
              onChange={(event) => set('description', event.target.value)}
            />
          </Field>
          <Field
            label="Search keywords"
            hint="Extra words customers might search for (comma separated)."
          >
            <Input
              value={form.searchKeywords}
              maxLength={500}
              onChange={(event) => set('searchKeywords', event.target.value)}
            />
          </Field>
          <Field label="Display order" hint="Lower numbers show first.">
            <Input
              type="number"
              min={0}
              value={form.displayOrder}
              onChange={(event) => set('displayOrder', event.target.value)}
            />
          </Field>
          {product ? null : (
            <Field label="Start as">
              <NativeSelect
                value={form.status}
                onChange={(event) => set('status', event.target.value as FormState['status'])}
              >
                <option value="draft">Draft (not visible)</option>
                <option value="active">Active (visible in the shop)</option>
                <option value="inactive">Inactive</option>
              </NativeSelect>
            </Field>
          )}
          {error ? (
            <p
              role="alert"
              className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive sm:col-span-2"
            >
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={incomplete || save.isPending}>
              {save.isPending ? 'Saving…' : product ? 'Save changes' : 'Create product'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
