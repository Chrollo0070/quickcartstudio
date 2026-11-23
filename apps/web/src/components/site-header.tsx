'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fetchMe, logout } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from './ui/button';

function Wordmark() {
  return (
    <span className="flex items-center gap-2">
      {/* Flat scan-line mark: three bars, one accent */}
      <span
        className="flex h-5 w-5 flex-col justify-between rounded-[4px] bg-ink p-[3px]"
        aria-hidden
      >
        <span className="h-[2px] w-full rounded-full bg-card" />
        <span className="h-[2px] w-full rounded-full bg-accent" />
        <span className="h-[2px] w-full rounded-full bg-card" />
      </span>
      <span className="text-[17px] font-semibold tracking-tight">
        Quick<span className="text-accent">Cart</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const clearSession = useAuthStore((state) => state.clearSession);

  // Keeps the header accurate after a page reload: a valid httpOnly refresh
  // cookie restores the session (and repopulates the store) via /users/me.
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearSession();
      queryClient.clear();
      router.push('/login');
    },
  });

  const signedIn = Boolean(user) || meQuery.isSuccess;

  return (
    <header className="flex h-16 items-center justify-between py-2">
      <Link href="/" className="flex items-center">
        <Wordmark />
      </Link>
      <nav className="flex items-center gap-5 text-sm">
        {signedIn ? (
          <>
            <Link href="/shop" className="text-ink-2 transition-colors hover:text-ink">
              Shop
            </Link>
            <Link href="/pos" className="text-ink-2 transition-colors hover:text-ink">
              Register
            </Link>
            <Link href="/catalogue" className="text-ink-2 transition-colors hover:text-ink">
              Catalogue
            </Link>
            <Link href="/dashboard" className="text-ink-2 transition-colors hover:text-ink">
              Live
            </Link>
            <Link href="/inventory" className="text-ink-2 transition-colors hover:text-ink">
              Stock
            </Link>
            <Link href="/desktop" className="text-ink-2 transition-colors hover:text-ink whitespace-nowrap">
              Desktop
            </Link>
            <Link href="/account" className="text-ink-2 transition-colors hover:text-ink whitespace-nowrap">
              {user?.fullName ?? 'Account'}
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              Sign out
            </Button>
          </>
        ) : (
          <>
            <Link href="/desktop" className="text-ink-2 transition-colors hover:text-ink whitespace-nowrap">
              Desktop app
            </Link>
            <Link href="/login" className="font-medium text-accent transition-colors hover:text-ink whitespace-nowrap">
              Staff sign in
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}
