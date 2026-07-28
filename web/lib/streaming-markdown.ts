export interface StreamSplit {
  committed: string; // blocs terminés → ReactMarkdown
  active: string; // bloc en cours → texte brut
}

/**
 * Découpe le texte d'un message EN COURS de streaming en un préfixe « engagé »
 * (blocs markdown terminés, rendu stable) et un bloc « actif » (en cours
 * d'écriture, rendu en texte brut pour éviter les claquements de syntaxe).
 *
 * Règles :
 * 1. Si on est à l'intérieur d'un bloc de code non refermé (nombre IMPAIR de
 *    lignes-fence ``` ou ~~~), committed = tout ce qui précède la ligne
 *    d'ouverture de ce fence ; active = du fence à la fin.
 * 2. Sinon, committed = tout jusqu'au dernier `\n\n` inclus ; active = le reste
 *    (bloc en cours). Aucun `\n\n` → committed = '', active = tout.
 */
export function splitStreamingMarkdown(content: string): StreamSplit {
  // 1. Détecter un fence de code ouvert.
  const lines = content.split('\n');
  let fenceOpen = false;
  let fenceLineStartOffset = 0; // offset (en caractères) du début de la ligne d'ouverture
  let offset = 0;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fenceOpen) {
        fenceOpen = true;
        fenceLineStartOffset = offset;
      } else {
        fenceOpen = false;
      }
    }
    offset += line.length + 1; // +1 pour le '\n' retiré par split
  }
  if (fenceOpen) {
    return {
      committed: content.slice(0, fenceLineStartOffset),
      active: content.slice(fenceLineStartOffset),
    };
  }

  // 2. Dernier séparateur de bloc.
  const idx = content.lastIndexOf('\n\n');
  if (idx === -1) return { committed: '', active: content };
  return {
    committed: content.slice(0, idx + 2),
    active: content.slice(idx + 2),
  };
}
