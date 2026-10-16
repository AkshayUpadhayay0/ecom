import { Outlet } from 'react-router';
import { SectionTabs } from '@/components/SectionTabs';

/** Products section: catalogue + clothing types (sub-tabs). */
export function ProductsLayout() {
  return (
    <div className="space-y-6">
      <SectionTabs
        label="Products sections"
        tabs={[
          { label: 'Products', to: '/products', end: true },
          { label: 'Clothing types', to: '/products/clothing-types' },
        ]}
      />
      <Outlet />
    </div>
  );
}
