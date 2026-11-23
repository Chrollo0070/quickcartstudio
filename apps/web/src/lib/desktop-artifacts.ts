import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type DesktopArtifactTarget = 'zip' | 'nsis' | 'portable';

export interface DesktopArtifactInfo {
  target: DesktopArtifactTarget;
  filename: string;
  available: boolean;
  sizeBytes: number;
  sizeLabel: string;
  sha256: string | null;
  modifiedAt: string | null;
  downloadUrl: string;
}

const ALLOWED_ARTIFACTS: Record<DesktopArtifactTarget, { filename: string; contentType: string }> =
  {
    zip: {
      filename: 'QuickCart-0.1.0-win-x64.zip',
      contentType: 'application/zip',
    },
    nsis: {
      filename: 'QuickCart-Setup-0.1.0.exe',
      contentType: 'application/vnd.microsoft.portable-executable',
    },
    portable: {
      filename: 'QuickCart-0.1.0-Portable.exe',
      contentType: 'application/vnd.microsoft.portable-executable',
    },
  };

const shaCache = new Map<string, { mtimeMs: number; size: number; sha256: string }>();

function resolveReleaseDir(): string {
  const candidates = [
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), 'apps', 'desktop', 'release'),
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..', 'desktop', 'release'),
    path.resolve(/*turbopackIgnore: true*/ process.cwd(), '..', '..', 'apps', 'desktop', 'release'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ dir)) return dir;
  }
  return candidates[0]!;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function computeFileSha256(filePath: string, stat: fs.Stats): string {
  const cached = shaCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.sha256;
  }
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(/*turbopackIgnore: true*/ filePath, 'r');
  try {
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  const digest = hash.digest('hex');
  shaCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, sha256: digest });
  return digest;
}

export function resolveArtifactFile(
  target: DesktopArtifactTarget,
): { filePath: string; filename: string; contentType: string; stat: fs.Stats } | null {
  const meta = ALLOWED_ARTIFACTS[target];
  if (!meta) return null;
  const releaseDir = resolveReleaseDir();
  const filePath = path.join(/*turbopackIgnore: true*/ releaseDir, meta.filename);
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) return null;
  const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
  if (!stat.isFile()) return null;
  return { filePath, filename: meta.filename, contentType: meta.contentType, stat };
}

export function listDesktopArtifacts(): DesktopArtifactInfo[] {
  const targets: DesktopArtifactTarget[] = ['zip', 'nsis', 'portable'];
  return targets.map((target) => {
    const meta = ALLOWED_ARTIFACTS[target];
    const resolved = resolveArtifactFile(target);
    if (!resolved) {
      return {
        target,
        filename: meta.filename,
        available: false,
        sizeBytes: 0,
        sizeLabel: 'Build on Windows / CI',
        sha256: null,
        modifiedAt: null,
        downloadUrl: `/api/desktop/download?target=${target}`,
      };
    }

    return {
      target,
      filename: meta.filename,
      available: true,
      sizeBytes: resolved.stat.size,
      sizeLabel: formatBytes(resolved.stat.size),
      sha256: computeFileSha256(resolved.filePath, resolved.stat),
      modifiedAt: resolved.stat.mtime.toISOString(),
      downloadUrl: `/api/desktop/download?target=${target}`,
    };
  });
}
