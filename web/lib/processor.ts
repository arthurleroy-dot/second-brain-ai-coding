import { parseOffice } from 'officeparser';
import { anthropic, CLAUDE_MODEL } from '@/lib/claude';
import { requireAdmin } from '@/lib/supabase';
import { slugify } from '@/lib/wiki-query';

// Slugs de topics canoniques (alignés sur le wiki existant).
const TOPIC_SLUGS = [
  'agentic-coding',
  'finops-ia',
  'outils-et-marche',
  'transformation-organisationnelle',
  'securite-et-risques',
  'context-engineering',
] as const;

const PROCESSING_PROMPT = `Tu es un agent qui analyse des documents et les retranscrit de façon structurée.

Pour ce document, tu dois produire un JSON avec EXACTEMENT ces champs :
{
  "title": "titre du document",
  "type": "article|meeting_note|interview|presentation|transcript|personal_note",
  "author": "auteur ou organisation (null si inconnu)",
  "date": "YYYY-MM-DD ou YYYY-MM ou YYYY (null si inconnu)",
  "topics": ["slug-topic-1", "slug-topic-2"],
  "needs_review": true/false,
  "summary": "3 à 5 lignes de contexte général",
  "full_content": "Retranscription quasi intégrale. Ne résume pas. Inclus tous les arguments, chiffres, sections, citations dans leur ordre d'apparition.",
  "key_concepts": ["concept 1", "concept 2"],
  "notable_quotes": ["citation 1", "citation 2"],
  "key_figures": ["chiffre/stat 1", "chiffre/stat 2"]
}

Topics disponibles (utilise ces slugs) :
- agentic-coding
- finops-ia
- outils-et-marche
- transformation-organisationnelle
- securite-et-risques
- context-engineering
Si le document traite d'un thème absent de cette liste, crée un nouveau slug en kebab-case.

Mets needs_review à true si une information importante (auteur, date, type) manque ou est incertaine.
Réponds UNIQUEMENT avec le JSON, sans markdown, sans explication.`;

interface ProcessedDoc {
  title: string | null;
  type: string;
  author: string | null;
  date: string | null;
  topics: string[];
  needs_review: boolean;
  summary: string | null;
  full_content: string | null;
  key_concepts: string[];
  notable_quotes: string[];
  key_figures: string[];
}

const VALID_TYPES = new Set([
  'article',
  'meeting_note',
  'interview',
  'presentation',
  'transcript',
  'personal_note',
  'unknown',
]);

function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

/** Extrait le texte brut d'un fichier selon son extension. */
async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const e = ext(filename);
  if (e === '.md' || e === '.txt') {
    return buffer.toString('utf-8');
  }
  if (e === '.pdf' || e === '.pptx' || e === '.docx') {
    const ast = await parseOffice(buffer);
    return ast.toText();
  }
  // Repli : on tente une lecture texte.
  return buffer.toString('utf-8');
}

/** Parse robuste du JSON renvoyé par Claude (tolère un wrapping ```json). */
function parseClaudeJson(raw: string): ProcessedDoc {
  let txt = raw.trim();
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    txt = txt.slice(start, end + 1);
  }
  const obj = JSON.parse(txt);

  const type = VALID_TYPES.has(obj?.type) ? obj.type : 'unknown';
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

  return {
    title: obj?.title ?? null,
    type,
    author: obj?.author ?? null,
    date: obj?.date ?? null,
    topics: arr(obj?.topics).map((t) => slugify(t)).filter(Boolean),
    needs_review: obj?.needs_review === true,
    summary: obj?.summary ?? null,
    full_content: obj?.full_content ?? null,
    key_concepts: arr(obj?.key_concepts),
    notable_quotes: arr(obj?.notable_quotes),
    key_figures: arr(obj?.key_figures),
  };
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Crée/récupère les topics et relie la ressource (resource_topics + resources.topics[]). */
async function linkTopics(resourceId: string, topicSlugs: string[]) {
  const db = requireAdmin();
  const slugs = [...new Set(topicSlugs)].filter(Boolean);
  if (slugs.length === 0) return;

  // Upsert des topics (ne touche pas aux titres existants grâce à ignoreDuplicates).
  await db.from('topics').upsert(
    slugs.map((slug) => ({
      slug,
      title: TOPIC_SLUGS.includes(slug as any)
        ? titleFromSlug(slug)
        : titleFromSlug(slug),
    })),
    { onConflict: 'slug', ignoreDuplicates: true },
  );

  const { data: topicRows } = await db
    .from('topics')
    .select('id, slug')
    .in('slug', slugs);

  if (topicRows && topicRows.length) {
    await db.from('resource_topics').upsert(
      topicRows.map((t: any) => ({ resource_id: resourceId, topic_id: t.id })),
      { onConflict: 'resource_id,topic_id', ignoreDuplicates: true },
    );
  }
}

/**
 * Traite un job de bout en bout : running → extraction → Claude → écriture DB → done/error.
 */
export async function processJob(jobId: string): Promise<void> {
  const db = requireAdmin();

  const { data: job } = await db
    .from('processing_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  if (!job) throw new Error(`Job introuvable: ${jobId}`);

  const resourceId = job.resource_id as string;

  await db
    .from('processing_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId);
  await db
    .from('resources')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .eq('id', resourceId);

  try {
    const { data: resource } = await db
      .from('resources')
      .select('*')
      .eq('id', resourceId)
      .single();
    if (!resource) throw new Error(`Ressource introuvable: ${resourceId}`);
    if (!resource.storage_path) throw new Error('storage_path manquant');

    // 1. Télécharge le fichier depuis Storage
    const { data: blob, error: dlErr } = await db.storage
      .from('raw-files')
      .download(resource.storage_path);
    if (dlErr || !blob) {
      throw new Error(`Téléchargement échoué: ${dlErr?.message ?? 'inconnu'}`);
    }
    const buffer = Buffer.from(await blob.arrayBuffer());

    // 2. Extraction texte
    const filename = resource.title || resource.storage_path;
    const text = await extractText(buffer, filename);
    if (!text.trim()) throw new Error('Aucun texte extrait du fichier');

    // 3. Appel Claude
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8000,
      system: PROCESSING_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Voici le document à analyser :\n\n${text}`,
        },
      ],
    });
    const rawText = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('\n')
      .trim();

    // 4. Parse JSON
    const doc = parseClaudeJson(rawText);

    // 5. Met à jour la ressource (conserve le titre formulaire si Claude n'en donne pas)
    const finalTitle = doc.title || resource.title || null;
    await db
      .from('resources')
      .update({
        title: finalTitle,
        slug: finalTitle ? slugify(finalTitle) : resource.slug,
        type: doc.type,
        author: doc.author ?? resource.author ?? null,
        date: doc.date ?? resource.date ?? null,
        topics: doc.topics,
        needs_review: doc.needs_review,
        status: 'done',
        updated_at: new Date().toISOString(),
      })
      .eq('id', resourceId);

    // 6. Contenu structuré (upsert pour idempotence)
    await db.from('resource_content').insert({
      resource_id: resourceId,
      summary: doc.summary,
      full_content: doc.full_content,
      key_concepts: doc.key_concepts,
      notable_quotes: doc.notable_quotes,
      key_figures: doc.key_figures,
    });

    // 7. Topics
    await linkTopics(resourceId, doc.topics);

    // 8. Job done
    await db
      .from('processing_jobs')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', jobId);
  } catch (e: any) {
    const message = e?.message ?? 'Erreur inconnue';
    await db
      .from('processing_jobs')
      .update({
        status: 'error',
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId);
    await db
      .from('resources')
      .update({ status: 'error', updated_at: new Date().toISOString() })
      .eq('id', resourceId);
    throw e;
  }
}
