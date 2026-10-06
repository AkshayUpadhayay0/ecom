import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { adminAuthApi } from '@/lib/api/admin-auth';
import { session } from '@/lib/api/client';
import {
  API,
  LOCKED_EMAIL,
  LOCK_SECONDS,
  RATE_LIMITED_EMAIL,
  TEST_ADMIN,
  VALID_PASSWORD,
  apiState,
  server,
} from '@/test/api-mock';
import { renderApp } from '@/test/render-app';

async function fillLogin(
  user: ReturnType<typeof renderApp>['user'],
  email: string,
  password: string,
): Promise<void> {
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
}

describe('login page', () => {
  it('shows inline validation messages and does not call the API', async () => {
    const { user } = renderApp('/login');

    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(apiState.loginCalls).toBe(0);
  });

  it('toggles password visibility', async () => {
    const { user } = renderApp('/login');
    const password = await screen.findByLabelText('Password');

    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password');
  });

  it('signs in with the Enter key and redirects to the dashboard', async () => {
    const { user, router } = renderApp('/login');

    await fillLogin(user, TEST_ADMIN.email, `${VALID_PASSWORD}{Enter}`);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /good (morning|afternoon|evening), bisi/i,
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
    expect(screen.getByText('Sample data')).toBeInTheDocument();
    expect(session.hasAccessToken()).toBe(true);
  });

  it('returns the admin to the page they originally requested', async () => {
    const { user, router } = renderApp('/orders');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');

    await fillLogin(user, TEST_ADMIN.email, VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders');
    expect(screen.getByText('Coming soon')).toBeInTheDocument();
  });

  it('shows a generic error for wrong credentials', async () => {
    const { user, router } = renderApp('/login');

    await fillLogin(user, TEST_ADMIN.email, 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('shows when a locked account can try again', async () => {
    const { user } = renderApp('/login');

    await fillLogin(user, LOCKED_EMAIL, 'any-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Account temporarily locked');
    expect(alert).toHaveTextContent(`about ${String(LOCK_SECONDS / 60)} minutes`);
  });

  it('explains rate limiting', async () => {
    const { user } = renderApp('/login');

    await fillLogin(user, RATE_LIMITED_EMAIL, 'any-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts');
  });

  it('explains a network failure', async () => {
    server.use(http.post(`${API}/admin/auth/login`, () => HttpResponse.error()));
    const { user } = renderApp('/login');

    await fillLogin(user, TEST_ADMIN.email, VALID_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
  });
});

describe('route protection', () => {
  it('redirects unauthenticated visitors from a protected route to /login', async () => {
    const { router } = renderApp('/dashboard');

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('restores the session from the refresh cookie and skips /login when signed in', async () => {
    apiState.hasSession = true; // the browser still holds a valid refresh cookie
    const { router } = renderApp('/login');

    expect(await screen.findByRole('heading', { level: 1, name: /bisi/i })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/dashboard');
  });

  it('logs out through the account menu', async () => {
    apiState.hasSession = true;
    const { user, router } = renderApp('/dashboard');

    await user.click(await screen.findByRole('button', { name: /account menu/i }));
    await user.click(await screen.findByRole('menuitem', { name: 'Log out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(apiState.hasSession).toBe(false);
    expect(session.hasAccessToken()).toBe(false);
  });

  it('sends the admin to /login with a "session expired" message when refresh fails', async () => {
    apiState.hasSession = true;
    const { router } = renderApp('/dashboard');
    await screen.findByRole('heading', { level: 1, name: /bisi/i });

    // Server-side session ends (e.g. revoked); the next API call cannot be refreshed.
    apiState.hasSession = false;
    await act(async () => {
      await adminAuthApi.me().catch(() => undefined);
    });

    expect(
      await screen.findByText('Your session expired. Please sign in again.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
  });
});
