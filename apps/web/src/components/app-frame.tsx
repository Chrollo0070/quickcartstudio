'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from './site-header';

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/desktop')) {
    return <>{children}</>;
  }
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6">
      <SiteHeader />
      {children}
    </div>
  );
}
