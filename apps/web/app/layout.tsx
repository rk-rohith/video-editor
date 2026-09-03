import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Video Editor",
  description: "AI-assisted, fully manual-capable video editor",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-canvas text-textPrimary antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
