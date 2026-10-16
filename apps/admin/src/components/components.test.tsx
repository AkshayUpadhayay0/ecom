import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { SuperAdminOnly } from '@/components/SuperAdminOnly';
import { Button } from '@/components/ui/button';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { ApiError } from '@/lib/api/client';
import { toQueryString } from '@/lib/api/http';

function withRole(role: 'admin' | 'super_admin', ui: React.ReactNode) {
  const value: AuthContextValue = {
    status: 'authenticated',
    admin: { id: 'a', email: 'a@example.com', displayName: 'A', role, mustChangePassword: false },
    sessionExpired: false,
    login: () => Promise.resolve(),
    logout: () => Promise.resolve(),
  };
  return render(
    <AuthContext.Provider value={value}>
      <TooltipProvider>{ui}</TooltipProvider>
    </AuthContext.Provider>,
  );
}

describe('shared admin building blocks', () => {
  it('builds query strings without empty values', () => {
    expect(toQueryString({ q: 'ada', status: '', page: 2, open: undefined })).toBe('?q=ada&page=2');
    expect(toQueryString({})).toBe('');
  });

  it('SuperAdminOnly blocks the action for other roles and explains why', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    withRole(
      'admin',
      <SuperAdminOnly>
        <Button onClick={onClick}>Resolve</Button>
      </SuperAdminOnly>,
    );
    const button = screen.getByRole('button', { name: 'Resolve' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
    await user.hover(button);
    expect((await screen.findAllByText('Only a super admin can do this.')).length).toBeGreaterThan(
      0,
    );
  });

  it('SuperAdminOnly leaves the action enabled for super admins', () => {
    withRole(
      'super_admin',
      <SuperAdminOnly>
        <Button>Resolve</Button>
      </SuperAdminOnly>,
    );
    const button = screen.getByRole('button', { name: 'Resolve' });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute('aria-disabled');
  });

  it('ConfirmDialog requires the note and shows API errors inside the dialog', async () => {
    const user = userEvent.setup();
    const onConfirm = vi
      .fn<(note: string) => Promise<unknown>>()
      .mockRejectedValueOnce(
        new ApiError('ORDER_STATUS_CONFLICT', 409, 'The order status changed meanwhile.'),
      )
      .mockResolvedValueOnce(undefined);
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Cancel order"
        confirmLabel="Cancel order"
        destructive
        note={{ label: 'Reason', required: true }}
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole('button', { name: 'Cancel order' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Customer asked');
    await user.click(confirm);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The order status changed meanwhile.',
    );
    expect(onConfirm).toHaveBeenCalledWith('Customer asked');
    await user.click(confirm);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
