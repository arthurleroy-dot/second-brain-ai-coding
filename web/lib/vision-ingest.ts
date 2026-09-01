import fs from 'fs/promises';
import path from 'path';
import { extractText, getResolvedPDFJS } from 'unpdf';
import { RAW_ROOT } from '@/lib/wiki-fs';
import { getAnthropic, getVisionModel } from '@/lib/claude';
import { openPdf, renderPdfPageToPng, type PdfProxy } from '@/lib/pdf-render';

/**
 * PASSE VISION (Étape A de la spec `2026-09-01-ingestion-vision-pdf`).
 *
 * Le texte d'un PDF est extrait EN LOCAL (gratuit). Mais schémas, tableaux-images,
 * courbes, timelines et pages scannées sont perdus par l'extraction texte. Cette passe,
 * PAGE PAR PAGE : (1) aiguille gratuitement chaque page (3 signaux pdf.js, aucun appel
 * IA) ; (2) sur les pages « visuelles », rend un PNG et le confie au modèle le MOINS cher
 * avec vision (Haiku), qui renvoie un fragment markdown (OCR verbatim du non-extrait +
 * blocs figure). Le tout est assemblé en une string `raw` page-ordonnée remise INCHANGÉE
 * au pipeline d'ingestion habituel (Étape B, texte seul).
 *
 * Robustesse : un échec d'appel vision (réseau, modèle non routé, timeout) ne fait JAMAIS
 * échouer le document — la page reste en texte seul, on logue et on continue.
 */

// ————————————————————————————————————————————————————————————————
// Constantes d'aiguillage — À CALIBRER (valeurs de départ mesurées sur les PDF de test,
// cf. spec §A.2 + Todo 5). Exportées pour permettre un test/tuning ciblé.

/** Signal 1 — couche texte quasi-vide (page scannée / 100 % image). */
export const VISION_TEXT_MIN = 20;
/** Signal 2 — une image matricielle couvre plus de cette fraction de la page. */
export const VISION_IMG_AREA_FRAC = 0.4;
/** Signal 3 — nb d'opérations de tracé vectoriel au-dessus duquel la page « dessine ». */
export const VISION_PATH_MIN = 40;
/** Signal 3 — nb minimal de fragments texte (étiquettes éparses d'un schéma). */
export const VISION_MIN_TEXT_ITEMS = 30;
/** Signal 3 — longueur moyenne MAX d'un fragment (au-delà = prose, pas des étiquettes). */
export const VISION_MAX_AVG_ITEM_LEN = 18;

// max_tokens de l'appel Haiku : marge pour un tableau dense sans exploser le coût
// (sortie Haiku = 5 $/1M → 3000 tokens ≈ 0,015 $, négligeable).
const VISION_MAX_TOKENS = 3000;

// ————————————————————————————————————————————————————————————————
// pdf.js OPS + helpers de matrice (mémoïsés)

let _ops: Record<string, number> | null = null;
async function getOps(): Promise<Record<string, number>> {
  if (!_ops) ({ OPS: _ops } = await getResolvedPDFJS());
  return _ops!;
}

/** Multiplication de deux matrices affines pdf.js [a,b,c,d,e,f] (Util.transform). */
function mulMatrix(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
/** Aire (valeur absolue du déterminant) du carré unité sous la matrice courante. */
function areaOf(m: number[]): number {
  return Math.abs(m[0] * m[3] - m[1] * m[2]);
}

// ————————————————————————————————————————————————————————————————
// Étape A.1 — extraction PDF PAR PAGE

/**
 * Extrait un PDF de `raw/` page par page. `pages[i]` = texte de la page `i+1`. Le proxy
 * retourné est ÉQUIPÉ du canvas natif (`openPdf`) → réutilisable pour l'aiguillage
 * (getOperatorList/getTextContent) ET le rendu (`renderPdfPageToPng`). Un SEUL parse.
 */
export async function extractPdfPerPage(file: string): Promise<{ pages: string[]; pdf: PdfProxy }> {
  const buf = await fs.readFile(path.join(RAW_ROOT, file));
  const pdf = await openPdf(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return { pages: text, pdf };
}

// ————————————————————————————————————————————————————————————————
// Étape A.2 — aiguillage par page (3 signaux gratuits)

export interface PageClassification {
  route: boolean;
  signals: string[];
}

/**
 * Décide si une page doit passer par la vision. Route si AU MOINS un signal est vrai :
 *  1. couche texte quasi-vide (< VISION_TEXT_MIN) ;
 *  2. une image matricielle couvre > VISION_IMG_AREA_FRAC de la page ;
 *  3. motif « schéma » : beaucoup de tracé vectoriel (> VISION_PATH_MIN) ET beaucoup de
 *     fragments texte courts (≥ VISION_MIN_TEXT_ITEMS, longueur moyenne ≤ VISION_MAX_AVG_ITEM_LEN).
 * Signaux 1 & 2 fiables ; 3 heuristique (ses ratés sont rattrapés manuellement, §D).
 */
export async function classifyPageForVision(
  pdf: PdfProxy,
  pageText: string,
  pageNumber: number,
): Promise<PageClassification> {
  const signals: string[] = [];

  // Signal 1 (avant tout appel pdf.js coûteux) — page scannée / vide.
  if (pageText.trim().length < VISION_TEXT_MIN) signals.push('texte-vide');

  try {
    const ops = await getOps();
    const IMG = new Set(
      [ops.paintImageXObject, ops.paintJpegXObject, ops.paintInlineImageXObject, ops.paintImageMaskXObject].filter(
        (x) => x !== undefined,
      ),
    );
    const PATH = new Set(
      [
        ops.constructPath,
        ops.stroke,
        ops.closeStroke,
        ops.fill,
        ops.eoFill,
        ops.fillStroke,
        ops.eoFillStroke,
        ops.closeFillStroke,
        ops.closeEOFillStroke,
      ].filter((x) => x !== undefined),
    );

    const page = await pdf.getPage(pageNumber);
    const vp = page.getViewport({ scale: 1 });
    const pageArea = vp.width * vp.height || 1;
    const ol = await page.getOperatorList();

    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    let maxImgFrac = 0;
    let pathOps = 0;
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      if (fn === ops.save) stack.push(ctm.slice());
      else if (fn === ops.restore) {
        if (stack.length) ctm = stack.pop()!;
      } else if (fn === ops.transform) ctm = mulMatrix(ctm, ol.argsArray[i] as number[]);
      else if (IMG.has(fn)) maxImgFrac = Math.max(maxImgFrac, areaOf(ctm) / pageArea);
      else if (PATH.has(fn)) pathOps++;
    }
    if (maxImgFrac > VISION_IMG_AREA_FRAC) signals.push('grosse-image');

    const tc = await page.getTextContent();
    const items = (tc.items as any[]).filter((it) => typeof it?.str === 'string');
    const nItems = items.length;
    const avgLen = nItems ? items.reduce((a, it) => a + it.str.length, 0) / nItems : 0;
    if (pathOps > VISION_PATH_MIN && nItems >= VISION_MIN_TEXT_ITEMS && avgLen <= VISION_MAX_AVG_ITEM_LEN) {
      signals.push('schema');
    }
  } catch {
    // Échec d'analyse pdf.js : on ne route QUE si le signal 1 (texte vide) a déjà parlé.
  }

  return { route: signals.length > 0, signals };
}

// ————————————————————————————————————————————————————————————————
// Étape A.4 — appel Haiku (helper vision dédié, NON-streaming)

/** Usage retourné par l'appel (forme structurellement compatible avec ingest-local `Usage`). */
export interface VisionUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

// Prompt statique chargé une fois (mémoïsé). Même racine que le prompt d'ingestion.
const REFERENCE_ROOT = process.env.REFERENCE_DOCS_ROOT ?? path.resolve(process.cwd(), '..');
const VISION_PROMPT_PATH = path.join(REFERENCE_ROOT, 'prompts', 'vision-figure-prompt.md');
let _visionPrompt: string | null = null;
async function loadVisionPrompt(): Promise<string> {
  if (_visionPrompt == null) _visionPrompt = await fs.readFile(VISION_PROMPT_PATH, 'utf-8');
  return _visionPrompt;
}

/** Ligne image EXACTE du bloc figure — ancre de page du rattrapage (§B/§D). */
export function figureImageLine(sourceFile: string, pageNumber: number): string {
  return `![figure page ${pageNumber}](/api/raw-image/${encodeURIComponent(sourceFile)}?page=${pageNumber})`;
}

/**
 * Transcrit UNE page (image + texte déjà extrait) via le modèle vision. NON-streaming
 * (en-tête coût `x-litellm-response-cost` fiable) et SANS le système caché de `callModel`.
 * Retourne un fragment markdown (peut être vide si la page n'apporte rien de visuel).
 */
export async function visionTranscribePage(args: {
  pngBase64: string;
  pageText: string;
  pageNumber: number;
  sourceFile: string;
  model?: string;
}): Promise<{ markdown: string; usage: VisionUsage; gatewayCost: number | null }> {
  const { pngBase64, pageText, pageNumber, sourceFile } = args;
  const model = args.model || getVisionModel();
  const staticPrompt = await loadVisionPrompt();

  const context =
    `Fichier source : ${sourceFile}\nNuméro de page : ${pageNumber}\n\n` +
    `LIGNE IMAGE à recopier EXACTEMENT dans chaque bloc figure (ne la modifie pas) :\n${figureImageLine(
      sourceFile,
      pageNumber,
    )}\n\n` +
    `Texte DÉJÀ extrait de cette page (ne le re-transcris PAS ; sert de référence pour ne\n` +
    `pas dupliquer la prose) :\n\`\`\`\n${pageText}\n\`\`\``;

  const { data, response } = await getAnthropic()
    .messages.create({
      model,
      max_tokens: VISION_MAX_TOKENS,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngBase64 } },
            { type: 'text', text: `${staticPrompt}\n\n---\n\n${context}` },
          ],
        },
      ],
    })
    .withResponse();

  const markdown = (data.content as any[])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const u = data.usage as any;
  const usage: VisionUsage = {
    input_tokens: u?.input_tokens ?? 0,
    output_tokens: u?.output_tokens ?? 0,
    cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
  };
  const gwRaw = response.headers.get('x-litellm-response-cost');
  const gatewayCost = gwRaw && Number.isFinite(parseFloat(gwRaw)) ? parseFloat(gwRaw) : null;
  return { markdown, usage, gatewayCost };
}

// ————————————————————————————————————————————————————————————————
// Étape A.5/A.6 — orchestration : extract → aiguillage → vision → assemblage

export interface VisionPageCost {
  page: number;
  usage: VisionUsage;
  gatewayCost: number | null;
}
export interface VisionPassResult {
  /** Document assemblé, page-ordonné (texte extrait + fragments Haiku), remis à l'ingestion. */
  raw: string;
  totalPages: number;
  /** Pages effectivement routées vers la vision (avec le(s) signal(aux) déclencheur(s)). */
  routed: { page: number; signals: string[] }[];
  /** Coût par page RÉELLEMENT transcrite (succès) — l'appelant somme au barème du modèle. */
  costs: VisionPageCost[];
}

/**
 * Exécute la passe vision complète sur un PDF de `raw/`. Assemble `pageText` + (si routée)
 * le fragment Haiku, dans l'ordre des pages. Tolérant aux pannes : un échec de transcription
 * laisse la page en texte seul. `log` (optionnel) trace par page (fichier de log ingestion).
 */
export async function runVisionPass(
  file: string,
  opts?: { model?: string; log?: (s: string) => void },
): Promise<VisionPassResult> {
  const log = opts?.log ?? (() => {});
  const model = opts?.model || getVisionModel();
  const { pages, pdf } = await extractPdfPerPage(file);
  const totalPages = pages.length;

  const routed: { page: number; signals: string[] }[] = [];
  const costs: VisionPageCost[] = [];
  const assembled: string[] = [];

  for (let i = 0; i < totalPages; i++) {
    const pageNumber = i + 1;
    const pageText = pages[i] ?? '';
    let block = pageText;

    const cls = await classifyPageForVision(pdf, pageText, pageNumber);
    if (cls.route) {
      routed.push({ page: pageNumber, signals: cls.signals });
      try {
        const png = await renderPdfPageToPng(pdf, pageNumber, 2);
        const { markdown, usage, gatewayCost } = await visionTranscribePage({
          pngBase64: png.toString('base64'),
          pageText,
          pageNumber,
          sourceFile: file,
          model,
        });
        costs.push({ page: pageNumber, usage, gatewayCost });
        if (markdown) block = pageText ? `${pageText}\n\n${markdown}` : markdown;
        log(`[vision] page ${pageNumber} [${cls.signals.join('+')}] → ${markdown ? markdown.length + ' car.' : 'vide'}`);
      } catch (e: any) {
        // Tolérance aux pannes : la page reste en texte seul, on continue.
        log(`[vision] ⚠ page ${pageNumber} échec vision (${e?.message ?? e}) → texte seul`);
      }
    }
    assembled.push(block);
  }

  return { raw: assembled.join('\n\n'), totalPages, routed, costs };
}
