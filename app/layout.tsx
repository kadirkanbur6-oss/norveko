import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://norveko.app";
const DESCRIPTION =
  "Turn one idea into a script, scene plan, video prompts, thumbnail concept, and SEO-ready metadata. One AI workspace for video creators.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Norveko — AI Content Workspace for Creators",
    template: "%s · Norveko",
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Norveko",
    title: "Norveko — AI Content Workspace for Creators",
    description: DESCRIPTION,
    url: SITE_URL,
    images: [{ url: "/brand/norveko-logo.png", width: 512, height: 512, alt: "Norveko" }],
  },
  twitter: {
    card: "summary",
    title: "Norveko — AI Content Workspace for Creators",
    description: DESCRIPTION,
    images: ["/brand/norveko-logo.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Keyboard / screen-reader users can jump past the sidebar and nav. */}
        <a href="#main-content" className="nv-skip-link">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
