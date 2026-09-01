import { getDocumentProxy, renderPageAsImage, createIsomorphicCanvasFactory } from 'unpdf';

/**
 * Rendu PDF → PNG, à la demande, partagé par la passe vision (`vision-ingest.ts`),
 * la route d'image (`/api/raw-image`) et le rattrapage (`revise-figures`).
 *
 * Détail non-évident : `renderPageAsImage` d'unpdf ne fonctionne en Node QUE si le
 * `PDFDocumentProxy` a été créé AVEC un `CanvasFactory` adossé au binaire natif
 * `@napi-rs/canvas`. Un proxy créé « nu » (le `getDocumentProxy(bytes)` de
 * l'extraction texte) fait retomber pdfjs sur son canvas interne stubué qui jette
 * « @napi-rs/canvas is not available in this environment » dès qu'une page dessine
 * un motif/masque. On expose donc `openPdf(bytes)` qui équipe le proxy du bon
 * factory → un SEUL parse réutilisable pour extraction + aiguillage + rendu.
 *
 * `@napi-rs/canvas` est un module natif (`.node`) : il DOIT rester externe au bundle
 * (`serverComponentsExternalPackages` dans `next.config.js`) et présent dans
 * `standalone/node_modules` en Electron (cf. `copy-standalone-assets.js`).
 */

// Import paresseux du binaire natif — passé à unpdf pour chaque rendu. Voir le
// commentaire d'en-tête : sans lui, pdfjs jette en Node.
const canvasImport = () => import('@napi-rs/canvas');

/** Proxy pdfjs tel que le renvoie `getDocumentProxy` (type non ré-exporté par unpdf). */
export type PdfProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * Ouvre un PDF (octets) en proxy pdfjs ÉQUIPÉ du canvas natif → réutilisable pour
 * `extractText`, l'aiguillage (`getOperatorList`/`getTextContent`) ET `renderPdfPageToPng`.
 * À préférer à `getDocumentProxy(bytes)` dès qu'un rendu de page est prévu.
 */
export async function openPdf(bytes: Uint8Array | Buffer): Promise<PdfProxy> {
  const CanvasFactory = await createIsomorphicCanvasFactory(canvasImport);
  // Le champ `CanvasFactory` est un paramètre pdfjs (DocumentInitParameters) non
  // typé finement par unpdf → cast local ciblé.
  return getDocumentProxy(new Uint8Array(bytes), { CanvasFactory } as any);
}

/**
 * Rend une page (1-indexée) en PNG. Accepte soit des octets bruts (la route d'image
 * les a en main), soit un proxy déjà ouvert par `openPdf` (la passe vision le réutilise).
 * ⚠ Un proxy passé ici DOIT venir d'`openPdf` (équipé du canvas), sinon pdfjs jette.
 * `scale=2` vise un bord long ≲ 1568 px sur une diapo 16:9 (~1600 tokens image Anthropic).
 */
export async function renderPdfPageToPng(
  pdfOrBytes: PdfProxy | Uint8Array | Buffer,
  pageNumber: number,
  scale = 2,
): Promise<Buffer> {
  const data =
    pdfOrBytes instanceof Uint8Array || Buffer.isBuffer(pdfOrBytes)
      ? new Uint8Array(pdfOrBytes as Uint8Array)
      : pdfOrBytes;
  const ab = await renderPageAsImage(data as any, pageNumber, { scale, canvasImport });
  return Buffer.from(ab as ArrayBuffer);
}
