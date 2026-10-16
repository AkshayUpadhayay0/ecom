import { cloneElement, type MouseEvent, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SUPER_ADMIN_ONLY, useIsSuperAdmin } from '@/features/auth/roles';
import { cn } from '@/lib/utils';

interface ActionProps {
  className?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  'aria-disabled'?: boolean;
  'aria-describedby'?: string;
}

/**
 * Wraps an action that only super admins may perform. Other admins see it greyed out
 * (aria-disabled, still focusable so the tooltip explaining why is reachable by keyboard);
 * clicking does nothing. The API refuses it with 403 anyway.
 */
export function SuperAdminOnly({
  children,
  reason = SUPER_ADMIN_ONLY,
}: {
  children: ReactElement<ActionProps>;
  reason?: string;
}) {
  const allowed = useIsSuperAdmin();
  if (allowed) return children;
  const blocked = cloneElement(children, {
    'aria-disabled': true,
    className: cn(children.props.className, 'cursor-not-allowed opacity-60'),
    onClick: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
    },
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>{blocked}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
