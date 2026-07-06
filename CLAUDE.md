# CLAUDE.md — Norveko Project Context

> Bu dosya, yeni bir Claude oturumu başladığında proje bağlamını geri yüklemek içindir.
> Her büyük milestone sonrası güncellenmelidir. Son güncelleme: 2026-07-06

## 1. Proje Nedir?

**Norveko** — AI destekli video içerik üretim SaaS'ı. Hedef kitle: YouTube ve
kısa video (Shorts/Reels/TikTok) üreticileri, global pazar. UI dili: **İngilizce**.

**ÖNEMLİ — Kapsam geçmişi:** Proje başlangıçta bir YouTube analytics aracıydı
(snapshot, büyüme, sağlık skoru). Daha sonra tam bir AI içerik üretim SaaS'ına
genişletildi. Analytics altyapısı hâlâ kod tabanında durur ve çalışır, ancak
artık ana ürün AI Workspace + kredi sistemidir. Eski analytics odaklı planlara
göre hareket etme.

- Canlı: https://norveko.app (Vercel, GitHub push → otomatik deploy)
- MVP durumu: ~%75

## 2. Tech Stack

- Next.js App Router + TypeScript + TailwindCSS
- Supabase: database + auth (RLS her tabloda aktif)
- Vercel: hosting + Cron Jobs
- YouTube Data API v3 (analytics tarafı)
- Gemini API: `gemini-2.5-flash`, native Google endpoint,
  `x-goog-api-key` header, `thinkingBudget: 0`,
  `responseMimeType: "application/json"` + `extractJson` fallback

## 3. Tamamlanan Modüller

### AI Ürün (güncel odak)
- **AI Workspace (`/chat`)**: Gemini destekli üretim endpoint'i. Çıktı:
  hook, voice-over script, scene plan (sinematik İngilizce video promptları),
  title options, description, tags, thumbnail concept.
  Çok dilli çıktı: EN, TR, ES, DE, FR, PT.
- **Projects**: Supabase `projects` tablosu (RLS), tam CRUD API route'ları,
  `/projects` liste sayfası, `/projects/[id]` detay sayfası
  (görüntüleme, bölüm bazlı kopyalama, başlık düzenleme PATCH, onaylı silme DELETE).
- **Kredi sistemi**: `user_credits` + `credit_transactions` tabloları,
  signup'ta 50 hoş geldin kredisi (trigger), üretim başına 5 kredi kesintisi,
  hata durumunda otomatik iade. `deduct_credits` / `add_credits` RPC
  (anon/authenticated execute yetkisi kaldırıldı — sadece service role).
  Server-side işlemler için `SUPABASE_SERVICE_ROLE_KEY` ile admin client.
- **Billing sayfası**: 3 paket (Starter / Creator / Pro) — "Coming soon".
- **Dashboard**: `DashboardHighlights` — gerçek kredi bakiyesi, son projeler,
  hızlı aksiyonlar. Fake/hardcoded veri YOK.
- **Landing page (`/`)**: server-side session kontrolü, girişli kullanıcı
  → `/dashboard` redirect.
- **Sidebar**: gerçek Next.js `Link` navigasyonu, `usePathname` ile aktif
  route vurgusu, "Soon" rozetleri.
- **Settings**: profil görüntüleme + YouTube kanal ID yönetimi
  (`UC` prefix validasyonu).

### Analytics Altyapısı (eski faz — çalışır durumda, korunuyor)
- `channel_stats_snapshots` tablosu (RLS), YouTube Data API v3 entegrasyonu
  (kesin kural: fake veri YASAK).
- `/api/snapshot-stats` endpoint'i (`SNAPSHOT_SECRET`/`CRON_SECRET` korumalı),
  Vercel Cron günlük UTC 03:00.
- `lib/channelGrowth.ts` (gerçek büyüme %), `lib/channelHealth.ts` (sağlık skoru).
- `user_channels` tablosu + `/connect-channel` (kullanıcı-kanal eşleme).
- `channel_videos_cache` + `lib/dashboardData.ts` — dashboard SADECE
  Supabase cache'ten okur, asla canlı YouTube API çağırmaz.
- Auth: Supabase email/password + zorunlu doğrulama, `middleware.ts` route koruması.

### Düzeltilen Kritik Buglar (tekrarlama!)
1. Middleware tüm `/api/` route'larını yakalıyordu → düzeltildi.
2. Dashboard component'leri her yüklemede canlı YouTube API çağırıyordu → cache'e geçildi.
3. Cache sorguları `channel_id` ile filtreliyordu → `user_id` merkezli yapıldı.

## 4. Teknik Kurallar / Kalıplar

- Tüm Supabase server client'ları: `@supabase/ssr` + `createServerClient` +
  cookie forwarding.
- Next.js route params tipi: `Promise<{ id: string }>` — mutlaka `await` edilir.
- Stale build hatası çözümü: `Remove-Item -Recurse -Force .next` + `npm run dev`.
- Kredi kesintileri SADECE server-side, admin client üzerinden.
- Fake/hardcoded veri kesinlikle yasak — her metrik gerçek kaynaktan gelir.
- UI dili İngilizce (global hedef kitle).

## 5. Sıradaki İşler (öncelik sırasıyla)

1. **Editor** — üretilen içeriği düzenleme/geliştirme modülü (sıradaki ana iş)
2. Landing page rötuşları
3. Settings iyileştirmeleri
4. Billing paketlerinin aktifleştirilmesi (ödeme entegrasyonu — ileride)
5. Uzun vade: tek fikirden metin → ses → video üreten tam AI pipeline

## 6. Çalışma Şekli (Kadir + Claude)

- Claude ana geliştiricidir: kodu eksiksiz, kopyala-yapıştır hazır TAM dosyalar
  halinde yazar. Kadir VS Code'a yapıştırır.
- Her görev kısa bir planla başlar; değişen dosyaların özeti + sonraki adımla biter.
- Sadece ilgili dosyalara dokunulur; mevcut yapı ve component'ler yeniden kullanılır.
- Tüm açıklamalar **Türkçe** yapılır (kod ve UI İngilizce).
- Kod bloklarında her zaman Copy butonu kullanılır (elle seçim uzun blokları kesebilir).
- Kadir beginner-intermediate seviyededir: adım adım açıklama beklenir.