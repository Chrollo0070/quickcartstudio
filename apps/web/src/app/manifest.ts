import type { MetadataRoute } from 'next';

/** PWA manifest — the self-checkout scanner is installable on a phone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QuickCart Self-Checkout',
    short_name: 'QuickCart',
    description: 'Scan, cart, pay — supermarket self-checkout for the QuickMart demo store.',
    start_url: '/shop',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#059669',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon.svg',
        type: 'image/svg+xml',
        sizes: 'any',
        purpose: 'any',
      },
    ],
  };
}
