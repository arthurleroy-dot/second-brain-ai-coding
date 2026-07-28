import { meaningfulAliases } from '@/lib/alias-rule';

/**
 * Affiche la ligne « alias : … » d'une entité ou d'un thème. Filtre les alias
 * égaux au label via la règle UNIQUE partagée (`meaningfulAliases`, également
 * appliquée à la source par le moteur `wiki-mutate`) : un alias identique au
 * titre est du bruit. Ne rend rien s'il ne reste aucun alias distinct.
 */
export default function AliasLine({
  label,
  aliases,
}: {
  label: string;
  aliases: string[];
}) {
  const extra = meaningfulAliases(aliases, label);
  if (extra.length === 0) return null;
  return <span className="text-xs text-gray-500">alias : {extra.join(', ')}</span>;
}
