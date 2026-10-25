# CLAUDE.md — Norveko Project Context

> Bu dosya, yeni bir Claude oturumu başladığında proje bağlamını geri yüklemek içindir.
> Her büyük milestone sonrası güncellenmelidir. Son güncelleme: 2026-10-25 (akşam)

## 1. Proje Nedir?

**Norveko** — AI destekli video içerik üretim SaaS'ı. Hedef kitle: YouTube ve
kısa video (Shorts/Reels/TikTok) üreticileri, faceless kanallar, belgesel/gizem/
tarih anlatıcıları; global pazar. UI dili: **İngilizce**. Açıklamalar: **Türkçe**.

Vizyon: tek fikirden → araştırma → senaryo → sahne planı → üretim (görsel/video/
ses) → kurgu → yayın → analiz. Bugün ürün "içerik paketi + thumbnail + opsiyonel
voiceover + (kapılı) Kling klipleri" üretiyor; tam video render yol haritasında.
Detaylı vizyon belgesi: proje devir dokümanı (Ekim 2026).

- Canlı: https://norveko.app (Vercel; `main`'e push → otomatik deploy)
- Repo: github.com/kadirkanbur6-oss/norveko
- Teknik özet ve komutlar: `README.md`; env envanteri: `.env.example`;
  DB/storage varsayımları: `supabase/README.md`

## 2. Tech Stack

Next.js 16 App Router + TypeScript + Tailwind v4 · Supabase (DB, Auth, Storage;
RLS her tabloda) · Vercel (hosting + cron) · OpenAI `gpt-5-mini` (script) ·
ElevenLabs (voiceover) · Gemini image (thumbnail) · Kling (video klip, kapılı) ·
Paddle (ödeme, Merchant of Record) · YouTube Data API v3 (analytics, opsiyonel)

## 3. Mimari — Pipeline (en önemli kısım)

- `POST /api/pipeline/start`: doğrular, feature gate'leri kontrol eder, krediyi
  düşer, `pipeline_jobs` satırı açar, **hemen döner** ve `after()` ile worker'ı
  tetikler.
- `POST /api/pipeline/run` (internal, `PIPELINE_WORKER_SECRET`): **her çağrıda
  tek adım** çalıştırır (`script` → `voiceover`? → `thumbnail` → `video`?) ve
  kendini bir sonraki adım için tekrar tetikler. Adım claim'i atomik
  (pending→running koşullu update), çift tetikleme zararsız.
- `GET /api/pipeline/[id]`: UI poll eder; aynı zamanda job'ı "iyileştirir"
  (8 dk'yı aşan adımı iade ile failed yapar, unutulan adımı yeniden tetikler,
  async video adımını 20 sn'de bir poll eder, 40 dk sonra timeout).
- `GET /api/pipeline/reap` (cron, günlük 03:30 UTC): tüm running job'lar için aynı.
- Mantık `lib/pipeline/runner.ts` içinde `createPipelineRunner(deps)`;
  `lib/pipeline/runner.test.ts` 8 senaryo (`npm run test:pipeline`).
- Kredi maliyetleri **tek kaynak**: `lib/pipeline/steps.ts` (script 5, voiceover
  15, thumbnail 10, video 12×5 klip peşin; kullanılmayan/başarısız klip iade).
- Form seçenekleri UI+API ortak: `lib/pipeline/options.ts`.
- Bitince sonuç `projects.content` JSONB'ye yazılır; başlık = AI'nin ilk title'ı.

## 4. Feature gate'ler (env)

- `GENERATION_ENABLED=false` → **lansman kilidi**: `BETA_USER_IDS` dışındakiler
  üretim yapamaz, kredi düşmeden 403. UI "launching soon" gösterir.
- `VIDEO_GENERATION_ENABLED=true` veya `VIDEO_BETA_USER_IDS` → Kling klipleri.
- Kontrol: `lib/pipeline/features.ts`, UI'a `GET /api/features`.

## 5. Tamamlanan Modüller (Ekim 2026 itibarıyla)

- Auth: e-posta/şifre + zorunlu doğrulama + Google OAuth (yayında), şifre
  sıfırlama (`/forgot-password`, `/reset-password`), doğrulama maili yeniden
  gönderme, her yerde çıkış. `middleware.ts` public sayfa listesi başta.
- Dashboard: gerçek kredi bakiyesi, son projeler, **çalışan bildirim zili**
  (`/api/notifications`, türetilmiş gerçek olaylar), **proje araması**.
- AI Workspace `/chat`: taslak sessionStorage'da, çalışan iş `?job=`'da
  (yenileme kaybetmez), bakiye/maliyet gösterimi, yetersiz kredide buton pasif,
  "aynı ayarlarla tekrar üret", her sonuç kartında Copy. **Üretim sahnesi**
  (`GenerationStage`: animasyonlu logo, adım mesajları, tahmini %, süre; CSS
  `nv-stage-*` globals.css'te), iş başlayınca form özet karta çöker ve ekran
  ilerlemeye kayar, Generate + maliyet **sticky alt barda**. **Ses seçici**:
  dile göre yüklenir (`/api/voices?language=`), sadece o dilin sesleri,
  seçilince tek satıra kapanır ("Change voice"), avatar kartlarında hover
  önizleme. **29 dil** `lib/pipeline/options.ts` `LANGUAGE_OPTIONS` (yerel ad
  UI'da, İngilizce ad LLM prompt'unda, ISO kod ses eşlemede, bayrak).
- Projects: liste (arama, platform/stil filtresi, sıralama, load more), detay
  (sekmeler, tam düzenleme, **Export**: copy all / .md / .txt / .srt, thumbnail
  görseli, klip oynatıcı, stilli silme onayı). PATCH içeriği
  `lib/project-content.ts` ile sanitize edilir.
- Billing: Paddle overlay checkout, webhook (`transaction.completed` + refund
  `adjustment.*`, idempotent), ödeme sonrası bakiye yenileme, kredi metinleri
  `steps.ts`'ten.
- Settings: profil, YouTube kanal ID, **şifre değiştir**, **hesap sil**
  (`/api/account`: storage + tablolar + auth user).
- Marka: `BrandMark` (inline SVG N-monogram), `app/icon.png`, OG metadata,
  2.5 sn giriş sonrası intro (`WelcomeIntro`, oturum başına bir kez).
- Ops: `robots.ts`, `sitemap.ts`, `not-found/error/loading.tsx`, security
  header'lar + CSP (report-only), `/api/health`, snapshot cron tüm bağlı
  kanallar için, saatlik üretim limiti, ESLint 0 hata.

### ElevenLabs sesleri (önemli)
- `lib/pipeline/elevenlabs.ts`: `listVoices()` (hesap sesleri, `languages`
  = labels.language ∪ verified_languages), `listLibraryVoices(code)`
  (Voice Library), `addLibraryVoice()` (seçilince hesaba ekler; `/api/pipeline/
  start` kredi düşmeden önce çağırır), `getSubscriptionTier()`.
- **ElevenLabs hesabı Free plan** (anahtar `norveko-dev`, Voices izni Write
  yapıldı). Free planda kütüphane sesleri API'den kullanılamaz (402
  paid_plan_required) → `/api/voices` tier "free" ise ya da tier bilinmiyor ve
  `ELEVENLABS_LIBRARY_VOICES` != "true" ise Library seslerini **gizler**.
  Starter'a geçince Vercel'e `ELEVENLABS_LIBRARY_VOICES=true` ekle (veya
  anahtara User→Access izni ver, otomatik algılar). Bu konu şimdilik SKIP.
- Stok B-roll: Pexels yeni anahtar vermiyor → **Pixabay** eklendi
  (`PIXABAY_API_KEY` Vercel'de, `lib/pipeline/pexels.ts` iki sağlayıcıyı da
  destekler).

### Dış kurulum durumu (25 Ekim akşamı)
- Supabase: `pipeline_jobs.options` kolonu ✅, `videos` bucket ✅.
- Vercel env: `GENERATION_ENABLED=false`, `BETA_USER_IDS=92779a9c-cb1c-47a8-
  bcc8-e07f4de6dc56` (Kadir), `NEXT_PUBLIC_SITE_URL`, `PIPELINE_WORKER_SECRET`,
  `PIXABAY_API_KEY` ✅ — lansman kilidi canlıda, zincir uçtan uca test edildi.

## 6. Teknik Kurallar / Kalıplar

- Route handler'larda auth: `const { supabase, user } = await requireUser()`
  (`lib/supabase-server.ts`; `getUser()` kullanır, `getSession()` KULLANMA).
- Kredi düşme/iade SADECE server-side, service role ile (`deduct_credits` /
  `add_credits` RPC). `add_credits` negatif tutara izin vermeli (Paddle iadesi).
- **Fake/hardcoded veri yasak**; her metrik gerçek kaynaktan gelir.
- Next.js route params: `Promise<{ id: string }>` — `await` edilir.
- Provider lib'leri (`lib/pipeline/openai|elevenlabs|gemini-image|kling.ts`)
  server-only; env yoksa import anında throw eder → runner lazy import kullanır.
- Yeni özellik eklerken: tsc + `npm run lint` + `npm run test:pipeline` temiz
  olmalı; UI metinleri İngilizce.

## 7. Bekleyen İşler (öncelik sırasıyla)

Kod dışı (Kadir): `app/lib/legal.ts` `LEGAL_NAME` placeholder'ı (şirket
kurulunca); Kling anahtarları; Paddle live ID'leri + webhook event'leri
(`adjustment.*`); ElevenLabs Starter planı (kütüphane sesleri için);
`NEXT_PUBLIC_YOUTUBE_API_KEY` → `YOUTUBE_API_KEY` yeniden adlandırma.

Ürün (rakip analizine göre): otomatik altyazı →
tam MP4 render → 9:16/16:9 seçimi → niş şablonları + örnek galeri →
YouTube'a doğrudan yükleme → seri modu/zamanlama → ses klonlama + brand kit →
affiliate. Ertelenen: timeline editör, AI avatar, mobil app.

Teknik borç: sahne düzeyinde yeniden üretim + versiyon geçmişi +
`media_assets`/`projects.job_id` şeması; Sentry; provider maliyet logu;
erişilebilirlik (focus stilleri, kontrast); CSP'yi enforce moduna alma;
Supabase custom domain (Google ekranındaki supabase.co yazısı için).

## 8. Çalışma Şekli (Kadir + Claude)

- Claude ana geliştiricidir; repo üzerinde doğrudan commit + push yapar
  (GitHub bağlı). Her görev kısa planla başlar, değişen dosyaların özeti ve
  sonraki adımla biter.
- Sadece ilgili dosyalara dokunulur; mevcut bileşenler yeniden kullanılır.
- Kadir beginner-intermediate seviyededir: adım adım, Türkçe açıklama.
