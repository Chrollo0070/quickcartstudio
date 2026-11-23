import fs from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse, type NextRequest } from 'next/server';
import { resolveArtifactFile, type DesktopArtifactTarget } from '@/lib/desktop-artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const rawTarget = request.nextUrl.searchParams.get('target');
  const target: DesktopArtifactTarget | null =
    rawTarget === 'zip' || rawTarget === 'nsis' || rawTarget === 'portable' ? rawTarget : null;

  if (!target) {
    return NextResponse.json(
      { error: 'Invalid target. Expected "zip", "nsis", or "portable".' },
      { status: 400 },
    );
  }

  const resolved = resolveArtifactFile(target);
  if (!resolved) {
    return NextResponse.json(
      {
        error:
          'Windows desktop artifact has not been built on this host yet. Run apps/desktop/build-exe.bat on Windows or trigger the GitHub Actions desktop-win-exe workflow.',
      },
      { status: 404 },
    );
  }

  const nodeStream = fs.createReadStream(resolved.filePath);
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': resolved.contentType,
      'Content-Disposition': `attachment; filename="${resolved.filename}"`,
      'Content-Length': String(resolved.stat.size),
      'Cache-Control': 'no-store',
    },
  });
}
