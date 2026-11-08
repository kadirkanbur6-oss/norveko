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
  "Turn one idea into a finished video: research, script, voice, visuals, music and thumbnail, plus animated skits and talking characters. A finished MP4 ready for YouTube, TikTok and Instagram.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Norveko | AI Content Workspace for Creators",
    template: "%s · Norveko",
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Norveko",
    title: "Norveko | AI Content Workspace for Creators",
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Norveko | AI Content Workspace for Creators",
    description: DESCRIPTION,
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
      suppressHydrationWarning
    >
      <head>
        {/* Light / dark theme before the first paint (choice saved by ThemeToggle). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("nv_theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
        {/* Browser page translation (e.g. Chrome → Turkish) swaps React's text nodes for its own, and the next
            update then crashes with "insertBefore/removeChild: not a child of this node" (4 Nov 2026: /chat skit
            plan). Make those two calls forgiving so translated pages keep working (facebook/react#11538). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(typeof Node!=="function"||!Node.prototype)return;var r=Node.prototype.removeChild;Node.prototype.removeChild=function(c){if(c.parentNode!==this){return c}return r.apply(this,arguments)};var i=Node.prototype.insertBefore;Node.prototype.insertBefore=function(n,ref){if(ref&&ref.parentNode!==this){return i.call(this,n,null)}return i.apply(this,arguments)}})();`,
          }}
        />
      </head>
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
