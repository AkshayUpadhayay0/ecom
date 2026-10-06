import { zodResolver } from '@hookform/resolvers/zod';
import { PASSWORD_MAX_LENGTH } from '@urban-ibile/shared';
import { AlertCircle, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router';
import { z } from 'zod';
import { Wordmark } from '@/components/Wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-context';
import { BrandPanel } from './BrandPanel';
import { loginErrorMessage, type LoginErrorMessage } from './login-errors';

/** Mirrors the API's adminLoginRequestSchema, with friendly messages for the form. */
const loginFormSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email('Enter a valid email address.')),
  password: z
    .string()
    .min(1, 'Enter your password.')
    .max(PASSWORD_MAX_LENGTH, `Passwords are at most ${PASSWORD_MAX_LENGTH} characters.`),
});
type LoginFormValues = z.infer<typeof loginFormSchema>;

export function LoginPage() {
  const { login, sessionExpired } = useAuth();
  const [searchParams] = useSearchParams();
  const [serverError, setServerError] = useState<LoginErrorMessage | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const ids = { email: useId(), password: useId(), emailError: useId(), passwordError: useId() };

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const expired = sessionExpired || searchParams.get('reason') === 'expired';

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setServerError(null);
    try {
      // On success the auth state changes and the route guard redirects.
      await login(email, password);
    } catch (error) {
      setServerError(loginErrorMessage(error));
    }
  });

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <BrandPanel />

      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Wordmark className="text-3xl" />
            <p className="mt-1.5 text-xs tracking-[0.3em] text-muted-foreground uppercase">
              Admin studio
            </p>
          </div>

          <h1 className="font-display text-3xl font-normal tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Use the admin account created for you.
          </p>

          <div aria-live="polite" className="mt-6 empty:hidden">
            {expired && !serverError ? (
              <div className="flex gap-3 rounded-lg border border-info/25 bg-info-soft px-4 py-3 text-sm">
                <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
                <p>Your session expired. Please sign in again.</p>
              </div>
            ) : null}
          </div>

          <div role="alert" aria-live="assertive" className="mt-4 empty:hidden">
            {serverError ? (
              <div className="flex gap-3 rounded-lg border border-destructive/25 bg-destructive-soft px-4 py-3 text-sm">
                <AlertCircle
                  className="mt-0.5 size-4 shrink-0 text-destructive"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-medium text-destructive">{serverError.title}</p>
                  <p className="mt-0.5 text-foreground/80">{serverError.description}</p>
                  {serverError.reference ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Reference: <span className="font-mono">{serverError.reference}</span>
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <form
            onSubmit={(event) => {
              void onSubmit(event);
            }}
            noValidate
            className="mt-6 space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor={ids.email}>Email</Label>
              <Input
                id={ids.email}
                type="email"
                autoComplete="username"
                inputMode="email"
                autoFocus
                placeholder="you@urbanibile.com"
                disabled={isSubmitting}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? ids.emailError : undefined}
                {...register('email')}
              />
              {errors.email ? (
                <p id={ids.emailError} className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={ids.password}>Password</Label>
              <div className="relative">
                <Input
                  id={ids.password}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  disabled={isSubmitting}
                  className="pr-11"
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={errors.password ? ids.passwordError : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => {
                    setShowPassword((value) => !value);
                  }}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  aria-controls={ids.password}
                  className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password ? (
                <p id={ids.passwordError} className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              size="lg"
              className={cn('w-full', isSubmitting && 'cursor-progress')}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <p className="mt-10 text-xs leading-relaxed text-muted-foreground">
            Locked out or forgot your password? Ask the account owner to reset it for you.
          </p>
        </div>
      </main>
    </div>
  );
}
