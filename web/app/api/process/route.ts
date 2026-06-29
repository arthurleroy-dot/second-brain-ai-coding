import { NextRequest } from 'next/server';
import { processJob } from '@/lib/processor';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let jobId: string | undefined;
  try {
    const body = await req.json();
    jobId = body?.job_id;
  } catch {
    return Response.json({ error: 'Corps JSON invalide' }, { status: 400 });
  }

  if (!jobId) {
    return Response.json({ error: 'job_id manquant' }, { status: 400 });
  }

  try {
    await processJob(jobId);
    return Response.json({ ok: true, job_id: jobId, status: 'done' });
  } catch (e: any) {
    // L'erreur est déjà persistée (status='error') par processJob.
    return Response.json(
      { ok: false, job_id: jobId, status: 'error', error: e?.message ?? 'inconnu' },
      { status: 500 },
    );
  }
}
