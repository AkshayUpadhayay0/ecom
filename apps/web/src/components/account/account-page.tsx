'use client';

import { useRouter } from 'next/navigation';
import { secondaryButtonClass } from '@/components/ui/form';
import { describeError } from '@/lib/client/error-messages';
import { useMe, useSignOut } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';
import { AddressesSection } from './addresses-section';
import { ProfileSection } from './profile-section';

export function AccountPage() {
  const { t } = useI18n();
  const router = useRouter();
  const me = useMe();
  const signOut = useSignOut();

  if (me.isPending) return <p>{t('form.loading')}</p>;
  if (me.isError) {
    const described = describeError(me.error);
    return (
      <p role="alert" className="text-red-text">
        {t('account.load_failed')} {t(described.key, described.params)}
      </p>
    );
  }
  return (
    <div className="space-y-12">
      <ProfileSection customer={me.data} />
      <AddressesSection />
      <button
        type="button"
        className={secondaryButtonClass}
        onClick={() => {
          void signOut().then(() => {
            router.replace('/');
            router.refresh();
          });
        }}
      >
        {t('auth.logout')}
      </button>
    </div>
  );
}
