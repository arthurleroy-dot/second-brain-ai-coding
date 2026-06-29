import { Suspense } from 'react';
import SourceList from '@/components/sources/SourceList';

export const dynamic = 'force-dynamic';

export default function SourcesPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">Chargement…</div>}>
      <SourceList />
    </Suspense>
  );
}
