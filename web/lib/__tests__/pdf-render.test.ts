/**
 * Test du rendu PDF → PNG (`pdf-render.ts`). Auto-contenu : un PDF minimal 1 page
 * construit en mémoire (aucune dépendance à un fichier de `raw/`, non committé), pour
 * rester déterministe en CI. On prouve deux choses : le binaire natif `@napi-rs/canvas`
 * se charge (sinon `renderPageAsImage` jette « not available in this environment ») et
 * le buffer retourné est un vrai PNG (signature `89 50 4E 47`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPdfPageToPng, openPdf } from '../pdf-render';

// PDF 1 page, MediaBox 120×120, un rectangle rouge tracé (contenu non vide). Le xref
// volontairement absent est reconstruit par pdfjs (mode recovery) → suffisant pour rendre.
const MINIMAL_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 120 120]/Contents 4 0 R/Resources<<>>>>endobj',
    '4 0 obj<</Length 40>>stream',
    '1 0 0 RG 10 10 100 100 re S',
    'endstream endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'),
  'latin1',
);

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('renderPdfPageToPng (octets) → PNG non vide', async () => {
  const png = await renderPdfPageToPng(MINIMAL_PDF, 1, 2);
  assert.ok(png.length > 0, 'buffer non vide');
  assert.ok(png.subarray(0, 4).equals(PNG_SIG), 'signature PNG en tête');
});

test('renderPdfPageToPng (proxy openPdf réutilisé) → PNG non vide', async () => {
  // Chemin de la passe vision : un SEUL parse, réutilisé pour le rendu.
  const pdf = await openPdf(MINIMAL_PDF);
  assert.equal(pdf.numPages, 1);
  const png = await renderPdfPageToPng(pdf, 1, 2);
  assert.ok(png.length > 0 && png.subarray(0, 4).equals(PNG_SIG));
});
