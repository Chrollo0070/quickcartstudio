import { NextResponse } from 'next/server';
import { listDesktopArtifacts } from '@/lib/desktop-artifacts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const artifacts = listDesktopArtifacts();
  return NextResponse.json({
    artifacts,
    anyAvailable: artifacts.some((item) => item.available),
  });
}
