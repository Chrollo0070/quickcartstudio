'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { fetchMe } from '@/lib/api-client';
import { Card } from '@/components/ui/card';

export default function AccountPage() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });

  if (meQuery.isPending) {
    return <p className="p-8 text-sm text-ink-2">Checking your session…</p>;
  }
  if (meQuery.isError) {
    router.replace('/login');
    return null;
  }

  const me = meQuery.data;

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{me.fullName}</h1>
        <p className="mt-1 text-sm text-ink-2">{me.email}</p>
      </div>
      <Card>
        <h2 className="text-sm font-medium text-ink-2">Roles</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {me.roles.map((role) => (
            <span
              key={role}
              className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-accent ring-1 ring-inset ring-accent/20"
            >
              {role}
            </span>
          ))}
        </div>
        <h2 className="mt-6 text-sm font-medium text-ink-2">Permissions</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {me.permissions.map((permission) => (
            <span
              key={permission}
              className="rounded bg-raised px-2 py-0.5 font-mono text-xs text-ink-2"
            >
              {permission}
            </span>
          ))}
        </div>
        <h2 className="mt-6 text-sm font-medium text-ink-2">Home branch</h2>
        <p className="mt-2 text-sm text-zinc-700">
          {me.branch ? `${me.branch.name} (${me.branch.code})` : 'No branch assigned'}
        </p>
        <p className="mt-4 text-xs text-ink-3">
          Last sign-in:{' '}
          {me.lastLoginAt ? new Date(me.lastLoginAt).toLocaleString() : 'first session'}
        </p>
      </Card>
    </div>
  );
}
