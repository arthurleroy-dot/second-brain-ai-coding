'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Tags, Layers } from 'lucide-react';

const TITLES: Record<string, string> = {
  '/chat': 'Chat',
  '/wiki': 'Wiki — Thèmes',
  '/sources': 'Sources',
  '/explore': 'Explorer',
  '/entities': 'Entités',
  '/themes': 'Thèmes',
  '/upload': 'Déposer une ressource',
  '/reglages': 'Réglages',
};

function titleFor(pathname: string): string {
  const match = Object.keys(TITLES).find((p) => pathname.startsWith(p));
  return match ? TITLES[match] : 'Second Brain';
}

export default function TopBar() {
  const pathname = usePathname();
  const [total, setTotal] = useState<number | null>(null);
  const [pending, setPending] = useState<number>(0);
  const [themePending, setThemePending] = useState<number>(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setTotal(d.total ?? d.sources?.length ?? 0);
      })
      .catch(() => {});
    fetch('/api/candidates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setPending(d.pending ?? 0);
      })
      .catch(() => {});
    fetch('/api/theme-candidates')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setThemePending(d.pending ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-5">
      <h1 className="text-sm font-semibold text-gray-900">{titleFor(pathname)}</h1>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#E1F5EE] px-3 py-1 text-xs font-medium text-[#0F6E56]">
          {total ?? '—'} sources
        </span>
        {pending > 0 && (
          <Link
            href="/entities"
            className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <Tags size={12} />
            {pending} entité{pending > 1 ? 's' : ''} en attente
          </Link>
        )}
        {themePending > 0 && (
          <Link
            href="/themes"
            className="flex items-center gap-1 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
          >
            <Layers size={12} />
            {themePending} thème{themePending > 1 ? 's' : ''} en attente
          </Link>
        )}
      </div>
    </header>
  );
}
