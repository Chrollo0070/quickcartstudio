#!/usr/bin/env node
/**
 * Stages the Next.js standalone server output (apps/web/.next/standalone)
 * alongside static chunks and public assets into apps/desktop/resources/standalone
 * before electron-builder creates the Windows .exe installer and portable build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webDir = path.join(repoRoot, 'apps', 'web');
const standaloneSrc = path.join(webDir, '.next', 'standalone');
const staticSrc = path.join(webDir, '.next', 'static');
const publicSrc = path.join(webDir, 'public');
const targetDir = path.resolve(__dirname, '..', 'resources', 'standalone');

if (!fs.existsSync(standaloneSrc)) {
  console.error(
    'Missing apps/web/.next/standalone. Run "npm run build" at the repository root first.',
  );
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(standaloneSrc, targetDir, { recursive: true });

const webTargetDir = fs.existsSync(path.join(targetDir, 'apps', 'web'))
  ? path.join(targetDir, 'apps', 'web')
  : targetDir;

if (fs.existsSync(staticSrc)) {
  const staticDest = path.join(webTargetDir, '.next', 'static');
  fs.mkdirSync(path.dirname(staticDest), { recursive: true });
  fs.cpSync(staticSrc, staticDest, { recursive: true });
}

if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, path.join(webTargetDir, 'public'), { recursive: true });
}

console.log(`Staged QuickCart standalone runtime into ${targetDir}`);
