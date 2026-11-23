import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Base card: white surface, warm-grey hairline, subtle shadow.
 * Default padding p-4 sm:p-6 — pass `p-0` when content (e.g. tables) manages
 * its own edge spacing.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-card p-4 shadow-[0_1px_2px_rgba(31,27,22,0.05)] sm:p-6',
        className,
      )}
      {...props}
    />
  );
}
