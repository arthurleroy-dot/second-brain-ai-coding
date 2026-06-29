import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/supabase';
import { slugify } from '@/lib/wiki-query';
import { ResourceType } from '@/types';

export const dynamic = 'force-dynamic';

const ACCEPTED_EXT = ['.md', '.txt', '.pdf', '.pptx', '.docx'];
const VALID_TYPES: ResourceType[] = [
  'article',
  'meeting_note',
  'interview',
  'presentation',
  'transcript',
  'personal_note',
  'unknown',
];

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function uuid(): string {
  // crypto.randomUUID est dispo dans le runtime Node de Next.
  return crypto.randomUUID();
}

export async function POST(req: NextRequest) {
  let db;
  try {
    db = requireAdmin();
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Requête multipart invalide' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Aucun fichier fourni' }, { status: 400 });
  }

  const filename = file.name;
  const extension = ext(filename);
  if (!ACCEPTED_EXT.includes(extension)) {
    return Response.json(
      { error: `Extension non supportée (${extension}). Acceptés : ${ACCEPTED_EXT.join(', ')}` },
      { status: 400 },
    );
  }

  // Métadonnées optionnelles du formulaire
  const author = (form.get('author') as string)?.trim() || null;
  const date = (form.get('date') as string)?.trim() || null;
  const depositedBy = (form.get('deposited_by') as string)?.trim() || null;
  const typeRaw = (form.get('type') as string)?.trim();
  const type: ResourceType = VALID_TYPES.includes(typeRaw as ResourceType)
    ? (typeRaw as ResourceType)
    : 'unknown';

  // 1. Upload du fichier brut dans Storage
  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${uuid()}-${filename}`;
  const { error: uploadErr } = await db.storage
    .from('raw-files')
    .upload(storagePath, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (uploadErr) {
    return Response.json(
      { error: `Upload Storage échoué : ${uploadErr.message}` },
      { status: 502 },
    );
  }

  // 2. Crée la ressource (status pending)
  const { data: resource, error: resErr } = await db
    .from('resources')
    .insert({
      title: filename,
      slug: slugify(filename),
      type,
      author,
      date,
      deposited_by: depositedBy,
      status: 'pending',
      needs_review: false,
      storage_path: storagePath,
    })
    .select()
    .single();
  if (resErr || !resource) {
    return Response.json(
      { error: `Création ressource échouée : ${resErr?.message ?? 'inconnu'}` },
      { status: 502 },
    );
  }

  // 3. Crée le job de traitement
  const { data: job, error: jobErr } = await db
    .from('processing_jobs')
    .insert({ resource_id: resource.id, status: 'queued' })
    .select()
    .single();
  if (jobErr || !job) {
    return Response.json(
      { error: `Création job échouée : ${jobErr?.message ?? 'inconnu'}` },
      { status: 502 },
    );
  }

  // 4. Déclenche le traitement en arrière-plan (non-bloquant)
  // On NE PAS await : la requête part et la route répond immédiatement.
  // (En local, le process Next persiste et exécute /api/process en parallèle.
  //  En prod serverless, prévoir un worker/Edge Function — cf. plan.)
  const origin = req.nextUrl.origin;
  void fetch(`${origin}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: job.id }),
  }).catch(() => {
    /* fire-and-forget : on ignore les erreurs réseau de déclenchement */
  });

  return Response.json({
    ok: true,
    resource_id: resource.id,
    job_id: job.id,
    status: 'pending',
  });
}
