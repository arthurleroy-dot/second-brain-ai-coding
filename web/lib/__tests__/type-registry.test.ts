/**
 * Tests du registre de types de document ouvert (chantier 2026-07-28).
 * Lancé par `npm --prefix web run test` (node:test + tsx).
 *
 * Deux volets :
 *  1. Fonctions PURES du slug (`typeLabel`/`typeBadgeClass`) — overrides intégrés,
 *     dérivation du slug, palette stable par hash.
 *  2. `listTypeRegistry()` (lit le fs) — graine par défaut quand `wiki/types.json` est
 *     absent/vide/illisible ; sinon le fichier fait AUTORITÉ (liste telle quelle, plus
 *     d'union → un type par défaut retiré ne repousse pas). On pilote `WIKI_ROOT` vers un
 *     dossier temporaire AVANT le premier import (capté à l'éval de wiki-fs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
// EN PREMIER : fige WIKI_ROOT vers un tmp AVANT le chargement de wiki-fs (via wiki-parser).
import { wikiDir } from './_type-registry-env';
import {
  typeLabel,
  typeBadgeClass,
  typeOriginDefault,
  BUILTIN_TYPE_SLUGS,
  BUILTIN_TYPE_ORIGIN,
} from '../ui';
import { listTypeRegistry, listTypeRegistryFull } from '../wiki-parser';

// ————————————————————————————————————————————————————————————————
// typeLabel — override curé, sinon dérivation du slug

test('typeLabel : override curé pour les intégrés', () => {
  assert.equal(typeLabel('report-pdf'), 'Rapport PDF');
  assert.equal(typeLabel('personal-notes'), 'Note perso');
  assert.equal(typeLabel('unknown'), 'Inconnu');
});

test('typeLabel : dérivation du slug pour un type créé', () => {
  assert.equal(typeLabel('podcast'), 'Podcast');
  assert.equal(typeLabel('note-de-veille'), 'Note de veille');
  assert.equal(typeLabel('article'), 'Article');
});

test('typeLabel : vide → Inconnu', () => {
  assert.equal(typeLabel(''), 'Inconnu');
  assert.equal(typeLabel('   '), 'Inconnu');
});

test("'unknown' n'est PAS un type de menu mais reste un libellé de repli", () => {
  // Retiré de la graine (jamais choisissable au dépôt)…
  assert.ok(
    !BUILTIN_TYPE_SLUGS.includes('unknown' as never),
    "unknown ne doit pas figurer dans la graine du menu de dépôt",
  );
  // …mais garde son affichage curé pour une ressource sans type (normalizeType → 'unknown').
  assert.equal(typeLabel('unknown'), 'Inconnu');
});

// ————————————————————————————————————————————————————————————————
// typeBadgeClass — override curé, sinon palette stable par hash

test('typeBadgeClass : override connu pour un intégré', () => {
  assert.equal(typeBadgeClass('report-pdf'), 'bg-[#EAF0FB] text-[#2952A3]');
  assert.equal(typeBadgeClass('article'), 'bg-blue-50 text-blue-700');
});

test('typeBadgeClass : type créé → entrée de palette STABLE entre deux appels', () => {
  const a = typeBadgeClass('podcast');
  const b = typeBadgeClass('podcast');
  assert.equal(a, b); // déterministe (hash du slug)
  assert.match(a, /^bg-\w+-50 text-\w+-700$/); // bien une entrée de palette
});

// ————————————————————————————————————————————————————————————————
// listTypeRegistry — graine par défaut, puis fichier AUTORITAIRE (plus d'union)

const typesJson = path.join(wikiDir, 'types.json');

test('listTypeRegistry : graine par défaut quand wiki/types.json est absent', async () => {
  if (fs.existsSync(typesJson)) fs.rmSync(typesJson);
  const reg = await listTypeRegistry();
  assert.deepEqual(reg, [...BUILTIN_TYPE_SLUGS]);
});

test('listTypeRegistry : fichier vide {types:[]} → graine par défaut', async () => {
  fs.writeFileSync(typesJson, JSON.stringify({ types: [] }, null, 2) + '\n');
  const reg = await listTypeRegistry();
  assert.deepEqual(reg, [...BUILTIN_TYPE_SLUGS]);
});

test('listTypeRegistry : fichier non vide fait AUTORITÉ (liste telle quelle, dédoublonnée)', async () => {
  // Plus d'union : la liste écrite EST le registre (un doublon est juste dédoublonné).
  fs.writeFileSync(typesJson, JSON.stringify({ types: ['podcast', 'veille', 'podcast'] }, null, 2) + '\n');
  const reg = await listTypeRegistry();
  assert.deepEqual(reg, ['podcast', 'veille']);
});

test('listTypeRegistry : un type par défaut retiré du fichier ne réapparaît PAS', async () => {
  // La liste effective moins `interview` (cas suppression d'un type intégré inutilisé).
  const kept = BUILTIN_TYPE_SLUGS.filter((s) => s !== 'interview');
  fs.writeFileSync(typesJson, JSON.stringify({ types: kept }, null, 2) + '\n');
  const reg = await listTypeRegistry();
  assert.ok(!reg.includes('interview'), 'interview ne doit pas repousser depuis la graine');
  assert.deepEqual(reg, kept);
});

test('listTypeRegistry : fichier illisible → graine par défaut', async () => {
  fs.writeFileSync(typesJson, '{ pas du json');
  const reg = await listTypeRegistry();
  assert.deepEqual(reg, [...BUILTIN_TYPE_SLUGS]);
});

// ————————————————————————————————————————————————————————————————
// typeOriginDefault — graine binaire, repli externe

test('typeOriginDefault : interne / externe selon la graine, repli externe', () => {
  assert.equal(typeOriginDefault('personal-notes'), 'interne');
  assert.equal(typeOriginDefault('meeting-notes'), 'interne');
  assert.equal(typeOriginDefault('transcript'), 'interne');
  assert.equal(typeOriginDefault('article'), 'externe');
  assert.equal(typeOriginDefault('report-pdf'), 'externe');
  assert.equal(typeOriginDefault('unknown'), 'externe');
  // Slug créé inconnu → repli externe.
  assert.equal(typeOriginDefault('podcast'), 'externe');
  assert.equal(typeOriginDefault(''), 'externe');
});

// ————————————————————————————————————————————————————————————————
// listTypeRegistryFull — slug + origine (compat string/objet, graine)

test('listTypeRegistryFull : graine (fichier absent) = 7 slugs avec origines par défaut', async () => {
  if (fs.existsSync(typesJson)) fs.rmSync(typesJson);
  const full = await listTypeRegistryFull();
  assert.deepEqual(
    full,
    [...BUILTIN_TYPE_SLUGS].map((slug) => ({ slug, origin: BUILTIN_TYPE_ORIGIN[slug] })),
  );
});

test('listTypeRegistryFull : fichier objets {slug,origin} fait AUTORITÉ', async () => {
  fs.writeFileSync(
    typesJson,
    JSON.stringify(
      { types: [{ slug: 'podcast', origin: 'interne' }, { slug: 'veille', origin: 'externe' }] },
      null,
      2,
    ) + '\n',
  );
  const full = await listTypeRegistryFull();
  assert.deepEqual(full, [
    { slug: 'podcast', origin: 'interne' },
    { slug: 'veille', origin: 'externe' },
  ]);
});

test('listTypeRegistryFull : entrée string (ancien format) → origine par défaut', async () => {
  // `article` (string) → origine par défaut de son slug (externe) ; `transcript` → interne.
  fs.writeFileSync(typesJson, JSON.stringify({ types: ['article', 'transcript'] }, null, 2) + '\n');
  const full = await listTypeRegistryFull();
  assert.deepEqual(full, [
    { slug: 'article', origin: 'externe' },
    { slug: 'transcript', origin: 'interne' },
  ]);
});

test('listTypeRegistryFull : origine invalide → repli défaut du slug ; dédoublonnage', async () => {
  fs.writeFileSync(
    typesJson,
    JSON.stringify(
      { types: [{ slug: 'transcript', origin: 'zzz' }, { slug: 'transcript', origin: 'externe' }] },
      null,
      2,
    ) + '\n',
  );
  const full = await listTypeRegistryFull();
  // Origine invalide → repli défaut (transcript=interne) ; 2e occurrence dédoublonnée.
  assert.deepEqual(full, [{ slug: 'transcript', origin: 'interne' }]);
});
