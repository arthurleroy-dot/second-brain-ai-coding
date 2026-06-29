import { anthropic, CLAUDE_MODEL, isClaudeConfigured } from '@/lib/claude';
import { readWikiFile, writeWikiFile, wikiExists } from '@/lib/wiki-fs';

export interface EnrichResource {
  title: string;
  type: string;
  author: string | null;
  date: string | null;
  full_content: string;
  key_concepts: string[];
  notable_quotes: string[];
  key_figures: string[];
}

/**
 * Enrichit (ou crée) la fiche thématique `wiki/by-topic/<slug>.md` avec une
 * nouvelle ressource. N'écrase jamais l'existant : la fiche est réécrite avec
 * l'ajout intégré par Claude. Conçu pour être appelé en best-effort (les erreurs
 * sont remontées à l'appelant qui les log sans faire échouer le traitement).
 */
export async function enrichTopicWithResource(
  topicSlug: string,
  resource: EnrichResource,
): Promise<void> {
  if (!isClaudeConfigured()) {
    throw new Error('Anthropic non configuré (ANTHROPIC_API_KEY manquant)');
  }

  const relPath = `by-topic/${topicSlug}.md`;
  const exists = await wikiExists(relPath);
  const existingContent = exists ? await readWikiFile(relPath) : null;

  const resourceBlock = `Titre : ${resource.title}
Type : ${resource.type}
Auteur : ${resource.author || 'inconnu'}
Date : ${resource.date || 'inconnue'}
Contenu pertinent pour ce thème :
${resource.full_content}
Concepts clés : ${resource.key_concepts.join(', ')}
Citations : ${resource.notable_quotes.join(' | ')}
Chiffres : ${resource.key_figures.join(', ')}`;

  const prompt = existingContent
    ? `Tu enrichis une fiche thématique d'un wiki sur l'AI Coding avec une nouvelle ressource.

Règles strictes :
- Ne supprime AUCUNE information existante. Tu enrichis uniquement.
- Intègre uniquement les parties de la ressource qui concernent ce thème.
- Ajoute les concepts, citations et chiffres nouveaux dans les sections pertinentes.
- Ajoute la ressource au tableau « Sources complètes » si elle n'y est pas déjà.
- Mets à jour la ligne de métadonnée « > Dernière mise à jour … — N sources » (incrémente le compteur).
- Conserve la structure et les sections existantes (mêmes titres).
- Utilise les cross-références [[autre-topic]] quand c'est pertinent.

FICHE EXISTANTE :
${existingContent}

NOUVELLE RESSOURCE :
${resourceBlock}

Retourne UNIQUEMENT la fiche complète mise à jour en markdown, sans bloc de code ni commentaire.`
    : `Crée une fiche thématique de synthèse pour le thème "${topicSlug}" d'un wiki sur l'AI Coding, à partir de cette ressource.

NOUVELLE RESSOURCE :
${resourceBlock}

Format attendu (markdown) :
# [Titre lisible du thème]
> Dernière mise à jour : ${resource.date || 'récemment'} — 1 source

## Synthèse
[3 à 6 lignes de synthèse]

## Points clés
- [points]

## Par type de source
### Articles et rapports
### Notes de réunion
### Interviews clients
### Autres sources

## Évolution dans le temps
[à enrichir]

## Sources complètes
| Titre | Auteur | Type | Date |
|-------|--------|------|------|
| ${resource.title} | ${resource.author || 'inconnu'} | ${resource.type} | ${resource.date || 'inconnue'} |

## Concepts clés
- [concepts]

Retourne UNIQUEMENT le markdown, sans bloc de code ni commentaire.`;

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: prompt }],
  });

  const updated = response.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();

  if (!updated) {
    throw new Error('Réponse vide de Claude');
  }

  // Sécurité : on retire un éventuel wrapping ```markdown … ```.
  const cleaned = updated
    .replace(/^```(?:markdown)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();

  await writeWikiFile(relPath, cleaned + '\n');
}
