import { PRODUCT_STATUSES } from '@urban-ibile/shared';
import { Plus, Shirt } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FilterBar, FilterSelect, SearchInput } from '@/components/FilterBar';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatNaira } from '@/lib/format';
import { humanise, productStatusDisplay } from '@/lib/status';
import { useUrlFilters } from '@/lib/use-url-filters';
import { ProductFormDialog } from './ProductFormDialog';
import { useClothingTypes, useProducts } from './products.queries';

const FILTERS = ['q', 'status', 'clothingTypeId'] as const;

export function ProductsListPage() {
  const { values, page, setFilter, setPage, clear, active } = useUrlFilters(FILTERS);
  const products = useProducts({ ...values, page });
  const types = useClothingTypes();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="The catalogue: one canonical record per product (names are never translated). No limit on the number of products."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New product
          </Button>
        }
      />
      <FilterBar active={active} onClear={clear}>
        <SearchInput
          label="Search products"
          placeholder="Search name, slug or keywords"
          value={values.q}
          onChange={(v) => setFilter('q', v)}
        />
        <FilterSelect
          label="Status"
          value={values.status}
          onChange={(v) => setFilter('status', v)}
          options={PRODUCT_STATUSES.map((s) => ({ value: s, label: humanise(s) }))}
        />
        <FilterSelect
          label="Clothing type"
          value={values.clothingTypeId}
          onChange={(v) => setFilter('clothingTypeId', v)}
          options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name ?? t.slug }))}
        />
      </FilterBar>
      <ListCard>
        <QueryView
          query={products}
          what="products"
          isEmpty={(data) => data.data.length === 0}
          empty={{
            icon: Shirt,
            title: active ? 'No products match these filters' : 'No products yet',
            description: active
              ? 'Try other filters.'
              : 'Create the first product to start the catalogue.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Product</TableHead>
                  <TableHead scope="col">Type</TableHead>
                  <TableHead scope="col">Blueprint</TableHead>
                  <TableHead scope="col" className="text-right">
                    Price
                  </TableHead>
                  <TableHead scope="col">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell>
                      <Link
                        to={`/products/${product.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {product.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">{product.slug}</p>
                    </TableCell>
                    <TableCell>{product.clothingType.name ?? product.clothingType.slug}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.measurementProfile?.name ?? '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNaira(product.priceMinor)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge display={productStatusDisplay(product.status)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      {products.data ? <Pagination meta={products.data.meta} onPage={setPage} /> : null}
      <ProductFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(product) => void navigate(`/products/${product.id}`)}
      />
    </div>
  );
}
