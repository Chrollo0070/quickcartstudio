import type { Metadata } from 'next';
import { DesktopShell } from '@/components/desktop/desktop-shell';

export const metadata: Metadata = {
  title: 'QuickCart Desktop — Windows POS & Kiosk (.exe)',
  description:
    'Interactive QuickCart Electron Windows desktop application shell for POS register, self-checkout kiosk, thermal printing, and stockroom operations.',
};

export default function DesktopPage() {
  return <DesktopShell />;
}
