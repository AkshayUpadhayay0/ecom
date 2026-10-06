import { ArrowRight, ShoppingBag } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState } from '@/components/StateViews';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatNaira, formatRelativeTime } from '@/lib/format';
import { useRecentOrders } from './dashboard.queries';
import { orderStatusDisplay, paymentStatusDisplay } from './status-labels';

const SKELETON_ROWS = 5;

export function RecentOrdersCard() {
  const { data, isPending, isError, refetch } = useRecentOrders();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Recent orders</CardTitle>
          <CardDescription>Latest orders from the website and app.</CardDescription>
        </div>
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to="/orders">
            View all
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </CardHeader>

      {isPending ? (
        <div className="space-y-3 px-5 pb-5" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
          <span className="sr-only">Loading recent orders…</span>
        </div>
      ) : isError ? (
        <ErrorState what="recent orders" onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No orders yet"
          description="New orders from the website and app will appear here."
        />
      ) : (
        <Table>
          <TableCaption>Most recent orders</TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Order</TableHead>
              <TableHead scope="col">Customer</TableHead>
              <TableHead scope="col" className="text-right">
                Total
              </TableHead>
              <TableHead scope="col">Payment</TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="text-right">
                Placed
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((order) => {
              const payment = paymentStatusDisplay(order.paymentStatus);
              const status = orderStatusDisplay(order.orderStatus);
              const placedAt = new Date(order.placedAt);
              return (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs font-medium">
                    {order.orderNumber}
                  </TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNaira(order.totalMinor)}
                  </TableCell>
                  <TableCell>
                    <Badge tone={payment.tone}>{payment.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={status.tone}>{status.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <time dateTime={order.placedAt} title={formatDateTime(placedAt)}>
                      {formatRelativeTime(placedAt)}
                    </time>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
