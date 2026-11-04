import type { Metadata } from "next";

// Sayfa başlığı + noindex: giriş/hesap sayfaları aramada çıkmasın
// (robots.txt taramaya izin verir ki bu etiket görülsün).
export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: true },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
