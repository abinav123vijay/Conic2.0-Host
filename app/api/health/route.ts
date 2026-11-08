import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

export async function GET() {
  try {
    await (await getDb()).command({ ping: 1 });
    return NextResponse.json({ status: 'ok', service: 'conic-truck-2' });
  } catch (error) {
    console.error('Truck 2 health check failed:', error instanceof Error ? error.name : 'Unknown error');
    return NextResponse.json({ status: 'unavailable' }, { status: 503 });
  }
}
