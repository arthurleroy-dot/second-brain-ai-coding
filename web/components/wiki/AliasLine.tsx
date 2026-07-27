/**
 * Affiche la ligne « alias : … » d'une entité ou d'un thème — source unique de
 * vérité partagée entre les deux pages de détail. Filtre les alias égaux au
 * label (comparaison insensible à la casse / espaces) : un alias identique au
 * titre est du bruit. Ne rend rien s'il ne reste aucun alias distinct.
 */
export default function AliasLine({
  label,
  aliases,
}: {
  label: string;
  aliases: string[];
}) {
  const norm = (s: string) => s.trim().toLowerCase();
  const extra = aliases.filter((a) => a.trim() && norm(a) !== norm(label));
  if (extra.length === 0) return null;
  return <span className="text-xs text-gray-500">alias : {extra.join(', ')}</span>;
}
