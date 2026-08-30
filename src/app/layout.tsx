import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SpeakLoop — AI IELTS Speaking Part 3 Coach',
  description:
    'Master IELTS Speaking Part 3 with AI-powered mock interviews, real-time evaluation, and personalized practice.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
