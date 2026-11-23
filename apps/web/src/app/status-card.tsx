'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchHealth } from '@/lib/api-client';

function StatusPill({ state, label }: { state: 'ok' | 'down' | 'checking'; label: string }) {
  const styles =
    state === 'ok'
      ? 'bg-emerald-50 text-accent ring-accent/20'
      : state === 'down'
        ? 'bg-[#fef2f2] text-[#b91c1c] ring-[#dc2626]/20'
        : 'bg-raised text-ink-2 ring-line';
  const dot =
    state === 'ok' ? 'bg-accent' : state === 'down' ? 'bg-red-500' : 'bg-ink-3 animate-pulse';
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${styles}`}
    >
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {label}
    </span>
  );
}

export function StatusCard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <section className="rounded-2xl border border-line bg-card p-6 shadow-sm">
      <h2 className="text-sm font-medium text-ink-2">Platform status</h2>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {isPending ? (
          <StatusPill state="checking" label="Checking API…" />
        ) : isError || !data ? (
          <StatusPill state="down" label="API unreachable" />
        ) : (
          <>
            <StatusPill state="ok" label={`API · ${data.service}`} />
            <StatusPill
              state={data.checks.database === 'up' ? 'ok' : 'down'}
              label={data.checks.database === 'up' ? 'Database · up' : 'Database · down'}
            />
          </>
        )}
      </div>
      <p className="mt-4 text-sm text-ink-2">
        The status panel polls <code className="font-mono text-[13px]">GET /api/v1/health</code> —
        the same endpoint operators will use for readiness checks. Real-time updates (Socket.IO)
        arrive in Phase 4.
      </p>
    </section>
  );
}
