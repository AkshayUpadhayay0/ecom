import type { Locale } from '@urban-ibile/i18n';
import { getSiteLinks } from '@/lib/site-links';
import { HeaderShell } from './header/header-shell';

/** Server part: gathers what the side menu links to (only content that exists), then hands over. */
export async function SiteHeader({ locale }: { locale: Locale }) {
  const links = await getSiteLinks(locale);
  return <HeaderShell links={links} />;
}
