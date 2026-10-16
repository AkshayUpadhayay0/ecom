import { useQuery } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { Pagination } from '@/components/Pagination';
import { ListCard, QueryView } from '@/components/QueryStates';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { catalogKeys } from '@/features/products/products.queries';
import { catalogApi } from '@/lib/api/catalog';
import { useUrlFilters } from '@/lib/use-url-filters';

const NO_FILTERS = [] as const;

/** Sizes at or below their low-stock level; stock is adjusted on the product page (ledger). */
export function InventoryPage() {
  const { page, setPage } = useUrlFilters(NO_FILTERS);
  const lowStock = useQuery({
    queryKey: catalogKeys.lowStock(page),
    queryFn: () => catalogApi.lowStock({ page }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory"
        description="Sizes at or below their low-stock level, across all products. Open a product to adjust stock — every change is written to the stock ledger with a reason."
      />
      <ListCard>
        <QueryView
          query={lowStock}
          what="low-stock sizes"
          isEmpty={(d) => d.data.length === 0}
          empty={{
            icon: PackageCheck,
            title: 'Stock looks healthy',
            description: 'No sizes are at or below their low-stock level.',
          }}
        >
          {(data) => (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead scope="col">Product</TableHead>
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
                  <TableHead scope="col" className="text-right">
                    Alert at
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.data.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Link
                        to={`/products/${v.product.id}#stock`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {v.product.name}
                      </Link>
                    </TableCell>
                    <TableCell>{v.size.label}</TableCell>
                    <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.stockOnHand}</TableCell>
                    <TableCell className="text-right tabular-nums">{v.stockReserved}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        tone={v.stockAvailable <= 0 ? 'danger' : 'warning'}
                        className="tabular-nums"
                      >
                        {v.stockAvailable <= 0 ? 'Out of stock' : v.stockAvailable}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.lowStockThreshold}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </QueryView>
      </ListCard>
      {lowStock.data ? <Pagination meta={lowStock.data.meta} onPage={setPage} /> : null}
    </div>
  );
}
