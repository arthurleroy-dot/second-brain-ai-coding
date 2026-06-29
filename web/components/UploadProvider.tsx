'use client';

import {
  createContext,
  useCallback,
  useContext,
  useState,
  ReactNode,
} from 'react';
import UploadModal from '@/components/upload/UploadModal';

interface UploadResult {
  ok: boolean;
  message: string;
}

interface UploadContextValue {
  openPicker: () => void;
  uploading: boolean;
  lastResult: UploadResult | null;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);

  const openPicker = useCallback(() => {
    setLastResult(null);
    setOpen(true);
  }, []);

  const handleResolved = useCallback(
    (status: 'done' | 'error', title: string) => {
      setUploading(false);
      setLastResult(
        status === 'done'
          ? { ok: true, message: `✓ « ${title} » ajouté à la base.` }
          : { ok: false, message: `Échec du traitement de « ${title} ».` },
      );
    },
    [],
  );

  return (
    <UploadContext.Provider value={{ openPicker, uploading, lastResult }}>
      {children}
      {open && (
        <UploadModal onClose={() => setOpen(false)} onResolved={handleResolved} />
      )}
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    return { openPicker: () => {}, uploading: false, lastResult: null };
  }
  return ctx;
}
