@AGENTS.md

## ÇÖZÜLEN KRİTİK HATALAR

- GÜVENLİK DÜZELTMESİ: Cache tablolarına (channel_stats_snapshots, channel_videos_cache) erişen sorgular önceden çoğunlukla channel_id bazlıydı, ama RLS koruması user_id bazlıydı. Bu uyumsuzluk, teorik olarak bir kullanıcının başka bir kullanıcının (herkese açık) Channel ID'sini bilmesi durumunda o kullanıcının cache verisine erişebilmesi riskini taşıyordu. Düzeltme: tüm sorgular artık asıl güvenlik sınırı olarak user_id kullanıyor (channel_id sadece ikincil filtre). Etkilenen dosyalar: dashboardData.ts, tüm route.ts dosyaları, StatsCards.tsx, RecentVideos.tsx, ChannelHealth.tsx, channelGrowth.ts, channelHealth.ts, supabase-server.ts. Snapshot yazma akışı da kullanıcı bazlı hale getirildi (cron artık her bağlı kullanıcı için ayrı satır yazıyor).

## PROJECT STATUS (Son güncelleme: 2026-07-03)

1. TAMAMLANAN FAZLAR:
   - Faz 1 (Veri Altyapısı): Supabase'de channel_stats_snapshots tablosu, YouTube API entegrasyonu, Vercel Cron ile otomatik günlük veri toplama, gerçek büyüme yüzdesi hesaplama (lib/channelGrowth.ts), kanal sağlığı skoru sistemi (lib/channelHealth.ts)
   - Faz 2 (Auth & Çok Kullanıcılı Yapı): Supabase Auth (email/şifre + email doğrulama zorunlu), middleware.ts ile sayfa koruması, login/signup sayfaları, user_channels tablosu ile kullanıcı bazlı kanal bağlama (/connect-channel sayfası), RLS ile veri izolasyonu
   - Faz 3 (kısmen): Gemini API entegrasyonu, lib/gemini.ts ve AiInsights bileşeni gerçek AI önerileri üretiyor
   - Önemli mimari düzeltme: Dashboard artık canlı YouTube API yerine Supabase'deki günlük cache'ten okuyor (StatsCards, RecentVideos, ChannelHealth, AiInsights). Bu, YouTube API kotasının kullanıcı sayısı arttıkça tükenmesini önlemek için yapıldı. Yeni tablo: channel_videos_cache. Sadece /connect-channel hâlâ canlı API kullanıyor (tek seferlik doğrulama).

2. ÖNEMLİ MİMARİ KARARLAR:
   - YouTube kanal bağlama: Tam OAuth yerine kullanıcının kendi Channel ID'sini manuel girmesi tercih edildi (basitlik için, ileride OAuth'a geçilebilir)
   - Tüm kullanıcı arayüzü İngilizce (global ürün hedefi)
   - Domain: norveko.app (Vercel üzerinden satın alındı, projeye bağlı)
   - Auth: Supabase Auth (Supabase zaten kullanıldığı için)

3. BİLİNEN TEKNİK DETAYLAR:
   - Snapshot endpoint'i (/api/snapshot-stats) SNAPSHOT_SECRET veya CRON_SECRET ile korunuyor
   - Service role key sadece server-side kullanılıyor (lib/supabase-server.ts)
   - YouTube API günlük kotası sınırlı, geliştirirken dikkat edilmeli

4. BİLİNEN SORUNLAR / YARIM KALANLAR:
   - snapshot-stats endpoint'i manuel test edilirken PowerShell'de curl komutu syntax sorunu yaşandı (curl.exe kullanılması gerekiyor, düz "curl" PowerShell'in kendi alias'ına yönleniyor) - test tamamlanmadı, yarın devam edilecek
   - Cache okurken user_id vs channel_id tutarlılığı kontrol edilmeli (RLS güvenliği açısından)
   - Gerçek uçtan uca test (connect-channel + cache + dashboard) henüz yapılmadı, kota nedeniyle ertelendi

5. SIRADA NE VAR (kalan fazlar):
   - Bkz. FULL ROADMAP bölümü. Şu an aktif: Phase 3.1 - Testing & Validation (önce bu tamamlanmalı, sonra Phase 3.2'ye geçilir).

## PRODUCT VISION - AI CONTENT PIPELINE

Norveko'nun uzun vadeli AI hedefi: Kullanıcı tek bir fikir girsin (örn. "dans videosu yapmak istiyorum"), sistem bunu otomatik olarak zincirleme AI araçlarıyla işlesin:
1. Script/Prompt üretimi (Gemini - zaten entegre)
2. Seslendirme/Voiceover (henüz seçilmedi - ElevenLabs veya Google TTS değerlendirilecek)
3. Video üretimi (henüz seçilmedi - Google Veo, Runway, Pika gibi servisler değerlendirilecek, maliyetli ve yavaş)

ÖNEMLİ MİMARİ NOTLAR:
- Bu üç aşama farklı maliyet profillerine sahip: metin (ucuz/ücretsiz) → ses (orta maliyet) → video (yüksek maliyet, saniye başına ücretlendirme, dakikalar sürebilir)
- Video üretimi muhtemelen ücretli plan özelliği olmalı (Billing/Stripe fazıyla bağlantılı), ücretsiz kullanıcıya sınırsız verilemez
- Video üretimi anlık dönmez, arka planda işlem (job queue) mimarisi gerektirecek - bu ileride ayrıca planlanmalı
- KARAR: Aşamalı inşa sırası onaylandı - önce metin araçları (Phase 3.2-3.4), sonra seslendirme, en son video üretimi. Video üretimi şimdilik "Future (Norveko v2)" kapsamında, erken fazlarda önceliklendirilmeyecek.

## FULL ROADMAP (NEXT PHASES)

### Phase 3.1 - Testing & Validation
   - Finish snapshot-stats endpoint testing with real Supabase and cron flow.
   - Verify dashboard reads from cache correctly across all widgets.
   - Validate auth, channel connection, and data isolation end-to-end.
   - Check edge cases for empty states, missing data, and refresh behavior.

### Phase 3.2 - Core AI Content Planning
   - Add content ideation workflow with topic suggestions, titles, and hooks.
   - Generate structured content briefs from channel context and goals.
   - Introduce saved content ideas and reusable templates.
   - Connect Gemini outputs to a first-class planning experience.

### Phase 3.3 - AI Content Assistant
   - Expand Gemini-powered recommendations into a full assistant experience.
   - Support script generation, outlines, and content repurposing.
   - Add prompt history, export options, and refinement loops.
   - Improve reliability and cost efficiency for text-based generation.

### Phase 3.4 - Content Operations
   - Add project-based organization for campaigns and channel initiatives.
   - Introduce content calendar views and publishing workflow.
   - Link generated ideas to channels, goals, and performance metrics.
   - Prepare the foundation for future voice and video automation.

### Phase 4 - Projects & Settings
   - Build the Projects workspace for managing multiple campaigns and channels.
   - Add a Settings page for profile, preferences, integrations, and notifications.
   - Support multi-channel organization and ownership controls.

### Phase 5 - Billing & Stripe
   - Introduce subscription plans and usage limits.
   - Gate premium AI features behind paid plans where appropriate.
   - Add billing portal, invoices, and usage visibility.

### Phase 6 - Polish & Production Readiness
   - Improve UX, onboarding, empty states, and error handling.
   - Add analytics polish, performance tuning, and observability.
   - Prepare production deployment, monitoring, and support workflows.

### Future (Norveko v2)
   - Add voiceover and narration generation.
   - Add video generation workflows using external providers.
   - Introduce a background job queue architecture for long-running generation.
   - Expand into a full AI content pipeline from idea to publish-ready media.

