'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@/brand/brand';
import { BrandLogo } from '@/components/brand-logo';
import { CartButton } from '@/components/cart/cart-button';
import { HEADER_SOLID_OFFSET_PX } from '@/config/constants';
import { useHasSession } from '@/lib/client/session';
import { useI18n } from '@/lib/i18n/provider';
import { isHomePath } from '@/lib/pathname';
import type { SiteLinks } from '@/lib/site-links';
import { MenuIcon, SearchIcon, UserIcon } from './icons';

// Both panels are only downloaded the first time they open.
const SideMenu = dynamic(() => import('./side-menu'), { ssr: false });
const SearchOverlay = dynamic(() => import('./search-overlay'), { ssr: false });

const ICON_BUTTON = 'grid size-11 place-items-center';
/** Marks the home hero: the header stays transparent while this is under it. */
const HERO_SELECTOR = '[data-hero]';

/**
 * Header: menu button left, centred wordmark, Search / Account / Cart right. On the home page it
 * is transparent over the hero and turns solid once the hero has scrolled under it (an
 * IntersectionObserver, no scroll listener); every other page is solid and gets a spacer.
 */
export function HeaderShell({ links }: { links: SiteLinks }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const hasSession = useHasSession();
  const onHome = isHomePath(pathname);
  const [pastHero, setPastHero] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuEver, setMenuEver] = useState(false);
  const [searchEver, setSearchEver] = useState(false);

  useEffect(() => {
    const hero = onHome ? document.querySelector(HERO_SELECTOR) : null;
    if (!hero) {
      // No hero on screen (error state): keep the header readable. Not synchronous, so no cascade.
      const frame = requestAnimationFrame(() => {
        setPastHero(true);
      });
      return () => {
        cancelAnimationFrame(frame);
      };
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPastHero(!entry?.isIntersecting);
      },
      { rootMargin: `-${HEADER_SOLID_OFFSET_PX}px 0px 0px 0px` },
    );
    observer.observe(hero);
    return () => {
      observer.disconnect();
    };
  }, [onHome, pathname]);

  const overHero = onHome && !pastHero;

  return (
    <>
      <header
        data-state={overHero ? 'over-hero' : 'solid'}
        className={`site-header fixed inset-x-0 top-0 z-40 ${overHero ? 'on-dark' : ''}`}
      >
        <div className="mx-auto grid h-(--ui-header-h) max-w-[100rem] grid-cols-[1fr_auto_1fr] items-center px-2 sm:px-6 lg:px-8">
          <div className="flex">
            <button
              type="button"
              aria-label={t('menu.open')}
              onClick={() => {
                setMenuEver(true);
                setMenuOpen(true);
              }}
              className="inline-flex min-h-11 items-center gap-2 pr-3 pl-2 font-medium"
            >
              <MenuIcon />
              <span className="hidden md:inline">{t('menu.title')}</span>
            </button>
          </div>
          <Link href="/" aria-label={t('a11y.logo_home', { brand: BRAND_NAME })}>
            <BrandLogo variant="wordmark-ivory" className="logo-over-hero h-5 w-auto sm:h-6" />
            <BrandLogo variant="wordmark" className="logo-solid h-5 w-auto sm:h-6" />
          </Link>
          <nav aria-label={t('nav.primary')} className="flex items-center justify-end sm:gap-1">
            <button
              type="button"
              aria-label={t('header.open_search')}
              onClick={() => {
                setSearchEver(true);
                setSearchOpen(true);
              }}
              className={ICON_BUTTON}
            >
              <SearchIcon />
            </button>
            <Link
              href={hasSession ? '/account' : '/login'}
              aria-label={hasSession ? t('nav.account') : t('nav.sign_in')}
              className={ICON_BUTTON}
            >
              <UserIcon />
            </Link>
            <CartButton />
          </nav>
        </div>
      </header>
      {onHome ? null : <div aria-hidden="true" className="h-(--ui-header-h)" />}
      {menuEver ? (
        <SideMenu
          open={menuOpen}
          links={links}
          onClose={() => {
            setMenuOpen(false);
          }}
        />
      ) : null}
      {searchEver ? (
        <SearchOverlay
          open={searchOpen}
          onClose={() => {
            setSearchOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
