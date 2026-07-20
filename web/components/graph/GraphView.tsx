'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GraphData, GraphNode } from '@/types';
import { resolveSourceType } from '@/lib/ui';

// ————————————————————————————————————————————————————————————————
// Couleurs par genre de nœud. `typeBadgeClass` (@/lib/ui) ne couvre que les
// ResourceType et renvoie des classes Tailwind : ici il faut du hex canvas.
const COLOR: Record<string, string> = {
  resource: '#2563eb',
  theme: '#7c3aed',
  entity: '#4f46e5',
  author: '#0d9488',
  date: '#c2410c',
  source_type: '#db2777',
  origin: '#64748b',
};
const DEFAULT_COLOR = '#9ca3af';

// Libellés FR de la légende (clé = champ `type` du nœud).
const TYPE_LABEL: Record<string, string> = {
  resource: 'Ressources',
  theme: 'Thèmes',
  entity: 'Entités',
  author: 'Auteurs',
  date: 'Dates',
  source_type: 'Types de source',
  origin: 'Origines',
};
const LEGEND_ORDER = ['resource', 'theme', 'entity', 'author', 'date', 'source_type', 'origin'];

const NODE_R = 5; // rayon des nœuds (unités monde)

/**
 * Route de destination au clic sur un nœud. On route par **préfixe d'id** (et
 * non par le champ `type`) car les nœuds « type de source » ont l'id préfixé
 * `type:` alors que leur `type` vaut `source_type`. Cf. web/lib/wiki-md.ts.
 *
 * Les facettes `/sources?…` doivent recevoir les valeurs **canoniques** que la
 * page attend (SourceList/FilterBar), pas le slug brut de l'id :
 *  - `author` → le **nom d'affichage** (`node.label`), pas le slug ;
 *  - `type`   → le **ResourceType** (`report_pdf`), pas le source_type brut
 *    (`report-pdf`).
 */
function hrefForNode(node: { id: string; label: string }): string {
  const { id } = node;
  const i = id.indexOf(':');
  const prefix = i === -1 ? id : id.slice(0, i);
  const slug = i === -1 ? '' : id.slice(i + 1);
  switch (prefix) {
    case 'resource':
      return `/sources/${slug}`;
    case 'theme':
      return `/wiki/${slug}`;
    case 'entity':
      return `/entities/${slug}`;
    case 'author':
      return `/sources?author=${encodeURIComponent(node.label)}`;
    case 'date':
      return `/sources?date=${encodeURIComponent(slug)}`;
    case 'type':
      return `/sources?type=${encodeURIComponent(resolveSourceType(slug))}`;
    case 'origin':
      return `/sources?origin=${encodeURIComponent(slug)}`;
    default:
      return '/sources';
  }
}

type FgNode = GraphNode & { x?: number; y?: number };

export default function GraphView() {
  const router = useRouter();

  // Import client-only de react-force-graph-2d (la lib touche `window`) — chargé
  // après montage pour rester SSR-safe, tout en préservant le ref (zoomToFit).
  const [ForceGraph, setForceGraph] = useState<any>(null);
  const fgRef = useRef<any>(null);
  const didFit = useRef(false);

  useEffect(() => {
    let mounted = true;
    import('react-force-graph-2d').then((m) => {
      if (mounted) setForceGraph(() => m.default);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Données du graphe (fetch une fois). Patron identique à ExploreView.
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/graph')
      .then((r) => r.json())
      .then((d) => setData({ nodes: d.nodes ?? [], edges: d.edges ?? [] }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // graphData STABLE (react-force-graph mute les objets nœuds/liens en place) :
  // on le mémoïse et on construit l'adjacence à partir du MÊME tableau `links`
  // — les refs de liens restent identiques après mutation, d'où le highlight par
  // identité dans les callbacks de rendu.
  const { graphData, neighborsById, linksByNode } = useMemo(() => {
    const nodes = data.nodes.map((n) => ({ ...n }));
    const links = data.edges.map((e) => ({ ...e }));
    const neighborsById = new Map<string, Set<string>>();
    const linksByNode = new Map<string, Set<object>>();
    const link = (a: string, b: string, l: object) => {
      (neighborsById.get(a) ?? neighborsById.set(a, new Set()).get(a)!).add(b);
      (linksByNode.get(a) ?? linksByNode.set(a, new Set()).get(a)!).add(l);
    };
    for (const l of links) {
      link(l.source, l.target, l);
      link(l.target, l.source, l);
    }
    return { graphData: { nodes, links }, neighborsById, linksByNode };
  }, [data]);

  // Surbrillance du voisinage au survol.
  const [highlightNodes, setHighlightNodes] = useState<Set<string>>(new Set());
  const [highlightLinks, setHighlightLinks] = useState<Set<object>>(new Set());
  const [hoverActive, setHoverActive] = useState(false);

  const handleHover = useCallback(
    (node: FgNode | null) => {
      const nextNodes = new Set<string>();
      const nextLinks = new Set<object>();
      if (node) {
        nextNodes.add(node.id);
        neighborsById.get(node.id)?.forEach((id) => nextNodes.add(id));
        linksByNode.get(node.id)?.forEach((l) => nextLinks.add(l));
      }
      setHighlightNodes(nextNodes);
      setHighlightLinks(nextLinks);
      setHoverActive(!!node);
      if (typeof document !== 'undefined') {
        document.body.style.cursor = node ? 'pointer' : 'default';
      }
    },
    [neighborsById, linksByNode],
  );

  const handleClick = useCallback(
    (node: FgNode) => router.push(hrefForNode(node)),
    [router],
  );

  // Dessin d'un nœud : cercle coloré + libellé permanent (style Obsidian), halo
  // si surligné, atténuation si un survol est actif ailleurs.
  const paintNode = useCallback(
    (node: FgNode, ctx: CanvasRenderingContext2D, scale: number) => {
      const color = COLOR[node.type] ?? DEFAULT_COLOR;
      const highlighted = highlightNodes.has(node.id);
      const dimmed = hoverActive && !highlighted;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.15 : 1;

      if (highlighted) {
        ctx.beginPath();
        ctx.arc(x, y, NODE_R + 3, 0, 2 * Math.PI);
        ctx.fillStyle = `${color}33`;
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(x, y, NODE_R, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      const label = node.label ?? '';
      const text = label.length > 32 ? `${label.slice(0, 31)}…` : label;
      const fontSize = 4; // unités monde → grossit au zoom (comme Obsidian)
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dimmed ? '#9ca3af' : '#374151';
      ctx.fillText(text, x, y + NODE_R + 1.5);
      ctx.restore();
    },
    [highlightNodes, hoverActive],
  );

  const paintPointerArea = useCallback(
    (node: FgNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, NODE_R + 2, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    [],
  );

  // Dimensionnement : le <main> est en flex/overflow-hidden → on mesure le
  // conteneur et on passe width/height explicites (sinon la lib prend la fenêtre).
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setDims({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      {loading && (
        <div className="p-6 text-sm text-gray-400">Chargement…</div>
      )}

      {!loading && graphData.nodes.length === 0 && (
        <div className="p-6 text-sm text-gray-400">Graphe vide.</div>
      )}

      {ForceGraph && dims.width > 0 && graphData.nodes.length > 0 && (
        <ForceGraph
          ref={fgRef}
          graphData={graphData}
          width={dims.width}
          height={dims.height}
          backgroundColor="#ffffff"
          cooldownTicks={120}
          nodeLabel={(n: FgNode) => n.label}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={(l: object) =>
            highlightLinks.has(l) ? '#6366f1' : hoverActive ? '#eceef1' : '#d1d5db'
          }
          linkWidth={(l: object) => (highlightLinks.has(l) ? 2.5 : 1)}
          linkDirectionalParticles={(l: object) => (highlightLinks.has(l) ? 4 : 0)}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={() => '#6366f1'}
          onNodeHover={handleHover}
          onNodeClick={handleClick}
          onEngineStop={() => {
            if (!didFit.current && fgRef.current) {
              fgRef.current.zoomToFit(400, 40);
              didFit.current = true;
            }
          }}
        />
      )}

      {/* Légende */}
      {!loading && graphData.nodes.length > 0 && (
        <div className="absolute left-4 top-4 rounded-lg border border-gray-200 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
          <div className="mb-1.5 text-xs font-semibold text-gray-700">Légende</div>
          <ul className="space-y-1">
            {LEGEND_ORDER.map((t) => (
              <li key={t} className="flex items-center gap-2 text-xs text-gray-600">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: COLOR[t] }}
                />
                {TYPE_LABEL[t]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
