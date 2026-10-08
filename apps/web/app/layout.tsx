import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const display = localFont({
  src: './fonts/BebasNeue-Regular.ttf',
  weight: '400',
  variable: '--font-display-local',
  display: 'swap',
});
const body = localFont({
  src: './fonts/SpaceGrotesk-Variable.ttf',
  weight: '300 700',
  variable: '--font-body-local',
  display: 'swap',
});
const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.ttf',
  weight: '100 800',
  variable: '--font-mono-local',
  display: 'swap',
});
export const metadata: Metadata = {
  title: 'Sicura · Investigation workbench',
  description: 'Local replica evidence for explicit access expectations',
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
