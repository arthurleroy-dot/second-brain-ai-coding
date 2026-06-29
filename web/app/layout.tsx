import type { Metadata } from 'next';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';
import { UploadProvider } from '@/components/UploadProvider';

export const metadata: Metadata = {
  title: 'Second Brain — AI Coding',
  description: 'Wiki collaboratif sur l’AI Coding',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <UploadProvider>
          <div className="flex h-screen w-screen overflow-hidden">
            <Sidebar />
            <div className="flex flex-1 flex-col overflow-hidden">
              <TopBar />
              <main className="flex-1 overflow-hidden">{children}</main>
            </div>
          </div>
        </UploadProvider>
      </body>
    </html>
  );
}
