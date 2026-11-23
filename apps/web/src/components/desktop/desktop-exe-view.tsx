'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, HardDrive, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { DesktopArtifactInfo } from '@/lib/desktop-artifacts';
import {
  DESKTOP_SHORTCUTS,
  EXE_TARGETS,
  IPC_BRIDGE_CHANNELS,
  type ExeTargetSpec,
} from '@/lib/desktop-receipt';

async function fetchDesktopArtifacts(): Promise<{
  artifacts: DesktopArtifactInfo[];
  anyAvailable: boolean;
}> {
  const res = await fetch('/api/desktop/artifacts', { cache: 'no-store' });
  if (!res.ok) return { artifacts: [], anyAvailable: false };
  return (await res.json()) as { artifacts: DesktopArtifactInfo[]; anyAvailable: boolean };
}

export function DesktopExeView({
  isElectronRuntime,
  dataFilePath,
}: {
  isElectronRuntime: boolean;
  dataFilePath?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<'zip' | 'nsis' | 'portable'>('zip');
  const [copied, setCopied] = useState(false);

  const releaseUrl = process.env.NEXT_PUBLIC_DESKTOP_RELEASE_URL?.trim() || '';

  const artifactsQuery = useQuery({
    queryKey: ['desktop-exe-artifacts'],
    queryFn: fetchDesktopArtifacts,
  });

  const activeTarget: ExeTargetSpec =
    EXE_TARGETS.find((target) => target.id === selectedId) ?? EXE_TARGETS[0]!;

  const activeArtifact = artifactsQuery.data?.artifacts.find((item) => item.target === selectedId);

  const copyCommand = () => {
    void navigator.clipboard?.writeText(activeTarget.buildCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div data-testid="desktop-exe-view" className="flex flex-col gap-6">
      <section className="rounded-xl border border-line bg-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Windows .exe packaging architecture
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-2">
              QuickCart Desktop wraps the Next.js standalone server inside a hardened Electron shell
              under <code className="font-mono text-[13px] text-ink">apps/desktop</code> — ready to
              package as a Windows NSIS installer or single-file portable executable.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-raised p-1">
            {EXE_TARGETS.map((target) => (
              <button
                key={target.id}
                type="button"
                onClick={() => setSelectedId(target.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedId === target.id
                    ? 'bg-card text-ink shadow-xs'
                    : 'text-ink-2 hover:text-ink'
                }`}
              >
                {target.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <p className="font-mono text-sm font-semibold text-ink">{activeTarget.filename}</p>
            <p className="mt-1 text-xs text-ink-2">
              {activeArtifact?.available
                ? `${activeArtifact.sizeLabel} compiled binary · Windows 10/11 x64`
                : activeTarget.installFootprint}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-2">{activeTarget.startupFlow}</p>

            <ul className="mt-4 space-y-2 text-sm text-ink">
              {activeTarget.features.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col justify-between gap-4 rounded-xl border border-line bg-paper p-4">
            {activeArtifact?.available ? (
              <div>
                <p className="text-xs font-medium text-accent">Compiled Windows .exe ready</p>
                <p className="mt-1 text-sm text-ink">
                  Download the packaged Windows x64 executable built from this workspace.
                </p>
                <a
                  href={activeArtifact.downloadUrl}
                  download={activeArtifact.filename}
                  data-testid="download-exe-link"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-ink whitespace-nowrap"
                >
                  <Download className="size-4" aria-hidden />
                  Download {activeArtifact.filename} ({activeArtifact.sizeLabel})
                </a>
                {activeArtifact.sha256 && (
                  <p
                    data-testid="exe-sha256"
                    className="mt-2.5 break-all font-mono text-[11px] text-ink-3"
                  >
                    SHA-256: {activeArtifact.sha256}
                  </p>
                )}
              </div>
            ) : releaseUrl ? (
              <div>
                <p className="text-xs font-medium text-accent">Hosted release distribution</p>
                <p className="mt-1 text-sm text-ink">
                  Download signed-ready NSIS and Portable Windows builds from GitHub Releases.
                </p>
                <a
                  href={releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-ink whitespace-nowrap"
                >
                  <ExternalLink className="size-4" aria-hidden />
                  Open GitHub Releases
                </a>
              </div>
            ) : (
              <div>
                <p className="text-xs font-medium text-ink-2">Recommended deployment</p>
                <p className="mt-1 text-sm text-ink">{activeTarget.idealFor}</p>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-ink-2">
                Build on Windows (or GitHub Actions)
              </p>
              <pre className="mt-1.5 overflow-x-auto rounded-lg border border-line bg-card p-3 font-mono text-xs text-ink">
                {activeTarget.buildCommand}
              </pre>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" className="gap-1.5" onClick={copyCommand}>
                  {copied ? (
                    <>
                      <Check className="size-3.5 text-accent" aria-hidden />
                      Copied command
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" aria-hidden />
                      Copy build command
                    </>
                  )}
                </Button>
                <span className="font-mono text-[11px] text-ink-3">
                  or run apps\desktop\build-exe.bat
                </span>
              </div>
            </div>

            <div className="space-y-1 border-t border-line pt-3 text-xs text-ink-2">
              <p>
                <span className="font-medium text-ink">Current host:</span>{' '}
                {isElectronRuntime
                  ? 'Running inside packaged Electron shell (IPC active)'
                  : 'Browser preview mode (IPC simulated against live /api/v1)'}
              </p>
              <p className="truncate font-mono text-[11px] text-ink-3">
                Offline store: {dataFilePath ?? '%APPDATA%\\QuickCart\\quickcart-store.json'}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-ink">Preload IPC security boundary</h3>
              <p className="mt-0.5 text-xs text-ink-2">
                contextIsolation: true · nodeIntegration: false · sandbox: true
              </p>
            </div>
            <ShieldCheck className="size-5 text-accent" aria-hidden />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-2">
                  <th className="py-2 pr-3 font-medium">Channel</th>
                  <th className="py-2 pr-3 font-medium">Purpose</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {IPC_BRIDGE_CHANNELS.map((item) => (
                  <tr key={item.channel}>
                    <td className="py-2.5 pr-3 align-top font-mono text-xs text-ink">
                      {item.channel}
                    </td>
                    <td className="py-2.5 text-xs text-ink-2">{item.purpose}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-ink">Register shortcuts</h3>
            <HardDrive className="size-4 text-ink-3" aria-hidden />
          </div>
          <ul className="mt-4 divide-y divide-line text-sm">
            {DESKTOP_SHORTCUTS.map((sc) => (
              <li key={sc.key} className="flex items-center justify-between gap-3 py-2.5">
                <span className="text-ink-2">{sc.action}</span>
                <kbd className="shrink-0 rounded border border-line bg-paper px-2 py-0.5 font-mono text-xs font-medium text-ink">
                  {sc.key}
                </kbd>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
