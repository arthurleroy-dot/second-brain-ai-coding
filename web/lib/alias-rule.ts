/**
 * RÈGLE UNIQUE des alias « utiles » — source de vérité partagée, sans aucune
 * dépendance (importable partout : moteur déterministe `wiki-mutate` en relatif,
 * composant d'affichage `<AliasLine>`, script de nettoyage).
 *
 * Un alias identique au label est du bruit (le titre se répète lui-même) : on ne
 * le STOCKE jamais (filtre à la source, dans le moteur) NI ne l'AFFICHE (filet
 * dans la vue). Comparaison insensible à la casse et aux espaces de bord ;
 * dédoublonne au passage. Un alias qui ne diffère du titre que par la casse ou un
 * espace (« claude code » vs « Claude Code ») est considéré redondant ; une vraie
 * variante (« data bricks » vs « Databricks », « n8n.io » vs « n8n ») est gardée.
 */
export function meaningfulAliases(aliases: string[], label: string): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const nl = norm(label);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of aliases) {
    const t = a.trim();
    if (!t) continue;
    const k = norm(t);
    if (k === nl || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
