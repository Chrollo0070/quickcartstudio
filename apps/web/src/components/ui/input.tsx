import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border-0 bg-card px-3 text-sm text-ink ring-1 ring-inset ring-line placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent',
        className,
      )}
      {...props}
    />
  );
}
