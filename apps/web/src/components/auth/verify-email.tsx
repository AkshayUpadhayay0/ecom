'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { StatusMessage } from '@/components/ui/form';
import { bff } from '@/lib/client/bff';
import { describeError } from '@/lib/client/error-messages';
import { useI18n } from '@/lib/i18n/provider';
import { useUrlToken } from './token-page-helpers';

type State = 'working' | 'done' | 'failed' | 'missing';

/** The page behind the link in the verification email (?token=...). */
export function VerifyEmail() {
  const { t } = useI18n();
  const { token, ready } = useUrlToken();
  const [state, setState] = useState<State>('working');
  const [detail, setDetail] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- outcome of reading the URL once
      setState('missing');
      return;
    }
    bff('auth/verify-email', { method: 'POST', json: { token } }).then(
      () => {
        setState('done');
      },
      (error: unknown) => {
        const described = describeError(error);
        setDetail(t(described.key, described.params));
        setState('failed');
      },
    );
  }, [ready, token, t]);

  return (
    <div className="space-y-4" aria-live="polite">
      {state === 'working' ? <p>{t('auth.verify.working')}</p> : null}
      {state === 'done' ? <StatusMessage>{t('auth.verify.done')}</StatusMessage> : null}
      {state === 'failed' ? (
        <>
          <p role="alert" className="text-red-text">
            {t('auth.verify.failed')}
          </p>
          {detail ? <p className="text-sm text-ink-muted">{detail}</p> : null}
        </>
      ) : null}
      {state === 'missing' ? (
        <p role="alert" className="text-red-text">
          {t('auth.verify.missing_token')}
        </p>
      ) : null}
      {state !== 'working' ? (
        <Link href="/shop" className="inline-block underline underline-offset-4">
          {t('auth.verify.continue')}
        </Link>
      ) : null}
    </div>
  );
}
