'use client';

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  ReactNode,
} from 'react';

interface UploadResult {
  ok: boolean;
  message: string;
  path?: string;
}

interface UploadContextValue {
  openPicker: () => void;
  uploadFile: (file: File) => Promise<UploadResult>;
  uploading: boolean;
  lastResult: UploadResult | null;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [lastResult, setLastResult] = useState<UploadResult | null>(null);

  const uploadFile = useCallback(async (file: File): Promise<UploadResult> => {
    setUploading(true);
    setLastResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      const result: UploadResult = res.ok
        ? { ok: true, message: `Déposé : ${data.path}`, path: data.path }
        : { ok: false, message: data.error ?? "Échec de l'upload" };
      setLastResult(result);
      return result;
    } catch (e) {
      const result = { ok: false, message: 'Erreur réseau pendant l’upload' };
      setLastResult(result);
      return result;
    } finally {
      setUploading(false);
    }
  }, []);

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await uploadFile(file);
    e.target.value = '';
  };

  return (
    <UploadContext.Provider value={{ openPicker, uploadFile, uploading, lastResult }}>
      {children}
      <input
        ref={inputRef}
        type="file"
        accept=".md,.txt,.pdf,.pptx"
        className="hidden"
        onChange={onChange}
      />
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadContextValue {
  const ctx = useContext(UploadContext);
  if (!ctx) {
    // Fallback no-op si jamais utilisé hors provider.
    return {
      openPicker: () => {},
      uploadFile: async () => ({ ok: false, message: 'Upload indisponible' }),
      uploading: false,
      lastResult: null,
    };
  }
  return ctx;
}
