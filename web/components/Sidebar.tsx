'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageCircle,
  Network,
  BookOpen,
  Files,
  Compass,
  Tags,
  Layers,
  Upload,
  Settings,
} from 'lucide-react';

const NAV = [
  { href: '/chat', icon: MessageCircle, label: 'Chat' },
  { href: '/graph', icon: Network, label: 'Graph' },
  { href: '/wiki', icon: BookOpen, label: 'Wiki' },
  { href: '/sources', icon: Files, label: 'Sources' },
  { href: '/explore', icon: Compass, label: 'Explorer' },
  { href: '/entities', icon: Tags, label: 'Entités' },
  { href: '/themes', icon: Layers, label: 'Thèmes' },
];

export default function Sidebar() {
  const pathname = usePathname();
  const uploadActive = pathname.startsWith('/upload');

  return (
    <nav className="flex h-full w-12 flex-col items-center justify-between border-r border-gray-200 bg-white py-3">
      <div className="flex flex-col items-center gap-1">
        {NAV.map(({ href, icon: Icon, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                active
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={18} />
            </Link>
          );
        })}

        <div className="my-2 h-px w-6 bg-gray-200" />

        <Link
          href="/upload"
          title="Déposer une source"
          className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            uploadActive
              ? 'bg-gray-900 text-white'
              : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          <Upload size={18} />
        </Link>
      </div>

      <button
        type="button"
        title="Paramètres"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
      >
        <Settings size={18} />
      </button>
    </nav>
  );
}
