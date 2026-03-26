import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Padrón ANR - HC Ybytymi',
  description: 'Sistema profesional online para consulta y administración del padrón.'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
