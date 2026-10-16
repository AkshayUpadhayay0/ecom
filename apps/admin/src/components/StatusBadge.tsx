import { Badge } from '@/components/ui/badge';
import type { StatusDisplay } from '@/lib/status';

export function StatusBadge({ display }: { display: StatusDisplay }) {
  return <Badge tone={display.tone}>{display.label}</Badge>;
}
