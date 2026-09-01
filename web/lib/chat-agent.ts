import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropic, getModel } from '@/lib/claude';
import { listWikiDir, readWikiFile, wikiExists } from '@/lib/wiki-fs';

/**
 * Agent de navigation du wiki pour le chat (docs/wiki-spec.md §7, lecture par
 * paliers). Deux outils seulement — lire une page, lister un dossier — la
 * sécurité chemin est déléguée à resolveUnder (wiki-fs) + restriction `.md`.
 * `/raw` est inaccessible (v1).
 */

export const MAX_PAGE_CHARS = 30_000;

export const WIKI_TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: 'read_wiki_page',
    description:
      "Lit une page markdown du wiki et renvoie son contenu intégral (frontmatter YAML inclus). " +
      'Chemins relatifs à la racine du wiki : index.md · themes/<slug>.md · authors/<slug>.md · ' +
      'entities/<slug>.md · by-date/<YYYY>/<YYYY>.md · by-date/<YYYY>/<YYYY-MM>/<YYYY-MM>.md · ' +
      'types.md · origin/interne.md · origin/externe.md · resources/<slug>.md (fiches canoniques).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
  {
    name: 'list_wiki_folder',
    description:
      "Liste les noms des entrées (fichiers et sous-dossiers) d'un dossier du wiki, un nom par ligne. " +
      "Chemin '' ou '.' = racine. Sert à trouver un chemin exact ou à recouper un sommaire " +
      '(ex. resources/ pour vérifier qu\'aucune fiche ne manque). Lister = noms seulement.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
];

export interface WikiToolResult {
  content: string;
  isError: boolean;
}

/** Normalisation tolérante des chemins fournis par le modèle. */
function normalizePath(raw: string): string {
  let p = raw.trim().replace(/^\/+/, '');
  if (p === 'wiki') return '';
  if (p.startsWith('wiki/')) p = p.slice('wiki/'.length);
  if (p === '.') return '';
  return p;
}

// Bruit exclu des listings (état machine, pas du contenu navigable).
const LISTING_NOISE = /^(_candidates\.json|_ingested\.json|.*\.canvas)$/;

/** Exécute un outil wiki. Toute erreur → résultat `isError` (jamais d'exception). */
export async function executeWikiTool(
  name: string,
  input: unknown,
  maxChars: number = MAX_PAGE_CHARS,
): Promise<WikiToolResult> {
  const rawPath = (input as { path?: unknown })?.path;
  if (typeof rawPath !== 'string') {
    return { content: "Paramètre `path` manquant ou invalide (chaîne attendue).", isError: true };
  }
  const p = normalizePath(rawPath);

  if (name === 'read_wiki_page') {
    if (!p.endsWith('.md')) {
      return {
        content: `Seules les pages .md du wiki sont lisibles (reçu : ${rawPath}).`,
        isError: true,
      };
    }
    if (!(await wikiExists(p))) {
      return {
        content: `Page introuvable : ${p}. Vérifie le chemin avec list_wiki_folder sur le dossier parent.`,
        isError: true,
      };
    }
    const content = await readWikiFile(p);
    if (content.length > maxChars) {
      return {
        content:
          content.slice(0, maxChars) +
          `\n[--- CONTENU TRONQUÉ : ${content.length} caractères au total, ${maxChars} affichés ---]`,
        isError: false,
      };
    }
    return { content, isError: false };
  }

  if (name === 'list_wiki_folder') {
    if (!(await wikiExists(p))) {
      return {
        content: `Dossier introuvable : ${p || 'racine'}. Vérifie le chemin avec list_wiki_folder sur le dossier parent.`,
        isError: true,
      };
    }
    const entries = (await listWikiDir(p)).filter((e) => !LISTING_NOISE.test(e));
    return { content: entries.length ? entries.join('\n') : '(dossier vide)', isError: false };
  }

  return { content: `Outil inconnu : ${name}.`, isError: true };
}

// ————————————————————————————————————————————————————————————————
// Boucle agentique

export const MAX_ITERATIONS = 15;

const NUDGE_TEXT =
  "[Système] Limite d'exploration atteinte. Réponds MAINTENANT à partir de ce que tu as " +
  "déjà lu, sans nouvel appel d'outil. Si l'information manque, dis-le et cite SOURCES: []";

export interface AgentCallbacks {
  onText(delta: string): void; // deltas de texte bruts (masquage SOURCES fait par la route)
  onStep(step: { label: string; tool: string; path: string }): void;
}

// Sous-ensemble structurel du client Anthropic utilisé par la boucle — permet
// d'injecter un client mocké dans les tests (le vrai `anthropic` le satisfait).
// On ne consomme QUE l'itérateur d'événements bruts, jamais finalMessage() :
// le proxy LiteLLM clôt la connexion en « Premature close » APRÈS message_stop,
// ce qui ferait rejeter finalMessage() alors que le message est complet.
export interface WikiAgentClient {
  messages: {
    stream(
      params: {
        model: string;
        max_tokens: number;
        system: string;
        messages: Anthropic.Messages.MessageParam[];
        tools: Anthropic.Messages.Tool[];
      },
      options?: { signal?: AbortSignal },
    ): AsyncIterable<Anthropic.Messages.MessageStreamEvent>;
  };
}

// Message final reconstruit depuis les événements bruts d'une itération.
interface TurnResult {
  stopReason: string | null;
  text: Array<{ index: number; text: string }>;
  toolUses: Array<{ index: number; id: string; name: string; input: unknown }>;
}

/**
 * Consomme un stream d'événements bruts et reconstruit le tour complet.
 * Tolère une erreur de fin de flux survenant APRÈS message_stop (quirk
 * LiteLLM) ; toute erreur avant la fin du message est remontée telle quelle.
 */
async function consumeTurn(
  stream: AsyncIterable<Anthropic.Messages.MessageStreamEvent>,
  onText: (delta: string) => void,
): Promise<TurnResult> {
  const text = new Map<number, string>();
  const toolMeta = new Map<number, { id: string; name: string }>();
  const toolJson = new Map<number, string>();
  let stopReason: string | null = null;
  let completed = false;

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'tool_use') {
          toolMeta.set(event.index, {
            id: event.content_block.id,
            name: event.content_block.name,
          });
        }
      } else if (event.type === 'content_block_delta') {
        if (event.delta.type === 'text_delta') {
          if (event.delta.text) {
            text.set(event.index, (text.get(event.index) ?? '') + event.delta.text);
            onText(event.delta.text);
          }
        } else if (event.delta.type === 'input_json_delta') {
          toolJson.set(event.index, (toolJson.get(event.index) ?? '') + event.delta.partial_json);
        }
      } else if (event.type === 'message_delta') {
        stopReason = event.delta.stop_reason ?? stopReason;
      } else if (event.type === 'message_stop') {
        completed = true;
      }
    }
  } catch (err) {
    if (!completed) throw err; // vraie erreur amont (le message n'était pas fini)
  }

  return {
    stopReason,
    text: [...text.entries()]
      .map(([index, t]) => ({ index, text: t }))
      .filter((b) => b.text.length > 0),
    toolUses: [...toolMeta.entries()].map(([index, meta]) => {
      let input: unknown = {};
      const json = toolJson.get(index) ?? '';
      if (json) {
        try {
          input = JSON.parse(json);
        } catch {
          input = {};
        }
      }
      return { index, id: meta.id, name: meta.name, input };
    }),
  };
}

function stepLabel(tool: string, path: string): string {
  return tool === 'list_wiki_folder'
    ? `Exploration du dossier ${path || 'racine'}`
    : `Lecture de ${path}`;
}

/**
 * Boucle de tool use manuelle (SDK 0.39, pas de tool runner) : stream → texte
 * relayé en direct → exécution séquentielle des tool_use → tool_results dans UN
 * message user → itération suivante. Disjoncteurs : MAX_ITERATIONS + deadlineMs
 * (nudge textuel — on ne retire jamais `tools`, l'API l'exige dès que
 * l'historique contient des blocs tool_use).
 */
export async function runWikiAgent(opts: {
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  callbacks: AgentCallbacks;
  deadlineMs?: number; // échéance absolue (Date.now())
  client?: WikiAgentClient; // injection pour les tests (défaut : anthropic)
  model?: string; // défaut : CLAUDE_MODEL
  signal?: AbortSignal; // annulation client (bouton Stop) propagée au stream
}): Promise<{ rawText: string; iterations: number }> {
  const client = opts.client ?? (getAnthropic() as WikiAgentClient);
  const model = opts.model ?? getModel();
  const loopMessages: Anthropic.Messages.MessageParam[] = opts.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let rawText = '';
  let nudged = false;
  let postNudgeErrorSent = false;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    // Annulation (bouton Stop) survenue pendant l'exécution des outils : on
    // sort avec le texte accumulé au lieu de relancer une itération.
    if (opts.signal?.aborted) break;

    // Le proxy LiteLLM tue parfois un flux à la racine (zéro événement reçu).
    // Dans ce cas — et seulement dans ce cas — on retente UNE fois : rien n'a
    // été émis au client ni engagé dans l'historique, la relance est invisible.
    // Si du texte est déjà parti, on remonte l'erreur (un retry dupliquerait).
    let turn: TurnResult | undefined;
    for (let attempt = 1; ; attempt++) {
      const textBefore = rawText.length;
      try {
        const stream = client.messages.stream(
          {
            model,
            max_tokens: 8000,
            system: opts.system,
            messages: loopMessages,
            tools: WIKI_TOOLS,
          },
          { signal: opts.signal },
        );
        turn = await consumeTurn(stream, (delta) => {
          rawText += delta;
          opts.callbacks.onText(delta);
        });
        break;
      } catch (err) {
        // AbortError volontaire (AVANT message_stop) : à remonter tel quel,
        // jamais retenté — à ne pas confondre avec le quirk « Premature
        // close » APRÈS message_stop, déjà toléré par consumeTurn.
        if (opts.signal?.aborted) throw err;
        if (attempt >= 2 || rawText.length > textBefore) throw err;
      }
    }

    const toolUses = turn.toolUses;
    if (turn.stopReason !== 'tool_use' || toolUses.length === 0) {
      return { rawText, iterations: iteration };
    }

    // Le modèle appelle encore un outil après le tool_result d'erreur post-nudge :
    // on sort avec le texte accumulé (disjoncteur final).
    if (postNudgeErrorSent) break;

    // Écho assistant reconstruit, dans l'ordre des blocs (les blocs texte vides
    // émis par le proxy avant un tool_use sont écartés : l'API les refuse).
    const assistantContent: Anthropic.Messages.ContentBlockParam[] = [
      ...turn.text.map((b) => ({ index: b.index, block: { type: 'text', text: b.text } as const })),
      ...toolUses.map((t) => ({
        index: t.index,
        block: { type: 'tool_use', id: t.id, name: t.name, input: t.input } as const,
      })),
    ]
      .sort((a, b) => a.index - b.index)
      .map((e) => e.block as Anthropic.Messages.ContentBlockParam);
    loopMessages.push({ role: 'assistant', content: assistantContent });

    const resultBlocks: Anthropic.Messages.ContentBlockParam[] = [];
    if (nudged) {
      // Appel d'outil malgré le nudge : une seule réponse d'erreur, sans exécution.
      for (const tu of toolUses) {
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Limite atteinte, réponds sans outil.',
          is_error: true,
        });
      }
      postNudgeErrorSent = true;
    } else {
      for (const tu of toolUses) {
        const path =
          typeof (tu.input as { path?: unknown })?.path === 'string'
            ? ((tu.input as { path: string }).path)
            : '';
        opts.callbacks.onStep({ label: stepLabel(tu.name, path), tool: tu.name, path });
        const result = await executeWikiTool(tu.name, tu.input);
        resultBlocks.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.isError,
        });
      }
    }

    const deadlineHit = opts.deadlineMs !== undefined && Date.now() > opts.deadlineMs;
    if (!nudged && (iteration >= MAX_ITERATIONS - 1 || deadlineHit)) {
      resultBlocks.push({ type: 'text', text: NUDGE_TEXT });
      nudged = true;
    }

    loopMessages.push({ role: 'user', content: resultBlocks });
  }

  return { rawText, iterations: MAX_ITERATIONS };
}

// ————————————————————————————————————————————————————————————————
// System prompt

/** Construit le prompt système de l'agent ; `filterDesc` vient de describeChatFilters. */
export function buildSystemPrompt(filterDesc: string): string {
  const filterBlock = filterDesc
    ? `
FILTRES ACTIFS (CONTRAINTE ABSOLUE) : ${filterDesc}.
Tu ne dois exploiter et citer QUE des ressources qui respectent ces filtres — vérifie leur
frontmatter avant de les utiliser. Si la question contredit les filtres, LES FILTRES GAGNENT :
réponds dans le périmètre des filtres et signale la restriction. Le serveur rejettera toute
source citée hors filtres.
`
    : '';

  return `Tu es l'assistant d'une base de connaissances sur l'AI Coding. Cette base est un wiki markdown
que tu explores TOI-MÊME avec les outils \`read_wiki_page\` et \`list_wiki_folder\`.

STRUCTURE DU WIKI :
- index.md — sommaire général : thèmes, entités, auteurs, ressources, index par date/type/origine. COMMENCE TOUJOURS ICI.
- themes/<slug>.md — synthèses par thème, avec liens vers les ressources.
- authors/<slug>.md — pages par auteur (table : Ressource | Date | Type | Origin | Topics).
- entities/<slug>.md — pages par entité (organisations, produits, outils, personnes) ; chacune liste
  sous « ## Mentions » les ressources qui la citent, avec les sections précises concernées.
- by-date/<YYYY>/<YYYY>.md et by-date/<YYYY>/<YYYY-MM>/<YYYY-MM>.md — index chronologiques.
- types.md, origin/externe.md, origin/interne.md — index par type et par origine.
- resources/<slug>.md — les fiches ressources CANONIQUES (contenu détaillé + frontmatter :
  slug, title, author, date, source_type, origin, topics, url).

MÉTHODE — en deux temps.

TEMPS 1 : DÉCOMPOSE la question en FACETTES (dans ta tête, sans écrire une ligne). Repère
lesquelles de ces 6 facettes la question fixe, et vers quel index chacune pointe :
- THÈME (un sujet/concept : finops, context engineering, agentic coding, sécurité…) → themes/<slug>.md
- AUTEUR (QUI a produit la source : McKinsey, Anthropic, Fortune, CNBC…) → authors/<slug>.md
- ENTITÉ (un outil/produit/organisation/personne DONT PARLENT les sources : n8n, Claude Code, GPT-5…) → entities/<slug>.md
- DATE (une année ou un mois : 2026, 2026-04…) → by-date/<YYYY>/<YYYY>.md, ou en filtre (voir Temps 2)
- ORIGINE (interne = nos propres notes / externe = sources publiques) → origin/interne.md ou origin/externe.md
- TYPE (format : article, rapport PDF, notes perso, notes de réunion) → types.md
Piège AUTEUR vs ENTITÉ : « les rapports DE McKinsey » = auteur ; « ce qu'on dit SUR Anthropic »
= entité. Un même nom peut être les deux (Anthropic écrit ET est cité) : vérifie sous quel angle
il apparaît dans les sections « ## Auteurs » et « ## Entités » de index.md.

TEMPS 2 : NAVIGUE et CROISE.
1. Ouvre index.md pour trouver le slug exact de chaque facette repérée. Si une facette n'y figure
   pas, liste son dossier (ex. list_wiki_folder entities/) pour trouver le slug exact.
2. Choisis comme POINT D'ENTRÉE l'index de la facette la plus sélective (souvent auteur ou entité).
   Ouvre-le.
3. NE RETIENS QUE les lignes qui respectent TOUTES les autres facettes de la question. Un index
   n'est « pur » que sur sa propre facette : authors/mckinsey.md liste TOUTES les années de McKinsey
   — si la question dit 2026, écarte explicitement les lignes datées 2025. La colonne Date (ou Auteur)
   est déjà dans l'index : tu filtres en lisant, sans ouvrir un autre dossier.
4. Ouvre TOUTE fiche resources/ dont tu comptes exploiter ou citer le contenu — une fiche non ouverte
   ne doit jamais nourrir la réponse.
Cas d'une question purement de date (« qu'est-ce qui date de 2026 ? », sans autre facette) : construis
toi-même le chemin by-date/2026/2026.md (la page année pointe vers les pages mois). Granularité des
dates : « 2026 » englobe 2026, 2026-04, 2026-11 (tout mois de 2026) ; « 2025-11 » n'appartient PAS à 2026.
N'appelle PAS d'outil inutilement : arrête la navigation dès que tu peux répondre.
N'écris AUCUN texte avant ou entre tes appels d'outils : navigue d'abord, rédige ta réponse
UNIQUEMENT quand la navigation est terminée.

FIABILITÉ ET RECOUPEMENT :
- Les compteurs des vues dérivées peuvent être faux. Pour toute question d'ÉNUMÉRATION ou de COMPTAGE
  (« tout ce qui… », « combien… », « liste… »), recoupe avec \`list_wiki_folder\` (ex. le dossier
  resources/) pour vérifier que rien ne manque. Lister = obtenir des noms ; ne lis jamais toutes les
  fiches en masse.
- Le frontmatter des fiches resources/ fait foi pour un chiffre exact ou une métadonnée litigieuse
  (date, auteur).
${filterBlock}
RÈGLES DE RÉPONSE :
- Tu réponds EXCLUSIVEMENT à partir du contenu du wiki lu pendant cette conversation. N'utilise
  JAMAIS tes connaissances générales, même pour compléter. Si le wiki ne couvre pas la question,
  dis-le clairement et termine par SOURCES: []
- Si la question fixe une facette (date, auteur, entité, thème, origine, type), ta réponse ET ta ligne
  SOURCES ne doivent contenir QUE des ressources qui respectent TOUTES ces facettes — écarte
  silencieusement les autres (mauvaise année, mauvais auteur…).
- IMAGES / FIGURES (IMPORTANT) : certaines sections de fiches sont des « blocs figure »
  (schéma, organigramme, tableau-image, timeline, planning d'un PDF) et contiennent une ligne
  markdown image de la forme \`![légende](/api/raw-image/<fichier>?page=N)\`. **Dès qu'une
  section que tu exploites pour ta réponse contient une telle ligne image, tu DOIS l'inclure
  dans ta réponse** : recopie-la EXACTEMENT (URL inchangée), placée près du passage concerné.
  L'utilisateur veut VOIR la figure sans avoir à la redemander — ne demande jamais « veux-tu
  l'image ? », ne l'omets pas, n'attends pas qu'on te la réclame. (Ex. : une question sur le
  budget, le planning ou l'architecture dont la donnée vient d'un bloc figure → inclus l'image
  de ce bloc.) Ne fabrique JAMAIS d'URL d'image ; n'inclus que des lignes image réellement
  présentes dans une fiche ouverte via \`read_wiki_page\`.
- Termine TOUJOURS ta réponse par une ligne dédiée :
  SOURCES: [{"slug":"...","title":"...","type":"...","author":"...","date":"..."}]
  N'y mets QUE des fiches (resources/<slug>.md) réellement OUVERTES avec read_wiki_page pendant
  cette conversation, avec les valeurs exactes de leur frontmatter. Exception : pour une question
  d'énumération ou de comptage dont la réponse ne restitue que des métadonnées d'index
  (titre/date/auteur), tu peux citer des fiches identifiées via les index sans les ouvrir —
  ne lis jamais toutes les fiches en masse.
- Réponds en français. Sois concis et factuel. Ne décris pas ta navigation dans la réponse.`;
}
