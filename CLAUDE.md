# CLAUDE.md — Norveko Project Context

> Bu dosya, yeni bir Claude oturumu başladığında proje bağlamını geri yüklemek içindir.
> Her büyük milestone sonrası güncellenmelidir. Son güncelleme: 2026-11-08

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
RLS her tabloda) · Vercel (hosting + cron) · OpenAI `gpt-6.1-terra` (araştırma + senaryo) ·
ElevenLabs (voiceover) · Gemini image (thumbnail) · Kling (video klip, kapılı) ·
Paddle (ödeme, Merchant of Record) · YouTube Data API v3 (analytics, opsiyonel)

## 3. Mimari — Pipeline (en önemli kısım)

- `POST /api/pipeline/start`: doğrular, feature gate'leri kontrol eder, krediyi
  düşer, `pipeline_jobs` satırı açar, **hemen döner** ve `after()` ile worker'ı
  tetikler.
- `POST /api/pipeline/run` (internal, `PIPELINE_WORKER_SECRET`): **her çağrıda
  tek adım** çalıştırır (`research`? → `script` → `voiceover`? → `thumbnail`
  → `video`? → `render`?) ve
  kendini bir sonraki adım için tekrar tetikler. Adım claim'i atomik
  (pending→running koşullu update), çift tetikleme zararsız.
- `GET /api/pipeline/[id]`: UI poll eder; aynı zamanda job'ı "iyileştirir"
  (8 dk'yı aşan adımı iade ile failed yapar, unutulan adımı yeniden tetikler,
  async video adımını 20 sn'de bir poll eder, 40 dk sonra timeout).
- `GET /api/pipeline/reap` (cron, günlük 03:30 UTC): tüm running job'lar için aynı.
- Mantık `lib/pipeline/runner.ts` içinde `createPipelineRunner(deps)`;
  `lib/pipeline/runner.test.ts` 13 senaryo (tam video, research dahil) +
  `captions.test.ts` 10 birim testi (altyazı, fiyat, timeline, süre)
  (`npm run test:pipeline`).
- **Web araştırması** (`research` adımı, 5 kredi, UI'da "Research the topic
  first" toggle'ı varsayılan açık): `lib/pipeline/openai.ts` `researchTopic()`
  OpenAI **Responses API** + `web_search` aracıyla (gpt-5-mini) bugünün
  tarihini vererek kaynaklı 120–220 kelimelik brief üretir; `url_citation`
  annotation'larından kaynak listesi. `steps.research.brief/sources` →
  senaryo prompt'una "VERIFIED RESEARCH BRIEF — tek gerçek kaynak" olarak
  girer; `projects.content.research` olarak saklanır, ilerleme kartında ve
  proje sayfasında "Research brief" (kaynak linkleri) gösterilir.
  **Research opsiyoneldir (29 Ekim):** `researchTopic` 80 sn `AbortSignal`
  timeout (31 Ekim: 40→80) + `reasoning.effort=low` + `search_context_size=medium`; hata/timeout
  olursa runner `skipResearch()` ile adımı `skipped` yapar, 5 krediyi iade
  eder (`steps.research.refunded`) ve senaryo araştırmasız devam eder.
  Worker ölürse (`/api/pipeline/run` `maxDuration` 300 sn) `reconcileJob` 2 dk
  sonra research'ü skip edip işi devam ettirir (`RESEARCH_STEP_TIMEOUT_MS`);
  diğer senkron adımlar için 8 dk timeout → failJob. UI sarı "skipped" rozeti
  + açıklama gösterir. (29 Ekim'de piramit testi research'te 60 sn'lik
  function limitine takılıp 8 dk beklemişti.) **31 Ekim:** `max_output_tokens`
  900 → 6000 (reasoning token'ları da sayılıyor; 900'de model aramadan sonra
  metin yazamadan bitiyordu → "Research returned no text"). Araştırma yoksa
  senaryo prompt'u gerçek kişi/olay için yalnızca yaygın belgelenmiş bilgiyi
  kullanmayı, meslek/ölüm nedeni/yer/alıntı uydurmamayı ve efsane/gazete
  iddiasını "anlatılana göre" diye belirtmeyi zorunlu kılar. **31 Ekim (saçma cümleler):** prompt artık tek bağlantılı hikâye, hook spoiler vermez ama sonda çürütülecek şeyi kesin gerçek gibi de söylemez, dolgu/meta cümle yasağı ("arşiv fotoğrafları gösterir" vb.) ister; kalıp Türkçe örnek ifadeler kaldırıldı; taslaktan sonra `editNarration()` editör geçişi (tutarlılık/uydurma/akıcılık, aynı kelime aralığı) çalışır; `reviseNarrationLength` uzatırken yeni bilgi uydurmaz. `/api/pipeline/run` `maxDuration` 300 sn. Senaryo
  prompt'unda ayrıca gerçek kişi/marka kuralı: videoPrompt'lar yüz, arma,
  forma ismi, skor tabelası, okunur yazı istemez (AI görseller bunları
  uyduruyor).
- **Senaryo yazımı (31 Ekim, prompt v`2026-10-31.plan-factcheck`)**: `generateScript` 4 aşama —
  (1) `planStory()` araştırmadan olgular/sorular/beat'ler/reveal/3 hook adayı/şüpheli iddialar
  (JSON, effort low), (2) taslak = ana prompt + STORY PLAN + stil örneği
  (`lib/pipeline/script-examples.ts`: Mary Celeste/Tunguska/gökyüzü; kopyalanması yasak) +
  "Angle & notes" (`options.notes`, ≤500 kr, `/chat`'te "+ Add an angle or notes", araştırmaya da
  gider), (3) `editNarration()` editör, (4) `factCheckNarration()` (yalnız araştırma varsa; her
  cümle brief'e karşı, sorunlar `steps.script.fact_check.issues`), sonra uzunluk düzeltmesi
  (hook'u korur). Süre bütçesi 250 sn: süre azsa opsiyonel geçişler atlanır. Tüm LLM çağrıları
  `lib/pipeline/llm.ts` `chatJSON()` üzerinden — model id `gpt-…`/`openai:…` → OpenAI,
  `gemini:…`/`gemini-…` → Gemini. Yazar modeli env **`SCRIPT_MODEL`** (varsayılan **`gpt-6.1-terra`** — 31 Ekim test seti: Terra 78/100 ~$0.028/senaryo ~70 sn, gpt-5-mini 63/100 $0.020 ~120 sn; gpt-5-mini 11 Aralık'ta kapanıyor. **31 Ekim: araştırma da `gpt-6.1-terra`** (env `RESEARCH_MODEL`); brief artık konunun en bilinen ayrıntılarını (ikonik olgular, kesin yer/mesafe) zorunlu içerir, İngilizce + yerel dilde arar). `steps.script.model/prompt_version/plan/fact_check`;
  proje `content.scriptMeta`. **Lab "0 · Script writer"** (`app/lab/ScriptLab.tsx`): aynı fikir +
  aynı araştırma 4 modelle (düzenlenebilir id), yargıç puanı; **test seti** 10 sabit konu
  (`lib/lab/script-eval.ts` `EVAL_TOPICS`, TR+EN, araştırma `videos/lab/eval/research/` önbellekte),
  yargıç `SCRIPT_JUDGE_MODEL` (varsayılan `gpt-6.1-sol`); lab adayları gpt-5-mini / gpt-6.1-terra ($1/$5) / gpt-6.1-sol ($2/$10) / gemini-3.8-flash ($0.75/$3.75, 2027'de 2×), doğruluk ×2 + uzunluk %10 → 0–100; sonuçlar
  `videos/lab/eval/runs/` (Save + geçmiş tablosu). **👍/👎**: proje sayfasında `ScriptFeedback`,
  `POST /api/projects/[id]/feedback` → `content.feedback`; PATCH `feedback`/`scriptMeta`'yı
  sunucudan korur (`SERVER_OWNED_CONTENT_KEYS`). `/api/lab` `maxDuration` 300.
- **Süre tutarlılığı** (üç katman): (1) `lib/pipeline/narration.ts` —
  **dil bazlı** kelime hızı `wordsPerSecond(code)` (en 2,4 · tr 1,85 · de
  1,9 · fi 1,7 …; 30 Ekim: Türkçe 142–144 kelime 71–81 sn çıkınca eklendi);
  `wordRange(duration, code)` hedef ±%8 (60 sn TR → ~111 kelime, EN → 144);
  senaryo prompt'u zorunlu kılar, kaçırırsa `reviseNarrationLength()`
  hook+script'i bir kez yeniden yazdırır. → (2) **tam video modunda** voiceover
  adımı ilk kaydı ölçer; sapma **%15'ten büyükse** ölçülen orana göre
  (`rangeForMeasuredRatio`) metni LLM'e kısalttırıp/uzattırıp yeniden
  seslendirir (`steps.script.hook/script` güncellenir,
  `steps.voiceover.rewritten_for_length`); ardından (3) hâlâ %10+ sapıyorsa
  ElevenLabs `voice_settings.speed` (0,7–1,2, oran = ölçülen/hedef) ile bir
  kez yeniden üretir (**29 Ekim: 0,88–1,12 ile sınırlı**, daha fazlası
  doğal durmuyor; zaman çizelgesi zaten gerçek süreye uyar);
  `steps.voiceover.speed` ve `duration_seconds` yazılır. ElevenLabs
  `voice_settings`: stability 0.38, similarity 0.8, style 0.35, speaker boost
  (düz okumayı azaltmak için).
  Zaman çizelgesi her durumda gerçek anlatım süresine göre kurulur.
- Kredi maliyetleri **tek kaynak**: `lib/pipeline/steps.ts` (31 Ekim: %60 kâr fiyatları aşağıda; eski: research 5, script 5, voiceover
  15, **altyazı eklentisi 10** (`SUBTITLES_CREDITS`, sadece voiceover ile;
  adım değil, `steps.voiceover.subtitles=true` olarak kaydedilir), thumbnail
  10, **Kling klip 130** (5 sn, Kling 3.0 720p sessiz = 3 unit ≈ $0.42;
  26 Ekim'de 12 → 90 → 28 Ekim'de 130: yeni platformda 2.1 yok),
  **AI görsel sahne 12**, **render 30 / 30 sn**). `creditBreakdown(opts)` UI
  ve fatura metni için kalemleri verir; kullanılmayan/başarısız görsel iade.

### Fiyatlandırma mantığı (31 Ekim 2026 akşam: hedef **%40 brüt kâr** — Kadir "daha fazla video üretebilsinler"; aşağıdaki eski %60 rakamları ×2/3)
**Güncel (%40, ×150):** araştırma 7 · senaryo 30 sn 5 / 60 sn 7 · Gemini ses 4/30 sn · ElevenLabs 16/30 sn · thumbnail 11 · AI görsel 7 · image→video 26 · Kling 64 · render 16/30 sn. 60 sn tam video hybrid **210** (30 sn 125), stills 153, cinematic 381 → Starter 500 = 4×30 sn / 2×60 sn, Business 5000 ≈ 23×60 sn. Test: "every item keeps ≥ 40% margin".

Tek kaynak `lib/pipeline/steps.ts`: `creditsForCost(usd) = ceil(usd / (0,40 ×
$0.01111))` ≈ maliyet × 225 (Business paketi Paddle sonrası en kötü gelir/kredi).
Maliyetler `provider_usage` gerçek ortalamaları (lab `usage-report`) + liste fiyatları:
araştırma $0.045 → **11** · senaryo 30 sn **7**, 60 sn $0.04 → **10** (3 dk 16, 8 dk 28, `scriptCredits`)
· seslendirme **başlanan 30 sn başına** Gemini **6** (=12/dk), ElevenLabs **23** (=46/dk) — 31 Ekim öğleden sonra: 30 sn ile 60 sn aynı fiyat çıkıyordu (Kadir), dakika→30 sn dilimine geçildi
(`voiceoverCredits(engine, duration)`; motor `voiceEngine` start route'ta ses id'sinden)
· altyazı **2 / 30 sn** (4/dk) · thumbnail $0.067 → **16** · AI görsel $0.04 → **10** · image→video
klip $0.17 → **39** · Kling klip $0.42 → **95** · render $0.10/30 sn → **23**.
60 sn tam video: hybrid-image **305** (eski 363), stills 218, cinematic-image 566,
hybrid-Kling 473. Her adımın ödenen kredisi `initialStepsState` ile adıma yazılır
(`credits`, `voiceover.subtitles_credits`, `plan.stillCredits/clipCredits`) → iadeler
satın alma anındaki fiyatla yapılır. Test: "every item keeps ≥ 60% margin".
Sabit aylık giderler (7 Kasım güncel): Vercel Pro $20, Supabase Pro $25, ElevenLabs
**Creator $22** (Starter değil; 121k kredi, 30 özel ses yuvası), alan adı ~$1, Sentry Free $0 →
**~$68/ay ≈ ayda ~10.200 kredi** (≈2 Business paketi) satışla başa baş. Paket fiyatları (7 Kasım 2026, Yağmur "rakiplere göre orta-yüksek"): Starter 500/**$12**, Growth 2000/**$39**,
Business 5000/**$89** (kod güncel; **Paddle ürün fiyatları elle güncellenmeli**). Abonelikler: Creator $9 hf / $29 ay / $319 yıl, Pro $21 hf / $69 ay / $759 yıl (yıllık = 11× aylık); krediler aynı kaldı → gerçek marj %40 tabanının üstünde. `REVENUE_PER_CREDIT_USD` bilerek $59/5000 bazında bırakıldı (yalnız maliyet→kredi çevirisi). **Ses klonu oluşturma** yalnız aktif Pro abonelik veya Business paket alanlara (+beta/iç hesaplar; `cloneEntitled`, lib/voice/clones.ts); mevcut klonlar çalışmaya devam eder.
- **Planlar & ücretsiz deneme filigranı (31 Ekim)**: `lib/plans.ts` her paketin ne
  aldırdığını `steps.ts` fiyatlarından hesaplar (`planDetails`, `JOB_COSTS`,
  `PAID_INCLUDES`, `FREE_TRIAL_RULES`, `COMPARISON`) → `/billing` ayrıntılı paket
  kartları + "Every pack includes" + "What things cost" + free-trial kutusu;
  landing fiyat kartları + **"Why Norveko"** premium karşılaştırma (`#compare`, yeşil
  tik = bizde gerçekten olanlar, sağ sütun genel "Typical AI tool"). **Filigran**:
  satın alma yoksa (`credit_purchases` completed) thumbnail sağ-alt köşeye
  `public/brand/watermark.png` rozeti (`lib/pipeline/watermark.ts`, sharp; temiz kopya
  `thumbnails/clean/<job>-<uuid>`), videoya Shotstack üst katman (`buildEdit
  watermarkUrl`, sağ üst, fit none). Kural `watermark-policy.ts`: `BETA_USER_IDS`
  muaf (`WATERMARK_FORCE_USER_IDS` test için: satın alma/beta olsa bile hesap deneme kullanıcısı gibi davranır, `isForcedTrialUser`). Proje `content.watermarked/
  cleanAssets` (server-owned). Paddle webhook ilk satın almada
  `removeWatermarksForUser()` → thumbnail'lar temize döner, filigranlı videolar
  (en çok 20) temiz yeniden render edilir. `/api/credits` `freeTrial` döner.
- **Ücretsiz deneme videosu (31 Ekim, Kadir)**: paket almamış (ve beta-muaf olmayan)
  hesap başına **bir** 30 sn video, hybrid + image→video, filigranlı, **0 kredi**
  (`TRIAL_VIDEO`, `isTrialVideoShape()` steps.ts; uygunluk `lib/pipeline/trial.ts`
  `trialVideoAvailable()` = satın alma yok + daha önce `pipeline_jobs.options.trialVideo`
  yok). Start route uygunsa `options.trialVideo=true` → `creditBreakdown` her kalemi 0
  yapar, plan `clipCredits/stillCredits` 0 → iade de 0; `deduct_credits` çağrılmaz.
  `/api/features` `trialVideo` döner (tam video erişimi gerekir); `/chat` yeşil "Use my
  free video" kutusu + "Free — trial video" toplamı. Maliyet ~$0.80/hesap. Landing/
  billing metni yalnız `NEXT_PUBLIC_FULL_VIDEO_ENABLED=true` iken gösterilir (lansmanda
  `FULL_VIDEO_ENABLED` ile birlikte aç).
- **Ücretsiz katman suistimal koruması (31 Ekim)**: `lib/pipeline/abuse.ts`, sadece paket almamış hesaplara uygulanır (`isFreeAccount` trial.ts), kontrol `/api/pipeline/start`'ta kredi düşmeden önce yapılır (kayıt tarayıcıdan doğrudan Supabase'e gittiği için orada engel atlatılabilir). (1) Geçici e-posta (`disposable-email-domains` ~120k alan + wildcard) → üretim yok, 403 `free_tier_blocked`. (2) Aynı IP'den 7 günde en çok 3 farklı ücretsiz hesap (`FREE_ACCOUNTS_PER_IP`). (3) Deneme videosu kişi başına bir: normalize e-posta (+etiket, Gmail noktaları) bir kez, IP 30 günde bir. IP/e-posta ham saklanmaz: tuzlu SHA-256 (`PIPELINE_WORKER_SECRET`) `pipeline_jobs.options.freeIp/freeEmail`. Arama hatasında genel kullanım açık kalır (fail open), deneme videosu kapalı kalır (fail closed). Kayıt formu `/api/signup-check` ile geçici e-postayı önceden uyarır.
- **Doğrudan yayınlama KALDIRILDI (8 Kasım, Yağmur: "iptal edelim, yanlış yönlendirme olmasın")**: YouTube/TikTok/Instagram bağlantısı ve yükleme özelliği üründen tamamen silindi — `lib/youtube|tiktok|instagram/`, `/api/youtube|tiktok|instagram/*`, `/api/projects/[id]/youtube|tiktok|instagram`, `*ConnectionCard`/`*Publish` bileşenleri, Ayarlar "Connected channels" sekmesi, seri yayın hedefleri (`SeriesPublish`; bölümler artık `ready` olup Projects'te bekler), `docs/app-reviews.md`, TikTok site doğrulama dosyası. Neden: Google OAuth doğrulaması + YouTube API denetimi + TikTok incelemesi + Meta uygulaması bekliyordu; denetimsiz uygulamalar yalnız private yükleyebiliyordu, YouTube demo videosunu kaldırdı. Paylaşılan `adminDb()`/`siteUrl()` → `lib/supabase-admin.ts`. Proje sayfası sekmesi "Shorts & translate". Landing/meta/FAQ artık "yayınla" demez, "YouTube, TikTok ve Instagram için hazır MP4" der; gizlilik 4.1 "Video platforms" (hesap bağlanmaz). Supabase: `youtube/tiktok/instagram_connections` tabloları düşürülecek (SQL `supabase/README.md`); Vercel'den `GOOGLE_OAUTH_*`, `YOUTUBE_TOKEN_KEY`, `TIKTOK_CLIENT_*`, `INSTAGRAM_APP_*` silinebilir; Google Cloud `norveko-publishing` ve TikTok geliştirici uygulaması kapatılacak. Dashboard YouTube istatistikleri (kanal ID + `YOUTUBE_API_KEY`) duruyor — bu yayın değil, okuma.
- **Google girişi GIS düğmesi (8 Kasım, Yağmur: Google ekranında 'supabase.co' yazmasın, para harcamadan)**: `app/components/auth/GoogleSignIn.tsx` — Google Identity Services (`accounts.google.com/gsi/client`) düğmesi + One Tap (login'de), ID token `supabase.auth.signInWithIdToken({provider:'google', token, nonce})` (nonce: ham değer Supabase'e, SHA-256'sı Google'a). Yönlendirme olmadığı için Google penceresi 'norveko.app' (marka doğrulanınca 'Norveko') der; Supabase Custom Domain ($10/ay) gerekmedi. Env `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (Vercel ✅ = Supabase Google sağlayıcısındaki istemci `321185354942-cj00…`, eski GCP projesi 'Norveko'; o istemciye Authorized JavaScript origins `https://norveko.app` eklendi ✅). Env yoksa eski `signInWithOAuth` yönlendirmesine düşer (`GoogleButton`). CSP: script/style/connect/frame-src'ye `https://accounts.google.com/gsi/`. Google ile kayıt doğrudan dashboard'a gider (Google e-postayı doğrulamış sayılır). Araştırma notu: Google, doğrulanmamış uygulamada uygulama adı yerine yönlendirme alan adını gösterir; Supabase callback'i yüzünden marka doğrulaması da takılıyor (discuss.google.dev); vanity subdomain artık panelde yok.
- **Görsel stil + altyazı stili (31 Ekim)**: `lib/pipeline/visual-styles.ts` tek kaynak. 8 görsel stil
  (cinematic varsayılan, archive, dark, anime, 3d, painting, comic, watercolor): `stillPrompt()` sahne
  görsellerinin başına stil metnini koyar (metin yasağı her zaman), `clipPrompt()` text→video ve
  image→video istemine ekler (cinematic'te değiştirmez), thumbnail'a `thumbnail` ipucu; senaryo yazarına
  "VISUAL STYLE" kuralı (prompt v`…-look`). 4 altyazı stili (bold=eski karaoke sarı, neon, box=konuşulan
  kelime mor kutuda `active.font.background` + `animation:"highlight"`, clean=küçük harf animasyonsuz);
  `buildEdit({captionStyle})`, SRT büyük harfi yalnız `uppercase` stillerde. Seçimler
  `pipeline_jobs.options.visualStyle/captionStyle` (start route doğrular). UI `app/components/StylePickers.tsx`
  (görsel stil her zaman, altyazı stili tam videoda). Önizleme görselleri `videos/previews/styles/<id>.jpg`
  (lab `style-previews`, Gemini, 3:4 480 px); yoksa gradient.
- **Edit video (üretim sonrası düzenleme, 31 Ekim)**: proje sayfası `VideoEditor` (yalnız bir kez
  render edilmiş tam videolar). `GET/POST /api/projects/[id]/edit` — iş, `steps.result.project_id` ile
  bulunur. `regenerate` {index, prompt?}: `STILL_SCENE_CREDITS` (7) peşin düşülür, işin görsel stiliyle
  yeni görsel (`still-<1000+index*100+n>`, CDN önbelleği için benzersiz), hata olursa iade; slot'a
  `editedStillUrl` yazılır (kind/url DEĞİŞMEZ → `consumedCredits` muhasebesi bozulmaz; `buildEdit` bu
  alanı her şeyin önüne koyar, klip slotu hareketli görsele döner), `steps.render.edits_pending/edit_count/
  edit_credits`. `rerender` {musicId?, captionStyle?}: `lib/pipeline/rerender.ts` `queueRerender()`
  (lab da bunu kullanır) — ücretsiz, iş başına en çok `MAX_RERENDERS`=10, `options.captionStyle`
  güncellenir, render `version+1` → `final-v<n>.mp4`, bitince `refreshProjectVideo`. UI 6 sn'de bir
  `/api/pipeline/[jobId]` poll eder, bitince sayfayı yeniler. **failJob**: işin zaten projesi varsa
  (başarısız yeniden render) yeni proje AÇMAZ, eski video kalır.
- **Seriler / otomatik pilot (31 Ekim)**: `/series` sayfası (Sidebar "Series"). Tablolar `series` +
  `series_episodes` (unique series_id+scheduled_for). `lib/series/schedule.ts` saf saat hesabı (Intl ile
  saat dilimi/DST), `lib/series/validate.ts`, `lib/series/run.ts`: `runSeriesTick()` aktif serilerin
  `LOOKAHEAD_HOURS` (env `SERIES_LOOKAHEAD_HOURS`, varsayılan 26 — Hobby'de cron günlük) içindeki yayın
  saatleri için bölüm açar → `pickNextIdea()` (SCRIPT_MODEL, önceki 40 fikri tekrar etmez) → kredi düşer
  (normal tam video fiyatı; yetmezse bölüm `skipped`) → `pipeline_jobs.options.series={id,episodeId}` ile
  iş başlar. Runner `deps.afterComplete` → `onJobCompleted()`: bölüm `generating` ise (re-render'da tekrar
  yayınlamaz) YouTube'a `publishAt`=yayın saati (geçmişse hemen), TikTok'a hemen (API zamanlama
  desteklemiyor). Durumlar pending/generating/publishing/published/ready/publish_failed/skipped/failed
  (iş başarısızsa GET'te failed gösterilir). Seri yalnız paket almış (veya beta) + tam video erişimi olan
  hesaplara (`seriesAllowed`), kullanıcı başına 5 seri, ses yalnız Gemini anlatıcıları. Cron
  `/api/series/tick` 04:00 UTC (`vercel.json`), "Make one now" → `/api/series/[id]/run`.
  CRON_SECRET Vercel'de tanımlı ✅ (31 Ekim, tick elle çalıştırıldı → 200). **İzleyicisiz işler (31 Ekim):**
  async adımlar (görseller/render) ve unutulan adımlar eskiden yalnız UI `GET /api/pipeline/[id]` ile
  ilerliyordu; ayrıca `/api/pipeline/run`'ın kendini çağırma zinciri Vercel'de birkaç adımdan sonra
  **508 INFINITE_LOOP_DETECTED** ile kesiliyor (seri bölümü thumbnail→video geçişinde takıldı). Çözüm:
  **Supabase pg_cron kalp atışı** (SQL `supabase/README.md` "Heartbeat") dakikada bir `/api/pipeline/reap`,
  saatte bir `/api/series/tick?lookahead=2`; yetki `lib/cron-auth.ts` (`CRON_SECRET` veya `HEARTBEAT_SECRET`).
  ✅ 31 Ekim canlıda 200; şifre Supabase **Vault** `heartbeat_secret`'tan okunur (SQL'e yapıştırmak tırnakları iki kez bozdu).
  (Kısa süre denenen `watchJob` kaldırıldı: zincir içinden kick ettiği için aynı 508'e takılıyordu.) TikTok geliştirici uygulaması "Norveko" (Bireysel) + Sandbox "Norveko test" (Vercel `TIKTOK_CLIENT_KEY/SECRET` = Sandbox anahtarları; env değerleri artık `.trim()` — yapıştırılan satır sonu client_key hatası verdi). ✅ 31 Ekim canlı test: Redkalien hesabı (gizli) bağlandı, Flannan videosu `SELF_ONLY` → `PUBLISH_COMPLETE`; seri testi (Flannan, YouTube private `6ulP0Mc6UeM`) uçtan uca yayınlandı. Production'a geçiş = TikTok incelemesi (demo video + ikon) sonra Production anahtarları; site doğrulama
  dosyası `public/tiktok2Vlc4spidXzS1mcfLwXijkpCKUcnVKNi.txt`; 1024 px ikon `public/brand/norveko-icon-1024.png`.
- **Brand kit (31 Ekim akşam)**: `lib/brand/kit.ts` + `brand_kits` tablosu (SQL `supabase/README.md`, yalnız service role) +
  `/api/brand` (GET/PUT renk-outro-logo yerleri, POST multipart logo → sharp PNG ≤512 px `videos/brand/<user>/logo-<uuid>.png`,
  DELETE `?part=logo`). Ayarlar `BrandKitCard` (logo, 8 renk + özel, end card ≤60 kr, canlı önizleme). Start route ve seri
  bölümü kiti `options.brand` snapshot'ı olarak işe kopyalar (`brandSnapshot`/`readSnapshot`; `/chat` "Apply my brand kit",
  `useBrandKit`). ✅ 31 Ekim canlı test (Dancing Plague, Norveko logosu + #7C3AED + "Follow for more mysteries"): thumbnail
  logosu, video logosu, mor hook kartı/altyazı vurgusu ve end card render'da doğru. `buildEdit({brand})`: logo sol üst (`fit contain`, scale 0.17/0.12), hook kartı arka planı marka rengi
  (yazı `contrastText`), son 2,5 sn end card. Altyazı vurgusu marka rengini ALMAZ, stilin rengi kalır (Kadir: "sarı renk iyi"). Thumbnail: `brandStoredThumbnail` logo sol üst
  (filigrandan ÖNCE → temiz kopyada da logo var). Hesap silmede tablo + logolar silinir.
- **TikTok inceleme uyumu (31 Ekim akşam)**: `TikTokPublish` ticari içerik bildirimi (Your brand/Branded content, etiket metni,
  branded iken "Only me" pasif, hiçbiri seçilmezse buton pasif), önizleme videosu, süre sınırı, değişen onay metni
  (Branded Content Policy), "Check status" (`GET /api/projects/[id]/tiktok` → `refreshTikTokStatus`); filigranlı (deneme)
  video paylaşılamaz (TikTok promosyon filigranı yasak). Gönderim **PULL_FROM_URL** `https://norveko.app/media/videos/...`
  (`next.config.ts` rewrite → Supabase public `videos`), URL öneki doğrulanmamışsa FILE_UPLOAD'a düşer. Başvuru rehberi:
  `docs/app-reviews.md`.
- **Ses klonlama (31 Ekim akşam)**: `lib/voice/clones.ts` + `voice_clones` (kullanıcı başına 1, service role) +
  `/api/voices/clone` (GET/POST multipart ≤3 dosya ≤4 MB toplam + zorunlu onay/DELETE) → ElevenLabs Instant Voice Clone
  (`cloneVoice`, ses adı `Norveko · <ad> · <user8>`, gürültü temizleme). Yalnız paket almış/beta. Ayarlar `VoiceCloneCard`
  (tarayıcıda MediaRecorder webm kaydı + okuma metni veya dosya yükleme; `Permissions-Policy microphone=(self)`).
  Gizlilik: `/api/voices` başkalarının klonlarını asla listelemez, sahibine `mine` döner ("Your voice" grubu); start route
  başkasının klonunu reddeder; `addLibraryVoice(..., protectedIds)` klonları slot boşaltmak için SİLMEZ. Fiyat ElevenLabs
  sesi gibi. **Kısıt:** ElevenLabs Starter 10 özel ses yuvası (kütüphane sesleri + klonlar) → kullanıcı arttıkça
  Creator (30) / Pro (160) plan gerekir. Seriler yalnız Gemini sesleri (klon yok). Hesap silmede ElevenLabs'te de silinir.
- **Invite & earn / affiliate (31 Ekim akşam)**: `lib/referrals/referrals.ts`. Link `norveko.app/?ref=<kod>` → middleware
  `nv_ref` çerezi (60 gün, httpOnly, ilk link kazanır) → dashboard `ReferralClaim` → `POST /api/referrals/claim` (kayıttan
  ≤7 gün, kendi kodu/önceden satın alan hesap yok). Ödül: davet edilen hesabın ilk **12 ay**ındaki her paketinin
  kredisinin **%20**'si davet edene kredi olarak (`rewardReferrer`, Paddle webhook'ta, işlem başına idempotent
  `referral_rewards`); Paddle iadesinde geri alınır (`revokeReferralReward`). Kredi türü `referral`. Nakit ödeme yok (sahte
  kayıt kazanç getirmez). UI: Ayarlar + Billing `ReferralCard` (link, kayıt/satın alan/kazanılan). Tablolar
  `referral_codes/referrals/referral_rewards` (SQL `supabase/README.md`). Gizlilik politikası 5. madde çerez notu.
- **Tek seferde bir video (1 Kasım, Kadir)**: start route kullanıcının seri dışı `running` işi varsa 429
  `job_in_progress` + `jobId` döner (eskiden 2'ye izin veriyordu). `GET /api/pipeline/active` → çalışan iş;
  `/chat` `?job=` yoksa açılışta bunu sorar ve ilerlemeyi geri getirir (başka sayfaya gidip dönünce render ekranı
  kaybolmuyor). `PipelineProgress onStatus` → iş sürerken Generate / "Run again" / "Start a new generation" gizli/pasif.
- **Abonelikler (1 Kasım, sandbox'ta ✅ — Pro yıllık test satın alma: +4.000 kredi, sonraki aylık kredi 1 Aralık, "Manage plan" portalı açılıyor)**: `lib/subscriptions.ts` (Creator/Pro × haftalık/aylık/
  yıllık (7 Kasım'dan itibaren güncel fiyatlar yukarıda: Creator $9/$29/$319, Pro $21/$69/$759): $6/380 hf, $19/1.500 ay, $209/1.500 her ay; Pro $15/1.000 hf, $49/4.000 ay, $539/4.000 her ay; yıllık
  "1 ay bedava" (11× aylık, 7 Kasım'da $190/$490'dan) ≈ %37–39 kâr, diğerleri ≥ %40). Paddle price id: env `NEXT_PUBLIC_PADDLE_PRICE_{CREATOR,PRO}_{WEEK,MONTH,YEAR}`,
  sandbox yedekleri `SANDBOX` (Paddle sandbox ürünleri "Norveko Creator plan"/"Norveko Pro plan", max adet 1). `lib/subscriptions-server.ts`: webhook
  `transaction.completed` + `subscriptionId` → `grantForTransaction` (credit_purchases satırı = idempotent; iade/filigran/
  referans akışları aynen çalışır), yıllık plan ayda bir `runSubscriptionGrants` (saatlik `/api/series/tick`),
  `subscription.*` → `syncSubscription`, iade → `stopYearlyGrants`. Tablolar `subscriptions`, `subscription_grants`
  (✅ Supabase'de oluşturuldu). `/api/billing/subscription`, `/api/billing/portal` (Paddle müşteri portalı: iptal/kart).
  UI `SubscriptionPlans` (landing + billing, dönem sekmesi), paketler "Top-up packs". Terms §4 + Refund policy güncel.
  Hesap silmede abonelik Paddle'da hemen iptal. **Kalan (canlı):** aynı ürünler + bildirim olayları + Vercel env; Paddle API anahtarlarının süresi doluyor (sandbox 1 Kasım'da doldu → portal 502), yenisi süresiz (sandbox).
- **Plan kredileri devretmez (3 Kasım, Kadir)**: her abonelik kredi yüklemesi (`subscription_grants`) yalnız kendi dönemi için geçerli: haftalık 7 gün, aylık/yıllık(aylık yükleme) 1 ay (`grantExpiry`, `expires_at`). Plan kredileri paket kredilerinden ÖNCE harcanmış sayılır: süre bitince kalan = yükleme − yüklemeden beri net harcama (`spend`+`refund` işlemleri), bakiyeden fazla olamaz → `add_credits(-kalan, type "expire")` (`expireSubscriptionCredits`, `expired_at` ile tek sefer). Yeni dönem kredisi eklenmeden önce (webhook `grantForTransaction`, yıllık `runSubscriptionGrants`) ve saatlik tick'te çalışır. Paket kredileri süresiz. Metinler (Terms §4, billing, landing, plans.ts) güncellendi. SQL: `subscription_grants` + `expires_at/expired_at/expired_credits`.
- **Uzun video (1 Kasım, Kadir: rakipler gibi)**: `FULL_VIDEO_DURATIONS` 30 sn/60 sn + **3 dk/10 dk** (`DURATIONS`'ta 8 dk → 10 dk). >60 sn = long-form: yalnız 16:9 (start route + /chat kilitler), slot 10 sn (`slotSecondsFor`), footage `footageModesFor()` = stock/hybrid/stills (cinematic yok), hybrid'de her 6. slot klip. **Yeni footage `stock` ("Stock + AI")**: 3 slottan 2'si Pixabay/Pexels stok video (`STOCK_SLOT_CREDITS`=1, runner `searchStock` sağlayıcısı, sahne başına senaryo yazarının `stockQuery`'si, klip tekrar kullanılmaz, URL doğrudan Shotstack'e verilir — kopyalanmaz), açılış dahil her 3. slot AI görsel; stok bulunamazsa slot AI görsele döner (`stockFallback`, bize maliyet, `consumedCredits` stok fiyatıyla sayar). Uzun videoda görseller poll başına 6 paralel (`LONG_IMAGES_PER_POLL`), voiceover uzunluk düzeltmesi/yeniden çekim YOK, müzik parça süresiyle tekrarlanır (`musicSeconds`), senaryo sahne sayısı `sceneRange()` (3 dk 12–16, 10 dk 26–34). TTS uzun metni `lib/pipeline/tts-chunks.ts` ile cümle sınırında ≤1600 kr parçalara böler (Gemini 4 paralel → PCM birleştir → tek forced alignment; ElevenLabs MP3 birleştir + hizalama ofsetleri). Fiyat (%40): 3 dk stock 215 / stills 287 / hybrid 344; 10 dk 657 / 897 / 1087 (araştırma dahil). **Kısıt:** final MP4 > 50 MB (3 dk'dan itibaren) Supabase free'de yüklenemez → Shotstack URL'si (24 saat) kullanılır; kalıcı saklama için Supabase Pro + bucket dosya sınırı yükseltilmeli.
- **Gerçek arşiv fotoğrafları (1 Kasım, Kadir)**: `lib/pipeline/commons.ts` Wikimedia Commons araması (yalnız **PD / CC0 / CC BY** — SA/NC/ND yok; harita/logo/diyagram başlıkları elenir; ≥900 px; 1920 px küçük resim URL'si doğrudan Shotstack'e). Senaryo yazarı sahne başına `archiveQuery` (yalnız gerçek, fotoğraflanmış yer/kişi/olay; yoksa boş). Stock modunda bir stok slotunun sahnesinde `archiveQuery` varsa önce Commons denenir (sahne başına en çok 2) → slot `kind:"archive"` (Ken Burns görsel), stok fiyatından sayılır; bulunamazsa Pixabay. Her arşiv fotoğrafı açıklamaya eklenir (`archiveCredits`, `withMusicCredit(…, slots)`). **Wikimedia, Shotstack'in indirmesini reddediyor** ("Asset URL not downloadable") → render öncesi `localizeArchivePhotos()` fotoğrafları bizim UA'mızla (`downloadArchiveImage`) `videos/<user>/<job>/archive-<i>.jpg`'ye kopyalar. **Başarısız render'ı yeniden dene**: `retryFailedRender()` (rerender.ts, ücretsiz, en çok 2; failJob iadesi bir kez olduğu için ikinci hata iade etmez), edit route `action:"retryRender"`, proje sayfası `RetryRender` bandı ("Render again"). ✅ 1 Kasım canlı: 10 dk Nuh'un Gemisi (TR, Stock+AI) — 28 sahne, 11 arşiv fotoğrafı (Durupınar, Doğubayazıt, Ararat), ilk render Wikimedia yüzünden düştü → düzeltme + retry → R2'de 376 MB, 8:11. **Uzunluk düzeltmesi (1 Kasım, Kadir: "tek seferde hatasız")**: uzun videoda hedef kelime ×1,06 (`wordRange`; Gemini anlatıcıları ~%6 hızlı), taslak `longFormCraft()` ile ~110 kelimelik paragraf bütçesi, editör/fact check yalnız süre varsa (150/110 sn) ki uzunluk geçişi her zaman çalışsın; kısa kalırsa `expandNarration()` metni yeniden yazmadan araya cümle ekler (`insertAdditions`, en çok 2 tur). Eski not: Commons bazen alakasız tablo döndürüyor (Carpaccio).
- **Stok/arşiv görsel uygunluk kontrolü (1 Kasım, Kadir: Nuh videosunda 2:50'de keman çalan adam)**: Pixabay etiketle eşleştiriyor, karede ne olduğunu görmüyor. Artık stok slotları için her sorgu bir kez (4 paralel, `mapLimit`) aranır → `offTopicTags()` (keman/müzik/dans/ofis/telefon… etiketleri, sorgu istemiyorsa) elenir → `pickFittingFrames()` (`lib/pipeline/stock-check.ts`, `STOCK_VISION_MODEL` varsayılan `gemini-3.8-flash`) aday önizleme karelerine anlatılan sahneyle (`scene.description` + prompt) bakar, uymayanları atar; arşiv fotoğraflarına da uygulanır (tablolar/haritalar elenir). Hiçbiri uymazsa slot AI görsele döner. Model hatasında kontrol atlanır (fail open). Runner sağlayıcısı `checkFit`. `StockClip.tags` (Pixabay etiketleri / Pexels slug).
- **Cloudflare R2 video depolama (1 Kasım, Kadir onayladı)**: final MP4'ler (uzun videolar 100–600 MB) R2'ye **akışla** kopyalanır (`lib/storage/r2.ts` `copyUrlToR2`, multipart 16 MB, `@aws-sdk/client-s3` + `lib-storage`), runner `providers.storeFinalVideo` (env yoksa null → eski Supabase yolu), `steps.render.hosted_by="r2"`. Bucket **özel**; kalıcı adres `https://norveko.app/media/videos/r2/<user>/<job>/final[-vN].mp4` → route `app/media/videos/r2/[...key]` 1 saatlik imzalı URL'ye 302 (`?download=<ad>` → attachment). TikTok doğrulanmış önek `/media/videos/` altında kalır (`pullUrlFor`); YouTube `ownStorageUrl/downloadOwn` R2'yi imzalı URL ile okur (sınır 900 MB). Hesap silmede `deleteR2Prefix(<user>/)`. Env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Uzun videoda Shotstack `quality:"low"` (medium 3 dk = 193 MB → low 136 MB). Supabase DB + küçük dosyalarda kalır. `next.config.ts` Supabase rewrite'ı `/media/videos/:path((?!r2/).*)` — dizi rewrite'lar dinamik route'lardan ÖNCE çalışıyor. ✅ 1 Kasım canlı: Cloudflare hesabı (Kadir), bucket `norveko-videos` (özel, Eastern Europe), token `norveko-vercel-videos` (yalnız bu bucket, Object R&W), Vercel env 4'ü ✅; 3 dk Timur videosu yeniden render → `hosted_by:r2`, 136 MB, oynatma/ileri sarma çalışıyor.
- **Karakterler (2 Kasım, Kadir: "fotoğraf yükleyip kendini / padişahları videoya koy")**: `lib/characters/characters.ts` + `characters` tablosu (SQL `supabase/README.md`, service role) + ÖZEL bucket `characters` (API ilk kullanımda oluşturur). Türler: `self`/`person` (1–4 foto, zorunlu onay kutusu → `consent_at`, her foto Gemini görü kontrolü: çocuk/çıplaklık/yüz yok → red), `historical` (≥50 yıl önce ölmüş; Commons'tan portre + `pickFittingFrames` → `generateReferencePortrait` gerçekçi referans), `fictional` (tariften portre). `checkIdentity()` (gemini-3.8-flash) yalnız çocukları reddeder (3 Kasım, Kadir: yaşayan ünlüler serbest, sorumluluk kullanıcıda; müstehcen/çocuk yasağı sürer; "historical" türü = herhangi bir gerçek kişi, UI "Real or historical person"; tarihi kişide kontrol hatası → red). Yalnız paket almış/beta (`allowed`), kullanıcı başına 12, iş başına 3. API `/api/characters` (GET imzalı önizleme, POST multipart, DELETE). UI Ayarlar sekmesi "Characters" (`CharactersCard`), /chat "Characters" katlanır seçici → `characterIds` → start route `castSnapshot` → `options.cast`. Senaryo: `castBlock()` (CAST + sahne `characters: [isim]`, gerçek kişi kuralı CAST hariç). Runner `refsFor(job, slot.characters)` → `generateSceneImage(..., refs)` (Gemini'ye referans görseller inlineData), thumbnail ilk 2 karakterle; karakterli stok slotu AI görsele döner; editör yeniden üretimi de referans kullanır. Hesap silmede bucket + tablo temizlenir.
- **Senaryo onayı / storyboard review (2 Kasım)**: tam videoda /chat "Let me review the script first" (varsayılan açık) → `options.review=true`. Runner `awaitingReview()` = script bitti + `approved_at` yok → sonraki adımlar `noop`, reconcile tetiklemez; 24 saat onaylanmazsa (`REVIEW_TIMEOUT_MS`, `steps.script.completed_at`'ten) `failJob` (yapılmayanlar iade). `POST /api/pipeline/[id]/review` {approve: hook/script/scenes(description, videoPrompt) düzenlemeleriyle → `approved_at`, sıradaki adıma queued_at + kick | cancel → failJob, senaryo kısmi proje olarak kalır}. UI `ReviewPanel` (PipelineProgress içinde; kelime sayısı ↔ `wordRange` hedefi, sahne açılır düzenleme), beklerken poll 15 sn ve zaman aşımı yok. GET `/api/pipeline/[id]` artık `duration, output_language` döner.
- **Tek tıkla çeviri (2 Kasım)**: proje sayfası Publish → `TranslateVideo` → `POST /api/projects/[id]/translate` {language, voiceId (Gemini anlatıcı veya kendi klonu)}. Yeni iş `options.translate={sourceJobId, fromLanguage}`: script = `translateScript()` (cümle/olgu korunur, hedef dilin kelime hızına göre uzunluk), voiceover + altyazı + thumbnail (üzerinde yazı var → `thumbnailIdea` metni çevrilir, cast kopyalanır) yeni, sahne görselleri kaynaktan (`rescaleSlots` ile yeni anlatım süresine esnetilir), müzik aynı. Fiyat `translationJob()` (steps.ts): çeviri + ses + altyazı + thumbnail + render (görseller 0, iade de 0; 30 sn ≈ 36). Async video adımı senkron biterse runner bekletmeden ilerler. Yeni proje olarak kaydedilir.
- **Uzun video → Shorts (2 Kasım)**: Publish → `ShortsFromVideo` → `/api/projects/[id]/shorts` (yalnız >65 sn, render bitmiş, altyazılı kaynak). `suggest`: `pickShortClips()` altyazı satırlarından 25–58 sn bağımsız anlar + başlık + ≤7 kelime hook (ücretsiz, video başına 5 kez, `steps.shorts.picks`). `make` {index}: iş `options.short={sourceJobId, from, to, title, hook}`, platform Shorts, dikey; anlatım kaynaktan `trim_from` ile (buildEdit `voiceoverTrim` → soundtrack yerine trim'li audio klip), `cutCues`/`cutSlots`; kendi dikey kapağı (hook yazılı, `thumbnailIdea` + "9:16"); ücret render + thumbnail (`shortJob`). Aynı anda en çok 3 Short; Shorts ve çeviri dışı "tek seferde bir video" kuralına Shorts girmez (`options->short` hariç).
- **Karakterler AI Workspace'te (2 Kasım, Kadir)**: `/chat` `CastPicker` (oluşturma da orada: `CharacterCreator` CharactersCard'dan export, Ayarlar da aynısını kullanır). Fikir yazılınca `POST /api/characters/suggest` (gemini-3.8-flash, `suggestHistoricalCast`) içindeki ≥50 yıl önce ölmüş tarihi kişileri önerir → tek tıkla tarihi karakter + seçili. Tarihi karaktere isteğe bağlı kendi portresi yüklenebilir (hak onayı zorunlu; `checkPhoto` + `generateReferencePortrait(fromImage)`); yoksa Commons portresi. Google görsellerini doğrudan çekmiyoruz (telif).
- **Zaman çizelgesi editörü (2 Kasım)**: `VideoEditor` yeniden yazıldı — cetvel + orantılı sahne şeridi (zoom), sahneler arası çizgiyi sürükle = `retime` {cuts} (≥1 sn, klavye ←/→ 0,5 sn), sahneyi diğerinin üstüne bırak = `swap`, sahne paneli: yeni AI görsel / kendi dosyan (`uploadUrl` → Supabase imzalı yükleme doğrudan tarayıcıdan, görsel ≤10 MB, video ≤50 MB → `useUpload`) / stok klip (`stockSearch` → `useStock`, yalnız pixabay/pexels URL'leri). Slot alanı `editedClip {url, seconds, poster, source}` (`editedStillUrl` ile karşılıklı dışlayıcı; `buildEdit` stok gibi oynatır; geçmişte `clip` bilgisi). Altyazı şeridi: cue'ya tıkla → metni düzelt (`text` {cues}); hook metni (`text` {hook}). Hepsi ücretsiz, değişiklikler yeniden render'da görünür.
- **Harita animasyonları (2 Kasım)**: senaryo yazarı sahneye isteğe bağlı `map {title, places[{name,lat,lon}], route}` koyar (1–2 sahne, `readMapSpec` maps-spec.ts doğrular). `planSlots` o sahnenin klip olmayan ilk slotuna `slot.map.spec`. Runner poll'da (1b) `renderMap` → `lib/pipeline/maps.ts` `renderMapFrames()` (d3-geo Mercator + world-atlas land-50m, modern sınır YOK, koyu deniz/kum kara, sharp ile SVG→JPEG; rota çizgisi kare kare uzar, noktalar sırayla belirir) → `videos/<user>/<job>/map-<slot>-<f>.jpg`, `slot.map.frames/labels`, slot `succeed` (hata → harita silinir, normal görsel/stok). `buildEdit`: kareler slotun %60'ında art arda, son kare tutulur (zoomInSlow); yer adları ve başlık Shotstack rich-text (sunucuda font güvenilmez), üst üste binen etiket noktanın altına. Ücret slotun normal fiyatı (still/stok).
- **Thumbnail + logo (2 Kasım)**: marka logosu varsa thumbnail istemine "sol üst köşeyi boş bırak" eklenir (Timur kapağında logo başlığın üstüne binmişti). Altyazı düzeltmede iki satırlık cue'nun satır sonu korunur.
- **Linkten video (2 Kasım)**: `/chat` "+ Make it from a link" → `sourceUrl`. Start route `cleanSourceUrl` + `fetchArticle` ön kontrolü (okunamıyorsa kredi düşmeden 400; fikir boşsa sayfa başlığından), araştırma zorunlu açık, `options.sourceUrl`. Runner research adımı `researchFromUrl()` (openai.ts): `lib/pipeline/source-url.ts` `fetchArticle` (yalnız http(s), DNS ile özel/loopback/link-local/CGNAT IP reddi, her yönlendirmede tekrar, ≤3 yönlendirme, 15 sn, ≤3 MB, HTML/düz metin; `extractArticle` article/main, script/nav/footer atılır, ≤14k kr) → `chatJSON` yalnız sayfadaki bilgiden 180–320 kelimelik brief, kaynak = sayfa. Sonra normal senaryo akışı (VERIFIED brief).
- **Public API (2 Nov)**: `lib/api-keys.ts`. Keys are `nv_live_…`; only the SHA-256 hash is stored, in the `api_keys` table (SQL is in `supabase/README.md`). At most 5 keys per user, and only paid or beta users can create them (`apiAllowed`). Settings has an "API" tab (`ApiKeysCard`) that shows a new key only once.
  - **Auth:** `userFromApiKey` resolves the key; `withApiUser` (AsyncLocalStorage) makes `requireUser()` return that key's user. That is how `/api/v1/videos` POST runs the normal `/api/pipeline/start` POST, with field aliases and `review:false`.
  - **Endpoints:** `GET /api/v1/videos`, `GET /api/v1/videos/:id` (`jobView`; polling also calls `reconcileJob`), `GET /api/v1/credits`, and `GET /api/v1/options` (public).
  - **Docs:** the `/developers` page (public, in `PUBLIC_PAGES` in middleware).
- **Takım (2 Kasım)**: `lib/teams.ts` + `teams`/`team_members`/`team_invites` (SQL supabase/README.md). Sahip (paket almış/beta) takım kurar, 7 günlük tek kullanımlık davet linki (`/team/join?token=`, hash saklanır), en çok 10 üye; kullanıcı tek takımda. Üyeler kendi hesap/projeleriyle çalışır, **krediler sahibin bakiyesinden**: `payerFor()` start/translate/shorts/edit/seri kredi düşümünde, iş `options.billedTo`, runner iadeleri `payerOf(job)`; `/api/credits` + `/api/v1/credits` havuz bakiyesini döner (`teamPool`); `hasPurchased` üyede sahibin satın alımına bakar (filigran/özellik kapıları). UI Ayarlar "Team" (`TeamCard`), `/api/team` (create/rename/invite/revokeInvite/remove/leave/delete), `/api/team/join`.
- **Konuşan sunucu / avatar (2 Kasım)**: `/chat` Characters içinde "On-camera presenter" (seçili karakterlerden biri) → `presenter`/`presenterId` → `PipelineOptions.presenter`, iş `options.presenter=<isim>`. `fullVideoPlan(..., presenter)`: kısa videoda 2, uzunda 3 slot (still slotlarının yerine), `avatarSlotCredits` = $0.15/sn (fal `FAL_AVATAR_MODEL`, varsayılan **`veed/fabric-1.0`** 720p, 5 sn ≈ 2 dk; Kling AI Avatar v2 2 Kasım testinde fal'da sürekli "downstream service error" verdi, `fal-ai/ai-avatar` kuyrukta 7+ dk bekledi — lab `avatar-submit`/`fal-raw` ile denendi) ×150; kalem "Presenter on camera × N". Runner: `pickPresenterSlots` (2. slot + son; uzunda 2./orta/son, hook kartının altı değil) → slot `kind:"avatar"`; poll 1c: anlatımdan slot aralığı kesilir (`lib/pipeline/audio-cut.ts`: WAV kesin, CBR MP3 yaklaşık) → `videos/.../presenter-<i>`, karakter portresi imzalı URL → `submitAvatar` → `getImageToVideo` ile toplanır; hata/12 dk → AI görsele döner (`avatarFallback`) + o slotun sunucu kredisi iade (`refundAvatars`). `buildEdit` avatar = sessiz video (ses anlatımdan). `consumedCredits` avatar durumu. **Not:** çeviride avatar slotları kaynak dildeki dudak hareketiyle kalır.
- **Karakter değiştirme / swap (3 Kasım, Kadir: viral "yüz değiştirme" Reels'leri gibi)**: `/swap` sayfası (Sidebar "Swap"). Kullanıcı ≤15 sn MP4/MOV klip yükler (imzalı yükleme `videos/<user>/swap/src-<uuid>`), kendi karakterlerinden birini seçer (yeni karakter de orada `CharacterCreator`), isteğe bağlı görünüm istemi, hak onayı. `lib/swap/mp4.ts` ffmpeg'siz süre/kare sayısı/boyut/dönüş okur → fiyat `swapCredits` = fal Wan 2.2 Animate Replace (`FAL_SWAP_MODEL`, varsayılan `fal-ai/wan/v2.2-14b/animate/replace`, 720p, **$0.08 / 16 kare**) ×150 + render. Başlamadan Gemini klibi kontrol eder (Files API; çocuk/çıplaklık/şiddet/kişi yok → red, kredi düşmeden). `swap_jobs` tablosu; `advanceSwapJob`: fal poll → Shotstack ile değiştirilmiş görüntü (ses kapalı) + orijinal klibin sesi → R2/Supabase → proje (YouTube/TikTok/Instagram paylaşımı proje sayfasından). Hata/zaman aşımı (fal 40 dk, render 20 dk) → tam iade. Heartbeat (`/api/pipeline/reap`) ve `/swap` poll ilerletir. Aynı anda 2 swap; takım havuzundan ödenir. ✅ 3 Kasım lab testi: Fatih konuşan klibi → Timur, doğal; 5 sn ≈ 9 dk.
- **Konuşan karakter / Talk (3 Kasım, Kadir: "diğer siteler nasıl yapıyorsa, basit")**: `/talk` (Sidebar "Talk"), Hedra/viral civciv videoları gibi: karakter seç (yeni karakter de orada, varsayılan "fictional"; hayali karakter portresi artık tarifteki görünüme uyar — çizgi film/hayvan olabilir) + replik (yaz → Gemini anlatıcı/kendi klonu, "Hear it" önizleme, `direction` ile anlatıcı değil karakter tonu; ya da MP3/WAV/M4A kaydı yükle) + mekân + görünüm (Realistic/3D/Anime/Painting) + 9:16/16:9 → tek sahne görseli (Nano Banana, karakter referanslı) → VEED Fabric dudak senkronu → R2 → proje. ≤30 sn, ≤450 kr; fiyat `talkCredits` = (sn × $0.15 + $0.04) ×150 (15 sn ≈ 344). `swap_jobs` `kind='talk'` (+`script`, `image_url`), aynı `advanceSwapJob` (fal bitince Shotstack yok, doğrudan `finish`). `lib/talk/talk.ts` (`audioSeconds`: WAV/MP3 Xing-CBR/M4A `mp4Seconds`), `/api/talk` (voice/uploadUrl/quote/start). Hak/aldatmama onayı zorunlu. Kadir'in isteği: İsmail Kartal'ın sesini klonlayıp söylemediği cümleleri söyletmek yapılmaz; gerçek kaydı yükleyip karikatüre söyletmek olur.
- **AI Workspace tek kutu + Skeç (3 Kasım, Kadir: "ne üretmek istediğini yazınca ona göre", hamam böceği videoları)**: `/chat` en üstte "What do you want to make?" kutusu (`idea`) + 4 mod kartı: Narrated video (eski form) / Skit with dialogue / Talking character / Character swap. `suggestMode()` (sezgisel: ≥2 diyalog satırı veya skeç/şaka/"videolarına uyarla" → skit, swap/yüz değiştir → swap, söylesin/konuşsun → talk) kullanıcı seçene kadar modu otomatik değiştirir, "Suggested" rozeti; `?mode=`. Talk/Swap gövdeleri `app/components/studio/TalkStudio|SwapStudio.tsx` (sayfalar `/talk`, `/swap` duruyor, Sidebar'dan kaldırıldı). **Skeç** `lib/skit/skit.ts` + `skit_jobs` (SQL supabase/README.md) + `/api/skit` (plan → taslak satır (ücretsiz, saatte 20) → start ücret düşer): `planSkit()` (SCRIPT_MODEL) replikleri kelimesi kelimesine korur, anlatımı sessiz çekim/ses efekti yapar, istenen stile (hamam böceği vb.) tüm karakterleri çevirir, gerçek kişiler kıyafetle karikatür (görsel tarifte isim yok), ≤4 karakter, ≤8 çekim, ≤45 sn, Gemini sesi seçer. Adımlar (`advanceSkitJob`, `lease_until` kilidi, heartbeat + `/api/skit?id=` poll, maxDuration 300): cast (karakter portreleri `generateReferencePortrait`) → shots (paralel: çekim görseli referanslarla `generateSceneImage`, replik TTS `direction` ile oyunculu, ElevenLabs `generateSoundEffect`) → animate (konuşan çekim VEED Fabric, sessiz çekim Seedance; hata → Ken Burns görsel) → render (`buildSkitEdit`: video sessiz, sesler + efektler ayrı izde) → R2 → proje (`content.skit`). Fiyat `skitCredits` (Kim Jong şakası 6 çekim ≈ 515). ✅ 3 Kasım canlı: "Gece Güneşe Yolculuk" 22 sn, hamam böceği başkan/gazeteci/dünya lideri, tutarlı karakterler.
- **Skeçte kalabalık bağırışı (3 Kasım, Kadir "ekle")**: çekim alanı `crowd` (diyalog dilinde, "Yaşa! Var ol!"); planlayıcı senaryodaki "yaşa, varol sesleri" gibi anlatımı buna çevirir. `stepShots` aynı sözü 4 farklı Gemini sesiyle (oyuncu kadrosunun seslerinden farklı, 2 erkek 2 kadın, "kalabalıkta bağıran biri" yönlendirmesi) ayrı ayrı okutur → `crowdUrls/crowdSeconds`; `buildSkitEdit` her sesi ayrı izde 0,17 sn arayla koyar (kalabalık etkisi) + alkış efekti; sessiz çekim bağırış kadar uzar. Ücret +$0.02/çekim. UI planda "Crowd: …" satırı.
- **Üretim ekranı skeç/talk/swap'ta (4 Kasım, Kadir: "video oluşurken ekranda bir şey dolmuyor")**: `GenerationStage` genelleşti (`StageStep.id` serbest + `expected`/`messages`, `title`, `children`); `SkitStudio` çalışan her skeç için 4 adımlı sahne (cast/shots/animate/render, `plan.phaseAt` her faz başlangıcı → `save()` yazar, `/api/skit` view `phaseAt`) + çekim önizleme şeridi; `TalkStudio` (sahne ✓ → dudak senkronu → kaydet) ve `SwapStudio` (değiştirme → ses) aynı ekranı gösterir; başlatınca ekran sahneye kayar. **Çeviri çökmesi (4 Kasım)**: Chrome sayfa çevirisi React metin düğümlerini değiştirip `insertBefore/removeChild` NotFoundError ile sayfayı düşürüyordu → `app/layout.tsx` head'de bu iki DOM çağrısını affedici yapan küçük inline script (facebook/react#11538). Skeç planı yedek modelle bir kez yeniden denenir (`SKIT_BACKUP_MODEL`, varsayılan gemini-3.8-flash), sınır 60 sn; `suggestMode` tırnaklı diyaloğu ve "videosu gibi"yi skeç sayar.
- **6 eksik tamamlandı (4 Kasım, Kadir "6'sını da yap")**: (1) skeçlere altyazı (TTS hizalamasından `s.cues`, `skitCues`/`skitLayout`, SRT `captions-<v>.srt`, `captionStyle` bold) + komedi müziği (`COMEDY_TRACKS`/`comedyTracksFor` music.ts, ses 0.08, atıf açıklamada); (2) skeç düzenleme: proje sayfası `SkitEditor` (`/api/skit?project=`, `redoShot` {index, note} ücretli `shotRedoCredits` → faz shots → animate → render, aynı projeye `final-v<n>.mp4`; `recut` {captions|music} ücretsiz; en çok 12 düzenleme; animate zaman aşımı artık `phaseAt`'ten); (3) depolama: `lib/storage/media.ts` `storeMedia()` R2 (yoksa Supabase), `/media/videos/r2/` resim/ses/srt de sunar (Shotstack 302'yi takip ediyor ✅ lab `r2-media-test`), skeç portre/replik/kalabalık/efekt R2'de (`refUrl`), swap kaynak klibi bitince silinir, lab `migrate-finals` `kind:"clips"` sahne MP4'lerini R2'ye taşır + `cleanup-swap-sources`; (4) ana sayfa `#studios` "Beyond narration" 3 kart + Billing fiyat satırları + COMPARISON — fiyatlar tek kaynak `lib/skit/pricing.ts` (`skitCreditsFor`, `talkCreditsFor`, `swapCreditsFor`, `CREATIVE_COSTS`); (5) seri `settings.format:"skit"` (`pickNextSkit` → `planSkit` → skit_jobs, `plan.series`; bitince `onSkitCompleted` → ortak `publishEpisode`), /series format seçici; API `POST/GET /api/v1/skits`, `GET /api/v1/skits/:id` (+ /developers).
- **Skeçte herkes aynı anda konuşuyordu (4 Kasım, Kadir)**: dudak senkronu modeli karedeki her yüzün ağzını oynatıyor (balıkçı skeçinde 3–4 balıkçı aynı karede). Artık konuşan çekim = yalnız konuşanın tek kişilik orta/yakın planı (`shotPrompt`: diğerleri en fazla arkadan/bulanık, yüzleri dönük; referans yalnız konuşan), sessiz çekimlerde "mouths closed", avatar istemi "yalnız ortadaki konuşur"; planlayıcıya da kural.
- **3 karakter sesi (4 Kasım, Kadir: "bu tarz animasyonlarda sadece bu 3 seçenek")**: `lib/skit/voice-styles.ts` — `cartoon` (ince ve hızlı, viral hamam böceği/civciv sesi: Gemini WAV'ı `applyVoiceStyle` ile ×1,3 yeniden örneklenir), `comic` (doğal ses, abartılı oyunculuk, işlem yok), `gruff` (kalın, boğuk, yaşlı; 5 Kasım: ×0,9 yavaşlatma kaldırıldı — "ağır çekim kaset" gibiydi, artık doğal tempoda kalın ses). Her biri erkek/kadın; ses `voiceFor(style, gender, n)` ile seçilir, oyunculuk `styleDirection()`. Skeç planlayıcısı karaktere `gender` + `voiceStyle` verir (`assignVoices`, eski planlar = comic), taslakta karakter kartında 3 düğme + Male/Female (`/api/skit` `action:"voice"`, ücretsiz). Talk ses listesi yalnız bu 6 seçenek (`style:<id>:<gender>`) + varsa kullanıcının kendi klonu. İnceltilmiş/kalınlaştırılmış replikte hizalama cue'ları atılır (altyazı yok zaten).
- **Altyazı yalnız anlatımlı videoda ve isteğe bağlı (4 Kasım, Kadir)**: skeçlerde altyazı yok (`renderExtras` SRT yüklemez, SkitEditor'da altyazı düğmesi kaldırıldı, `prepareRecut` yalnız müzik). Tam videoda altyazı artık zorunlu değil: `normalize` `subtitles = voiceover && opts.subtitles`, /chat "Auto subtitles" tam videoda da açılıp kapanır (kapalıyken altyazı stili gizli), start route `includeSubtitles` tam videoda da okunur. Runner tam videoda cue'ları HER ZAMAN üretir (zaman çizelgesi onlara dayanır) ama SRT'yi yalnız `steps.voiceover.subtitles === true` iken yakar. Çeviri kaynağın altyazı durumunu izler; seri ve Shorts altyazılı kalır.
- **Sadeleştirme + denetim (4 Kasım, Kadir: "tüm sayfaları incele")**: tarih/sayılar her yerde `"en-US"` (Türkçe tarayıcıda "1 Kas", "4.000" ve ana sayfada React #418 hydration hatası çıkıyordu); /chat'te kapalıyken "Generate video clips — Coming soon" kartı gizli; proje sayfası yalnız dolu içerik sekmelerini gösterir, skeç/talk/swap etiketi (yeni projeler `style` = Skit / Talking character / Character swap); "Invite & earn" yalnız Billing'de; boş Recent Videos gizli; `/talk`, `/swap` → `/chat?mode=`. Giriş: middleware giriş yapmamış kullanıcıyı `/login?next=<yol>`'a gönderir, login/signup/OAuth/doğrulama maili `next`'e döner (`lib/safe-next.ts`) → takım daveti artık kaybolmuyor. Skeç/talk TTS'te ücretli forced alignment yok (`synthesizeNarration({align:false})`). `/api/voices` ve `/api/ai-insights` sağlayıcı modüllerini lazy import eder. Tam videoda altyazı alınmadıysa projeye `.srt` cue'ları yazılmaz (Shorts adımdaki cue'ları kullanır). YouTube bağlanınca `user_channels` otomatik dolar (dashboard istatistikleri için elle kanal ID'si gerekmez). Ana sayfa hero ve meta açıklaması tam video/skeç/yayınla güncellendi. **Temizlik (4 Kasım, "temizle")**: `middleware.ts` → **`proxy.ts`** (Next 16 adı, fonksiyon `proxy`); skeç plan sınırı artık DB'den (son 1 saatteki `skit_jobs` satırları); skeç altyazı kalıntıları silindi (`skitCues`, `buildSkitEdit` altyazı izi, `plan.captions/captionStyle`, `shot.cues`); ölü kod silindi (`POST /api/projects`, `/api/pipeline/render-check`, `generateVideoContent`, `getPackageById`, `getUserChannelId`, `captureMessage`, `SUBTITLES_CREDITS` takma adı); review `edited_at_review` yalnız gerçek değişiklikte; `.env.example` isteğe bağlı model değişkenleri; `@types/topojson-specification` devDependency.
- **4 madde (4 Kasım gece, Kadir "yap"; Cartoon sesi onaylandı)**: (1) skeç çekim istemi: konuşanın dışındaki karakterler kendi `look`'larıyla (arkadan da) + "sahnedeki herkes kadroyla aynı tür, hayvan/böcekse insan yok" kuralı; konuşan çekime diğer görünen karakterlerin referansı da eklenir (doktor skeçinde böcek doktor arkadan insan görünüyordu). (2) lab `relabel-creative-projects`: eski skeç/talk/swap projelerinin `style`'ı Skit / Talking character / Character swap. (3) Seri `settings.subtitles` (eski seriler = açık, /series "Burn subtitles into every episode", kapalıyken altyazı stili gizli; skeç formatında altyazı/stil gösterilmez) ve Shorts `subtitles` (ShortsFromVideo onay kutusu, `shortJob({subtitles})`). (4) Ana sayfa `HeroDemo`: araştırma → senaryo → ses → görseller → müzik/altyazı → MP4 adımları, sonunda gerçek vitrin videosunun kapağı (`SHOWCASE_VIDEOS[0]`) → `#examples`.
- **Global vitrin videoları (5 Kasım, Kadir: "Türkiye'ye özgü değil, globalde viral formatlar; 1 tanesi gerçek hayattan, sinematik")**: `lib/showcase.ts` 3 video — Narrated "The Three Lighthouse Keepers Who Vanished" (Flannan, 31 sn), Skit "The Secret to a Happy Marriage" (gerçekçi sokak röportajı, yaşlı adam Gruff + muhabir Comic, 21 sn, `final-v1`), Talking character "Bigfoot's Vlog, Day 400" (sisli orman, telefon, Gruff ses, 13 sn). Kartlarda mod rozeti + `made` satırı; eski TR videolar kaldırıldı. **Swap vitrini yok:** Office Cat denemesi (Wan Animate replace, insan→kedi) orijinal adamı döndürdü; insan→insan çalışıyor. **fal bakiyesi** 4 Kasım gece −$2.40'a düşmüştü → Bigfoot/swap başlamadı, skeç dudaksız (Ken Burns) bitti; Kadir $50 yükledi, Auto top-up için kayıtlı kart gerekiyor. Yeni: skeç editöründe **"Animate still shots · free"** (`prepareReanimate`, `action:"reanimate"`: `clipFailed`'leri silip animate'e döner, görsel/ses korunur); talk/swap başlangıç hatası gerçek nedeni söyler (`detail`); lab `fal-probe` (ham fal cevabı), `self-credits` (sahibe ≤2000 kredi, `bonus`), `stock-search`/`stock-swap-source` (Pixabay klibini swap yüklemesine kopyalar); `lib/swap/mp4.ts` **fragmented MP4** (Pixabay) süre/kare okur (`fragmentStats`, mvex/mehd + moof/trun). Vitrin için hesaba 600 kredi eklendi.
- **Bitince ekranda oynat (4 Kasım, Kadir)**: `app/components/studio/FinishedVideo.tsx` — skeç/talk/swap stüdyoları bu sayfada `running` görülen işi (`seenRunning` ref) `completed` olunca ilerleme ekranının yerine otomatik oynayan video + "Download MP4" (`?download=`) + "Open project & publish" ile gösterir; sayfadan çıkılmışsa video yalnız Projects'te.
- **Dudak senkronu ucuzladı (3 Kasım, Kadir "yap")**: lab `fal-price` (fal pricing API) + test: Kling AI Avatar v2 Standard **$0.0562/sn** civciv gagasını Fabric ($0.15/sn 720p, 480p $0.08) kadar iyi oynatıyor → varsayılan `FAL_AVATAR_MODEL=fal-ai/kling-video/ai-avatar/v2/standard`, yedek `FAL_AVATAR_FALLBACK_MODEL=veed/fabric-1.0` (gönderim hatasında hemen; iş başarısızsa sunucu slotu/Talk/skeç çekimi bir kez yedeğe yeniden gönderilir, `isFallbackAvatar`). Fiyat `AVATAR_COST_PER_SECOND` 0.15 → **0.075** (ara sıra yedeği karşılar): Talk 10 sn 232 → ~119, Kim Jong skeçi 515 → ~345. Diğer adaylar: OmniHuman $0.14–0.16, InfiniTalk/Wan S2V $0.2, Kling Pro $0.115.
- **Admin başa baş kartı (8 Kasım, Yağmur)**: Overview "Break-even this month" — takvim ayı brüt gelir (`credit_purchases` completed) / hedef (`FIXED_COSTS` toplamı ÷ 0,40 = $170), ilerleme çubuğu, ay içi sağlayıcı maliyeti (ayrı `provider_usage` sorgusu, pencereden bağımsız), net = gelir − maliyet − tüm ay sabit gider, 3. günden sonra aya yansıtma. API `overview.month`. Not: sağlayıcı bakiyeleri (8 Kasım): fal $124, Gemini ~$16, Shotstack ~$28, OpenAI ~$26 ≈ $194 ön ödeme; %40 marjla ≈ $130 brüt kâr eder, sabit gider aylık $68 → aylık brüt gelir $170 altı zarar. Gerçek gelir henüz $0 (paneldeki $528 sandbox).
- **Admin paneli müdahale araçları (5 Kasım, Yağmur "arka planda düzeltme")**: `/admin` artık yalnız okuma değil. Kullanıcı satırında **Manage** → `app/admin/AdminActions.tsx` diyaloğu: kredi ekle/çıkar (not zorunlu, `add_credits` `p_type:"admin"`), **Beta** / **Full video** erişimi (`user_access` tablosu, `lib/access.ts`: 60 sn önbellek, `requireUser()`/seri tick/`needsWatermark` yükler; env allowlist'ler de geçerli kalır), askıya al/kaldır (Supabase auth ban `ban_duration`, askıya alınca çalışan işler iade ile durdurulur), şifre sıfırlama maili, hesap silme (e-posta yazarak; `lib/account.ts` `deleteAccount()` — Settings'teki silme de aynı fonksiyon). Üretim satırında: **Nudge** (reconcile + kick / skit lease temizle + advance / swap advance), **Stop & refund** (`failJob` / `failSkitJob` / `failSwapJob`), **Retry render** (`retryFailedRender`). Hepsi `POST /api/admin/actions` → `admin_actions` tablosuna loglanır, "Admin log" sekmesi. Admin'ler askıya alınamaz/silinemez, kendi hesabı da. SQL `supabase/README.md` "Admin panel". Giriş sayfaları (5 Kasım): ortak `app/components/auth/*` (logo, Terms/Privacy, autocomplete, şifre göster/gizle, `noindex`).
- **Ana sayfa müşteri denetimi (5 Kasım, Yağmur "müşteri gibi gez, hepsini düzelt")**: Terms'teki `[LEGAL NAME]` canlıdaydı → `LEGAL_NAME = "Norveko"` (şirket kurulunca gerçek unvan). Landing tek hikâye: eski "content package" bölümleri (The Problem, 6 adımlı Workflow, AI Workspace, Formats) silindi; "How it works" (`#workflow`) idea → video → publish olarak yeniden yazıldı; "rolling out in beta" notu kaldırıldı (artık 50 kredinin ne aldığını söyler, `FREE_CREDITS_BUY` plans.ts: steps.ts fiyatlarından "two researched scripts… or one with narration"); hero/pricing/FAQ aynı ifadeyi kullanır. FAQ 4 → 10 soru (video dosyası, ücretsiz kredi, kredi sistemi, hata/iade, süre, ticari kullanım, inceleme/düzenleme, dil/ses, modeller, iade politikası). Tek seferlik "Pro" paketi **"Growth"** oldu (id/Paddle `pro` aynı) — Pro planla karışıyordu. Son CTA "Ready to make your first video?". Sosyal kanıt (yorum/sayaç) bilerek eklenmedi: sahte veri yasak; gerçek kullanıcı olunca eklenecek.
- **Landing iyileştirmeleri + mod rehber videosu (7 Kasım, Yağmur "önerileri yap")**: landing küçük notlar `text-gray-400` (kontrast), `Reveal` daha erken/kısa (reduced-motion güvenli), JSON-LD (SoftwareApplication + FAQPage, `LandingPage` içinde), canonical (`app/page.tsx`), 1200×630 sosyal önizleme `app/opengraph-image.tsx` (+ `twitter-image.tsx`, kart `summary_large_image`). `/chat`'te mod kartlarının altında `ModeGuide` (`app/components/ModeGuide.tsx`): 52 sn sessiz anlatım videosu `public/tutorial/norveko-modes.mp4` (~0,5 MB, `preload="none"` + poster), bölüm düğmeleri modu da seçer, ilk ziyarette bir kez açık gelir (`nv_mode_guide_seen`). Video, tarayıcıda çizilen animasyonlu HTML'den kare kare alınıp ffmpeg ile üretildi; UI metni değişirse yeniden üretmek gerekir.
- **Açık / koyu tema (7 Kasım, Yağmur)**: arayüz koyu öncelikli yazıldığı için açık mod sınıfları tek tek değiştirmez; `app/globals.css` `html[data-theme="light"]` Tailwind renk değişkenlerini çevirir (white ↔ koyu, gri ölçek ters, soluk vurgu tonları 50–400 koyulaşır; değerler Tailwind paletinden üretildi). Yüzeyler `--nv-bg/--nv-panel/--nv-field/--nv-raised` (eski `bg-[#0a0a12]` vb. sınıflar bunlara çevrildi), sayfa rengi `--nv-page` (koyu adalarda geri çevrilmez, hero alt/üst geçişleri). Koyu kalan "adalar": `.nv-dark` (landing hero, VideoPlayer, vitrin kartları) + düz renkli/güçlü gradyanlı öğeler (`[class~="bg-blue-500"]`, `from-blue-500` …) koyu paleti geri yükler, beyaz yazı orada beyaz kalır. Seçim `localStorage nv_theme` + `<html data-theme>`, `app/layout.tsx` ilk boyamadan önce uygular; varsayılan koyu. Düğmeler: `app/components/ThemeToggle.tsx` (landing navbar ikon, Sidebar altında Dark/Light). Yeni bileşende hex arka plan yerine `--nv-*` kullan; `bg-white text-black` gibi çiftlerde metni `text-[var(--nv-page)]` yap.
- **Logo altında marka adı + tek ücretsiz yeniden render (7 Kasım, Yağmur)**: `brand_kits.brand_name` (SQL ✅ çalıştırıldı), Ayarlar Brand kit "Name under the logo", `buildEdit` logonun altına küçük aralıklı büyük harf (`BrandSnapshot.name`); `queueRerender` adı güncel kitten alır (eski videolar yeniden render'da alır). `FREE_RERENDERS` ve `FREE_SKIT_RECUTS` artık **1** (uzun video zaten 1).
- **Ücretsiz plan kilidi (7 Kasım, Yağmur)**: hiç ödeme yapmamış hesap yalnız tek kurulum: tam videoda 30 sn + Stock + AI + Gemini anlatıcı (tam video kapalıysa paket 30/60 sn); skeç/talk/swap, ElevenLabs sesleri, diğer süre/görüntü modları, sunucu/karakterler kilitli → `/billing` "See plans and packs" (`UpgradeCard`, /chat). Kural tek kaynak `lib/plans.ts` `FREE_PLAN`/`freePlanViolation()`; sunucu `/api/pipeline/start` + `/api/skit|talk|swap` start 403 `upgrade_required` (kredi düşmeden).
- **Kullanıcıya ham hata gösterilmez (7 Kasım, Yağmur)**: `lib/user-error.ts` `friendlyError()` → içerik politikası / servis geçici olarak kullanılamıyor / zaman aşımı / genel; ham metin DB'de kalır (admin görür). `PipelineProgress` hata kutusu en üstte (`role="alert"`), başarısız işte /chat formu açılmaz, hata görünür alana kayar; stüdyo listeleri `friendlyErrorLine()`.
- **Gemini ön ödeme uyarısı (7 Kasım, Yağmur)**: Gemini API ön ödemeli; bakiye 0 olunca projedeki tüm anahtarlar 402 verir (7 Kasım bir video bu yüzden düştü). Google bakiyeyi API ile vermiyor → `/api/admin` son 24 saatteki işlerin hata/adım metninde "prepayment credits are depleted"/RESOURCE_EXHAUSTED arar → Overview kırmızı "Gemini credit ran out" bandı + "Gemini spend, 24 h" kartı (`provider_usage`). Asıl önlem: AI Studio Billing → Auto-reload (eşik + aylık üst sınır).
- **Anlatım 1,25× (7 Kasım, Yağmur: "1.25'e alınca ideal")**: `NARRATION_TEMPO`=1,25 (`lib/pipeline/narration.ts`). Gemini anlatımı `lib/pipeline/tempo.ts` `stretchPcm16()` (WSOLA, perde değişmez, 60 sn ≈ 0,1 sn işlem) ile hızlanır, sonra forced alignment; ElevenLabs `speed` = 1,25 × düzeltme (API sınırı 1,2). Yalnız `direction` olmayan anlatımda; skeç/talk/kalabalık etkilenmez. Senaryo uzunluğu `narrationWordsPerSecond()` = dil hızı × tempo (`wordRange`, senaryo/çeviri istemleri) → 30 sn EN 90, TR ~69 kelime. Ses önizlemeleri `<ses>-<dil>-t125.wav` (eski yavaş dosyalar kullanılmaz).
- **Projects listesinde küçük resim (7 Kasım, Yağmur)**: `/api/projects` `content->>thumbnailUrl` ve `finalVideoUrl` döner; liste satırında 16:9 kapak (skeçte ilk çekim, talk'ta sahne görseli), videoysa oynat rozeti, kapak yoksa film/metin ikonu.
- **Sade arayüz (1 Kasım, Kadir: "premium ama basit, sayfalar uzamasın")**: ince koyu scrollbar (`globals.css`, `nv-no-scrollbar`), kompakt Sidebar; `app/components/PageTabs.tsx` (`PageTabs` + `?tab=` `useTabParam`, `PageHeader`) ve `Disclosure.tsx`. Ayarlar/Billing/proje detay (Video · Publish · Script & assets) sekmeli; /chat'te şablon, görünüm ve klip/altyazı ayarları katlanır; proje listesi kompakt satırlar.
- **Admin paneli (5 Kasım)**: `/admin` (yalnız sahip; `lib/admin.ts` `isAdmin` = env `ADMIN_USER_IDS` (yoksa `BETA_USER_IDS`) veya doğrulanmış e-postası `OWNER_EMAILS` (yacesonat@gmail.com) / env `ADMIN_EMAILS` içinde olan hesap; başkasına 404). `GET /api/admin?days=7|30|90` service role ile salt okunur: kullanıcılar (auth + bakiye + ödeme + plan), üretimler (`pipeline_jobs` + `skit_jobs` + `swap_jobs`, son 300), ödemeler (`credit_purchases`), sağlayıcı maliyeti (`provider_usage`), günlük kayıt/gelir/maliyet. Sekmeler Overview / Users / Generations / Payments / Provider costs. Sidebar "Admin" linki `/api/credits` `admin` alanıyla yalnız sahibe görünür. Veri değiştirmez (kredi verme vb. yok). Beta listesine başka biri eklenmeden önce `ADMIN_USER_IDS` tanımla. **fal bakiyesi (5 Kasım, Kadir "%20'ye inince göster")**: `GET https://api.fal.ai/v1/account/billing?expand=credits` (anahtar `billing:usage:read` izni ister) → Overview'da "fal.ai balance" kartı; bakiye ≤ `FAL_TOPUP_USD`×0,2 (varsayılan $50 → $10) ise kırmızı uyarı + fal link. Auto top-up'tan Kadir vazgeçti (kart kaydetmek istemedi).
- **Kâr hedefi %40, yıllık hariç (5 Kasım, Yağmur: "amaç bütün planlarda yüzde kırk kâr"; KDV fiyata dahil değil, ödeme ekranında eklenir)**: (1) **Yıllık planlar bilinçli istisna** (Yağmur, aynı gece: "yıllıkta esneyebiliriz, cazip olmalı"): önce $215/$565'e çıkarıldı, sonra **$190 / $490 "2 months free"e geri alındı** (≈ %33 / %31 kâr; Paddle fiyatları değişmedi). Haftalık/aylık planlar ve paketler ≥ %40 (test yıllıkta 0,30, diğerlerinde 0,40 ister). (2) **Yeniden render**: videonun ilk `FREE_RERENDERS`=3 yeniden render'ı ücretsiz, sonrası render fiyatı (`rerenderCredits`, 16 kredi / 30 sn; `steps.render.rerender_credits`, başarısız olursa `failJob` iade eder); üst sınır yine 10. Skeçte müzik re-cut: ilk `FREE_SKIT_RECUTS`=3 ücretsiz, sonra render fiyatı (`recutCredits`). Başarısız render tekrarı ve "Animate still shots" ücretsiz kalır (hata bizde). (3) **Davet ödülü** "%20'ye kadar": `rewardFor(credits, netUsd)` ödülü satışın %40 kârı koruyacağı kadarla sınırlar (Starter/Pro paket/haftalık planlar tam %20; Creator aylık ≈ %5, Pro aylık ≈ %4; Business ve yıllık ≈ 0). (4) **Skeç/talk/swap maliyet kaydı** `lib/creative-usage.ts`: iş bitince/başarısız olunca üretilenlerden (görsel, dudak senkronu sn, klip, TTS karakteri, efekt, render sn) `provider_usage` satırları (`step` = skit|talk|swap; skeç düzenlemeleri `plan.pendingEdit` işaretiyle yalnız yeniden yapılanı yazar). **Supabase'de bir kez SQL gerekir** (`supabase/README.md`: `provider_usage_job_id_fkey` kaldırılır); çalıştırılana kadar kayıt sessizce düşmez. Gözlem (1–2 Kasım): kredi başına gerçek maliyet $0,0079 (hedef $0,0067) — fark ücretsiz yeniden render/tekrarlardan.
- **Skeçte konuşan çekimler Veo 3.1 Fast + skeç kârı %30 (5 Kasım, Kadir)**: lab karşılaştırması (aynı görsel + replik: TTS+dudak senkronu / Veo 3.1 Fast / Kling 3 / Seedance 2) → Kadir Veo'yu seçti. `lib/pipeline/fal-video.ts` `submitTalkingVideo` (`SKIT_TALK_MODEL`, varsayılan `fal-ai/veo3.1/fast/image-to-video`, `generate_audio:true`, 720p, 4/6/8 sn `talkClipSeconds`; `avatar` = kapalı). Skeçte konuşan çekim Veo'ya gider (`shot.talkClip` = klip sn; `talkPrompt`: dil, ton, Cartoon/Comic/Gruff ses tarifi, replik kelimesi kelimesine, yalnız konuşan konuşur); render'da klibin kendi sesi çalar, TTS çekimi yalnız yedek (Veo hata → `talkClip=null` + eski dudak senkronu; replik >7 sn → dudak senkronu). Fiyat $0.15/sn; **skeçler `SKIT_MARGIN`=0,35 (7 Kasım'da 0,30'dan; Yağmur: marj sabit gideri karşılamıyor)** (`creditsForCost(usd, margin)`), talk/swap %40 kalır (test). Bilinen risk: Veo sesi her çekimde yeniden üretir, aynı karakter çekimler arasında az farklı tınlayabilir. **Talk da Veo'da (5 Kasım, "iyi bu")**: yazılan replik (`talk/aud-…` TTS yolu) ≤ ~7 sn ise `talkClipFor()` → `submitTalkingVideo` + `talkVideoPrompt` (ses stili `voiceId` `style:<id>:<gender>`'dan); yüklenen kayıt (`talk/rec-…`) dudak senkronunda kalır (kişinin kendi sesi). Fiyat `talkCreditsFor(seconds, clip)` (%40). Veo hatası → `retryTalk` TTS kaydıyla Fabric dudak senkronu. İlk Veo skeci "The Whole Sofa" (köpek + kedi dede, 22 sn) vitrinde; ilk denemede boş ses izi Shotstack'te reddedildi → `buildSkitEdit` boş `voices` izini koymaz; lab `revive-skit` başarısız skeci kaldığı fazdan sürdürür (krediyi yeniden düşer). **5 Kasım devam:** Veo istemine karakter başına sabit ses imzası (`voiceSignature`: stil + cinsiyet + karaktere sabit tını + yerel aksan, her çekimde aynı metin); 7,2 sn'yi aşan replikler `lib/skit/split.ts` `splitLongLines()` ile cümle (sonra virgül) sınırında aynı konuşanın ardışık çekimlerine bölünür (her kelime korunur, kamera orta/yakın değişir, efekt/kalabalık yalnız ilk parçada, toplam ≤ `SKIT_MAX_SHOTS`+6); planlayıcıya "konuşan çekim ≤ ~15 kelime" kuralı. Test var.
- **Maliyet düzeltmeleri (6 Kasım, Yağmur: maliyet analizindeki riskler, "bilinçli olanlar kalsın")**: (1) uzun videoda (>65 sn) bedava yeniden render 1 (`FREE_RERENDERS_LONG`, `freeRerendersFor()`), Shorts'ta 3; (2) başarısız render tekrarı artık iade edilen render kredisini yeniden alır (`retryRenderCredits` = `steps.render.credits`, `rerender_credits` ile tekrar düşerse iade), admin'in "Retry render"ı ücretsiz (`charge:false`), `RetryRender` bandı fiyatı gösterir; (3) stok slotu 1 → **2 kredi** (`STOCK_FALLBACK_SHARE`=0,2 AI görsel yedeği + 2027 Gemini fiyatıyla uygunluk kontrolü; 3 dk stock 227, 10 dk 697), admin Overview "Stock fallbacks" oranı (>%20 uyarı); (4) `recordProviderUsage` hatası Sentry'ye gider + lab `usage-probe` (skeç/talk/swap satırı yazılabiliyor mu); (5) `DATED_PRICES` (usage.ts): Gemini 3.8 Flash 2027-01-01'den $1.50/$7.50; (6) ses klonu yuvaları doluysa hesaba eklenmiş bir kütüphane sesi silinip bir kez daha denenir (`freeLibrarySlot`, klonlar asla silinmez), yine doluysa Sentry uyarısı; (7) sahne klipleri (`scene-*.mp4`, `slot-*.mp4`, avatar) `storeMedia` ile R2'ye. Bilinçli kalanlar: skeç %35 (7 Kasım), yıllık planlar %37–39 (7 Kasım: "1 ay bedava", Paddle fiyatları $209/$539 olmalı). Hesap işleri (Kadir/Yağmur): Vercel Pro, Supabase Pro.
- **Başlangıç kredisi 70, deneme videosu kapalı (6 Kasım, Yağmur)**: `FREE_TRIAL_CREDITS` 50 → 70 (lib/plans.ts); 70 kredi bir 30 sn anlatımlı stok + AI videoya yeter (67, bize ~$0,36), bedava deneme videosu (~$0,85) `TRIAL_VIDEO_ENABLED=false` (trial.ts) ile kapalı, `TRIAL_VIDEO_PUBLIC=false`. `FREE_CREDITS_BUY` tam video herkese açılınca (`NEXT_PUBLIC_FULL_VIDEO_ENABLED`) "one finished 30-second narrated video" der. `/chat`: ödeme yapmamış hesapta (`/api/credits` `freeTrial`) görüntü modu varsayılan **Stock + AI** (taslakta seçim yoksa) + yeşil "Start with a 30-second Stock + AI video" kutusu (`JOB_COSTS.video30Stock`, "Use this setup"); ödeyenlerde varsayılan hibrit. Rakip araştırması (6 Kasım): fiyatlar piyasanın ortası-üstü, zam yapılmadı. Kayıt kredisini veritabanı trigger'ı `handle_new_user_credits()` veriyor — aslında **90** veriyordu (site 50 diyordu); 70 yapan SQL `supabase/README.md` "Sign-up credits".
- **Medya saklama süresi (6 Kasım, Yağmur)**: `lib/retention.ts` `runRetention()` saatlik heartbeat'te (`/api/series/tick`, parti 25): (1) herkes için 30 gün sonra çalışma dosyaları silinir (sahne klip/görsel, harita, arşiv, sunucu sesi; skeçte portre/replik/efekt/çekim görselleri) — `final*.mp4`, kapak ve voiceover kalır; editör/yeniden render/çeviri/Shorts o video için kapanır (`workingFilesRemoved`, 410 + `WORKING_FILES_GONE_MESSAGE`); (2) hiç ödeme yapmamış hesapların (beta/iç hesaplar ödemiş sayılır) bitmiş videoları 7 gün sonra silinir, proje (senaryo, ses, kapak) kalır, proje sayfasında sarı "This video was removed" bandı. İşaret: `steps.retention` / `plan.retention` {working_at, video_at}, proje `content.retention` (server-owned); talk/swap'ta `output_url=null`. Vitrin ve hero videoları hiç silinmez. **`RETENTION_LIVE=true`** (6 Kasım dry run: silinecek dosya yoktu); lab `retention` {dryRun} listeler. Terms §10 + Privacy §6 + plans.ts metinleri güncel.
- **E-posta + depolama (5 Kasım)**: support@norveko.app artık çalışıyor — ImprovMX (ücretsiz, hesap kadirkanbur6@gmail.com) `*@norveko.app` → kadirkanbur6@gmail.com; Vercel DNS'e ImprovMX şablonu (MX mx1/mx2.improvmx.com + SPF `v=spf1 include:spf.improvmx.com ~all`), test maili geldi ✅. Yalnız GELEN posta; support@ adresinden göndermek ImprovMX ücretli plan ister. Ana sayfa altbilgisinde "Contact" + adres (Paddle doğrulaması ister). Supabase Free depolama önceki dönemde 1 GB'ı aştı (finaller R2'ye taşınmadan önce) → 4 Aralık'a kadar ek süre; lab `storage-report` (salt okuma, kova/klasör/tür) ve `cleanup-lab-videos` (yalnız `videos/lab/**.mp4`) eklendi, 67 MB lab klibi silindi → ~556 MB. Supabase SQL (provider_usage fkey + `user_access` + `admin_actions`) ✅ çalıştırıldı; `credit_transactions`'ta tür CHECK'i yok. **Paddle live:** hesap açık, doğrulama "Not started" — Kadir şirket kurulunca yapacak (LEGAL_NAME gerçek unvan olmalı); o zamana kadar lansman kilidi açılmaz.
- Form seçenekleri UI+API ortak: `lib/pipeline/options.ts`.
- Bitince sonuç `projects.content` JSONB'ye yazılır; başlık = AI'nin ilk title'ı.

- **Sağlayıcı billing denetimi (7 Kasım, Yağmur)**: hepsi ön ödemeli/PAYG, otomatik yükleme açık: **fal** (PAYG, bakiye ~$125,
  auto top-up $10 eşik → +$20, $10'da e-posta uyarısı; fal aylık planları API'de indirim vermez → PAYG doğru), **Gemini** (ön ödeme,
  eşik 250 TRY → +1.000 TRY, aylık limit 5.000 TRY), **OpenAI** (eşik $5 → $25'a tamamla, aylık $100 limit; ilk yükleme API
  kullanımında tetiklenecek — 8 Kasım'da bakiyenin yenilendiği kontrol edilecek), **Shotstack** (PAYG $0,20/dk; auto top-up
  <20 dk → +150 dk = $30; hesapta harcama tavanı ayarı YOK → tavanı bankadaki Visa limiti/bildirimi koyar; abonelik ayda ~200 dk
  render'dan sonra mantıklı: Starter $39/250 dk), **Cloudflare R2** (10 GB ücretsiz, ~2,7 GB), **Sentry** Free. Dikkat: Shotstack
  5 GB barındırma kotası render'ları saklar → `deleteRenderAssets()` (shotstack.ts, Serve API) render R2/Supabase'e alınınca
  Shotstack kopyasını siler (`steps.render.provider_deleted`); eski render'lar için lab `shotstack-cleanup` {dryRun, limit}.
  Text klip modu (Kling 3.0 Standard) artık fal üzerinden (`FAL_TEXT_VIDEO_MODEL`, $0,084/sn sessiz); canlıda test edildi
  (30 sn hybrid, 2 klip ✅) ama `OFFERED_CLIP_MODES` hâlâ yalnız `["image"]` → arayüzde/API'de text modu kapalı.

## 4. Feature gate'ler (env)

- `GENERATION_ENABLED=false` → **lansman kilidi**: `BETA_USER_IDS` dışındakiler
  üretim yapamaz, kredi düşmeden 403. UI "launching soon" gösterir.
- `VIDEO_GENERATION_ENABLED=true` veya `VIDEO_BETA_USER_IDS` → Kling klipleri
  (eski "clips-only" seçeneği).
- `FULL_VIDEO_ENABLED=true` veya `FULL_VIDEO_BETA_USER_IDS` → **tam video**
  (özel beta, sadece Kadir).
- Kontrol: `lib/pipeline/features.ts`, UI'a `GET /api/features`.

## 5. Tamamlanan Modüller (Ekim 2026 itibarıyla)

- Auth: e-posta/şifre + zorunlu doğrulama + Google OAuth (yayında), şifre
  sıfırlama (`/forgot-password`, `/reset-password`), doğrulama maili yeniden
  gönderme, her yerde çıkış. `proxy.ts` (eski `middleware.ts`) public sayfa listesi başta.
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
  (sekmeler, tam düzenleme, **Export**: copy all / .md / .txt / .srt / .vtt,
  thumbnail görseli, klip oynatıcı, stilli silme onayı). PATCH içeriği
  `lib/project-content.ts` ile sanitize edilir (`captions` dahil).
- **Otomatik altyazı** (opsiyon, +10 kredi; UI'da voiceover açıkken "Auto
  subtitles" toggle'ı, varsayılan açık): voiceover adımı ElevenLabs'in
  `/with-timestamps` uç noktasını kullanır (aynı fiyat; JSON içinde base64 ses
  + karakter zamanlaması); cue'lar yalnızca eklenti alındıysa üretilir. `lib/pipeline/captions.ts` karakter → kelime → cue (2 satır ×
  38 karakter, ≤5 sn, ≥0.8 sn, 0.6 sn duraklamada kes, cümle sonunda kes;
  `CAPTION_RULES`) ve SRT/VTT render eder. Cue'lar `steps.voiceover.captions`
  ve `projects.content.captions` olarak saklanır (karakter hizalaması
  saklanmaz). Voiceover yoksa export okuma hızından tahmin eder ve menü bunu
  söyler. İleride MP4 render'da burn-in için aynı cue'lar kullanılacak.
- **Tam video (tek cümle → MP4)** — özel beta: `PipelineOptions.fullVideo` +
  `footage` ("hybrid" | "cinematic" | "stills") + `duration` (sadece 30/60 sn,
  `FULL_VIDEO_DURATIONS`). Voiceover + altyazı otomatik dahil. Adımlar: script
  → voiceover → thumbnail → **video (görseller)** → **render**.
  `fullVideoPlan()` zaman çizelgesini ~5 sn'lik **slot**'lara böler (60 sn →
  12; hybrid: her 4. slot Kling, cinematic: hepsi, stills: hiçbiri); plan
  `steps.video.plan` ve `steps.render.plan`'a yazılır, kredi peşin.
  `lib/pipeline/timeline.ts`: `planSlots()` (sahneleri sıralı slotlara
  dağıtır, Kling slotları eşit aralıklı), `buildEdit()` (Shotstack edit JSON:
  **hook kartı** (29 Ekim: `rich-text`, ilk 3 sn, `hookTitle()` ilk cümle ≤7
  kelime, Montserrat ExtraBold 92, kelime kelime slideIn 0,35 sn, ekranın
  üst-ortası `position:center offset.y +0.16`), rich-caption SRT URL'den
  (**alt bant**: `position:bottom offset.y +0.14`, yükseklik %16 — Shotstack'te
  offset.y pozitif = YUKARI). **Büyük harf locale-aware** (29 Ekim): Shotstack
  `textTransform:uppercase` Türkçe İ/ı'yı bozuyordu ("PIRAMIDI") → render
  SRT'si `cuesToSrt(cues,{uppercase:<ISO>})` ile sunucuda büyütülür
  (`captions.ts` `upper()`), hook da aynı; indirilen .srt/.vtt orijinal
  kalır. **Arka plan müziği (29 Ekim):** `lib/pipeline/music.ts` — Kevin
  MacLeod CC BY 4.0 parçaları (incompetech.com; FreePD kapandı, Shotstack
  demo parçaları sınırlı), stile göre mood (Mystery/Horror/Documentary/
  Educational/Cinematic/Ad), `pickMusicTrack(style, jobId)` deterministik;
  runner `ensureMusicCached()` parçayı ilk kullanımda `videos/music/<id>.mp3`
  olarak bucket'a kopyalar; edit'te ayrı audio track `volume 0.13` (≈-18 dB)
  `fadeInFadeOut`; `steps.render.music{title,credit}` ve zorunlu atıf
  `musicCredit()` proje açıklamasının sonuna eklenir. **31 Ekim: katalog yeniden kuruldu** — Kevin MacLeod'un resmî `pieces.json` "feel" etiketlerinden (lab `music-catalog`), 7 ruh hâli: tragic/eerie/tense/mysterious/epic/wonder/upbeat (~38 parça; Humorous/Bouncy/Grooving parçalar ciddi havuzlara girmez — eski listede "Hidden Agenda" (Humorous) gizemdeydi, Dyatlov'a düştü). Senaryo yazarı JSON'da `musicMood` seçer (ölüm varsa tragic/eerie/tense) → `steps.script.music_mood`; `pickMusicTrack(style, jobId, {mood, trackId})`. **Yeniden render** (lab `rerender` {jobId, musicId}): yalnız render adımı tekrar çalışır, `steps.render.music_id/version`, dosya `final-v<n>.mp4`, proje yerinde güncellenir (`refreshProjectVideo`), ücret yok/iade yok. Gemini ile parça dinletme (`music-analyze`) denendi — tutarsız, kullanma. Kling klibi slotu dolduracak şekilde `speed`
  ≥0.5, görsellere Ken Burns `effect`, soundtrack = voiceover, 1080×1920 /
  1920×1080, 30 fps, `range` anlatım süresi). Runner: görseller adımı async —
  ilk çağrıda Kling slotları gönderilir, her poll'da Kling sorgulanır + en
  fazla 2 AI görsel üretilir (`generateSceneImage`, sahne başına bir görsel,
  komşu slotlar paylaşır; fazlası peşinen iade), başarısız Kling slotu iade +
  render'da komşu görselle doldurulur; **Kling klibi 12 dk'da bitmezse**
  (`KLING_CLIP_TIMEOUT_MS`, 29 Ekim) aynı şekilde failed+iade sayılır. Render adımı async: SRT `videos`
  bucket'a yüklenir, Shotstack'e gönderilir (`lib/pipeline/shotstack.ts`),
  poll'da `done` olunca MP4 indirilip `videos/{user}/{job}/final.mp4`'e
  yazılır → `projects.content.finalVideoUrl`. UI: `/chat`'te "Render the full
  video" kartı (footage seçimi + kredi), ilerlemede slot ızgarası + final
  oynatıcı + Download MP4; proje sayfasında "Final video" bölümü.
- **Ses oynatıcı** `app/components/AudioPlayer.tsx`: native `<audio controls>`
  yerine özel oynatıcı — MP3 tarayıcıda Web Audio ile decode edilip gerçek
  dalga formu (96 çubuk) çizilir, tıkla/sürükle ile seek, hız (0.75–2×),
  sessiz, klavye (boşluk/ok). `VoiceoverDownloads.tsx`: "Subtitles" menüsü
  (.srt/.vtt) + "MP3" butonu; hem üretim kartında hem proje sayfasında.
- Billing: Paddle overlay checkout, webhook (`transaction.completed` + refund
  `adjustment.*`, idempotent), ödeme sonrası bakiye yenileme, kredi metinleri
  `steps.ts`'ten.
- Settings: profil, YouTube kanal ID, **şifre değiştir**, **hesap sil**
  (`/api/account`: storage + tablolar + auth user).
- Marka: `BrandMark` (inline SVG N-monogram), `app/icon.png`, OG metadata,
  2.5 sn giriş sonrası intro (`WelcomeIntro`, oturum başına bir kez).
- Ops: `robots.ts`, `sitemap.ts`, `not-found/error/loading.tsx`, security
  header'lar + **CSP enforce modunda** (`next.config.ts`; acil durumda
  Vercel'e `CSP_REPORT_ONLY=true` eklenince report-only'ye döner; dev'de
  `'unsafe-eval'`, Vercel preview'da `vercel.live` otomatik eklenir),
  `/api/health`, snapshot cron tüm bağlı kanallar için, saatlik üretim
  limiti, ESLint 0 hata.
- Gözlemlenebilirlik: **Sentry** (`@sentry/nextjs` v11; `instrumentation.ts`
  + `sentry.server|edge.config.ts` + `instrumentation-client.ts`;
  `app/error.tsx` ve `app/global-error.tsx` yakalar; `next.config.ts`
  `withSentryConfig` ile sarılı, source map yükleme `SENTRY_AUTH_TOKEN/ORG/
  PROJECT` varsa). DSN yoksa SDK tamamen kapalı. Kod `lib/observability.ts`
  (`captureError(err, {jobId, step})`) üzerinden çağırır, SDK'yı doğrudan
  import ETME. **Provider maliyet logu**: `lib/pipeline/usage.ts` → her
  OpenAI/ElevenLabs/Gemini/Kling çağrısı `provider_usage` tablosuna (birim +
  tahmini USD; fiyat listesi `PRICE_LIST`, env `PROVIDER_PRICE_OVERRIDES`).
  Runner `deps.recordUsage` ile yazar (testlerde bellekte). SQL ve sorgular
  `supabase/README.md`'de.
- Erişilebilirlik: global `:focus-visible` halkası (globals.css, `:where()`
  ile düşük özgüllük), "Skip to main content" linki (`app/layout.tsx` →
  her sayfada `id="main-content"`), ikon butonlarda aria-label, dialog/menu
  rolleri, `text-gray-600` kaldırıldı (kontrast).

### Seslendirme motoru (31 Ekim: Gemini Pro TTS varsayılan)
- Model lab'da (`/lab`, sadece beta) karşılaştırıldı; Kadir **Gemini Pro TTS**'i
  seçti. `lib/pipeline/gemini-tts.ts`: `gemini-2.5-pro-preview-tts` (env
  `GEMINI_TTS_MODEL` ile değişir), 24 kHz PCM → **WAV**; 16 seçilmiş ses
  (`GEMINI_VOICES`, Charon ilk). Ses kimliği `gemini:<Ad>` → `lib/pipeline/tts.ts`
  `synthesizeNarration()` yönlendirir (Gemini veya ElevenLabs). Gemini zaman
  vermez → altyazı için **ElevenLabs forced alignment** (`forceAlign()`,
  `/v1/forced-alignment`, karakter zamanları aynı formatta); başarısız olursa
  ses yine kullanılır. Süre düzeltmesindeki hız → Gemini'de "slightly faster/
  slower" talimatı. Maliyet ~$0.03/60 sn (Pro, $20/1M ses tokenı). Ses seçicide
  Gemini sesleri en üstte (`/api/voices` `gemini[]`), önizleme
  `/api/voices/preview` ilk istekte üretip `videos/previews/gemini/` altında
  önbelleğe alır. ElevenLabs sesleri seçenek olarak duruyor.
- **Model lab** (`app/lab`, `app/api/lab`, `lib/lab/providers.ts`): görsel
  (Gemini/Imagen/GPT Image/fal), TTS (ElevenLabs modelleri/Gemini), video
  (Kling/Gemini Omni Interactions API/fal MiniMax) yan yana; Google model
  listesi butonu. Görsel karşılaştırmasında Nano Banana 2.1 ($0.034) ≈ mevcut
  kalite → **sahne görselleri Nano Banana 2.1'e geçti** (`GEMINI_SCENE_IMAGE_MODEL`,
  thumbnail hâlâ 3.1 Flash Image). Veo 3.x Gemini API'de kapandı →
  `gemini-omni-1.1-flash` (Interactions API, `POST /v1beta/interactions`
  `background:true`, poll `GET /interactions/{id}`, video base64 `steps[]`
  içinde; 720p $0.10/sn, 10 sn klip). fal `FAL_KEY` ✅ (31 Ekim); MiniMax H3
  fal uç noktaları `minimax/h3-max(-turbo)/image-to-video` (fal-ai/ öneki
  YOK), `prompt_expansion_mode` zorunlu; testte hareket çok az kaldı.
- **Klip türü seçeneği (31 Ekim, Kadir: "seçeneklerde olsun")**: tam videoda
  `PipelineOptions.clipMode` = `"image"` (varsayılan) | `"text"`. **image →**
  slot için önce Nano Banana 2.1 görseli, sonra **Seedance 1.5 Pro** (fal,
  `lib/pipeline/fal-video.ts`, `FAL_VIDEO_MODEL`, sessiz 720p 5 sn ≈ $0.13)
  görseli canlandırır; `IMAGE_CLIP_CREDITS = 50`/klip. **text →** Kling 3.0
  (130/klip, eski akış). Plan `steps.video.plan.clipMode/clipCredits`'i
  tutar; iade/tüketim bu sayıyı kullanır; eski planlar `text` sayılır.
  Runner: image modunda klip slotları poll sırasında (görsel bütçesinden,
  önce klipler) görsel → `submitImageToVideo` → `slot.fal` handle; klip başarısız
  olursa `slot.imageUrl` render'da Ken Burns görsel olarak kullanılır ve klip
  kredisi bir kez iade edilir (`slot.refunded`). Seedance testleri: 2.0 Mini en
  detaylı ama $0.77/5 sn; 1.0 Pro Fast $0.11; 2.5 $2.37/5 sn. UI: `/chat`
  footage kartlarının altında "How AI clips are made" (Image → video / Text →
  video, klip başına kredi).

### ElevenLabs sesleri (önemli)
- `lib/pipeline/elevenlabs.ts`: `listVoices()` (hesap sesleri, `languages`
  = labels.language ∪ verified_languages), `listLibraryVoices(code)`
  (Voice Library), `addLibraryVoice()` (seçilince hesaba ekler; `/api/pipeline/
  start` kredi düşmeden önce çağırır), `getSubscriptionTier()`.
- **ElevenLabs hesabı Free plan** (anahtar `norveko-dev`, Voices izni Write
  yapıldı). Free planda kütüphane sesleri API'den kullanılamaz (402
  paid_plan_required) → `/api/voices` tier "free" ise ya da tier bilinmiyor ve
  `ELEVENLABS_LIBRARY_VOICES` != "true" ise Library seslerini **gizler**;
  daha önce hesaba eklenmiş kütüphane kökenli sesler de (`category !=
  "premade"`) aynı koşulda gizlenir ve `/api/pipeline/start` bunları kredi
  düşmeden önce 400 ile reddeder (25 Ekim: `fXhoW006…` sesi iki işi 402 ile
  düşürmüştü).
  Starter'a geçince Vercel'e `ELEVENLABS_LIBRARY_VOICES=true` ekle (veya
  anahtara User→Access izni ver, otomatik algılar). **31 Ekim: Kadir Starter'a geçti.** Kütüphane artık İngilizce dahil her dilde sorgulanır (30 ses, anlatım use_case'leri önce); `/chat` seçicisi gruplu: "Norveko narrators · speak every language" (Gemini, 29 dilin hepsi destekli) + "Native {dil} voice artists" (kütüphane + o dile etiketli hesap sesleri, "Native" rozeti).
- Stok B-roll: Pexels yeni anahtar vermiyor → **Pixabay** eklendi
  (`PIXABAY_API_KEY` Vercel'de, `lib/pipeline/pexels.ts` iki sağlayıcıyı da
  destekler).

### Dış kurulum durumu (25 Ekim akşamı)
- Supabase: `pipeline_jobs.options` kolonu ✅, `videos` bucket ✅.
- Vercel env: `GENERATION_ENABLED=false`, `BETA_USER_IDS=92779a9c-cb1c-47a8-
  bcc8-e07f4de6dc56` (Kadir), `NEXT_PUBLIC_SITE_URL`, `PIPELINE_WORKER_SECRET`,
  `PIXABAY_API_KEY`, `YOUTUBE_API_KEY` (Production) ✅ — lansman kilidi canlıda,
  zincir uçtan uca test edildi. CSP enforce canlıda doğrulandı (ses önizleme +
  Paddle overlay, konsolda ihlal yok).
- Gözlemlenebilirlik kurulumu (25 Ekim gece) ✅: Supabase'de `provider_usage`
  tablosu + indeksler + RLS oluşturuldu. Sentry org `norvekoapp`, proje
  `norveko` (Next.js, EU ingest `ingest.de.sentry.io`). Vercel Production:
  `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
  (org token `vercel-source-maps`). Canlıda tarayıcı SDK'dan test olayı
  gönderildi, Sentry'de NORVEKO-1 olarak düştü ve resolve edildi.

## 6. Teknik Kurallar / Kalıplar

- Route handler'larda auth: `const { supabase, user } = await requireUser()`
  (`lib/supabase-server.ts`; `getUser()` kullanır, `getSession()` KULLANMA).
- Kredi düşme/iade SADECE server-side, service role ile (`deduct_credits` /
  `add_credits` RPC). `add_credits` negatif tutara izin vermeli (Paddle iadesi).
  `pipeline_jobs.credits_refunded` DB'de **0** varsayılanlı (NULL değil);
  `failJob` guard'ı `is.null OR eq.0` kullanır — 25 Ekim'e kadar sadece IS NULL
  bakıldığı için başarısız işler "running"de takılıp iade almıyordu. Testler
  artık 0 ile seed eder. **Kısmi iade (29 Ekim):** `failJob` yalnızca
  tamamlanmamış adımların kredisini iade eder (`consumedCredits()`: biten
  adımlar + başarılı Kling/görsel slotları ödenmiş sayılır; `steps.video.refunded`
  daha önce slot bazında iade edileni tutar) ve senaryo bittiyse üretilenleri
  `saveProject()` ile proje olarak kaydeder (`steps.result.status="partial"`);
  UI "Open the partial project" linki + iade miktarını gösterir.
- **Fake/hardcoded veri yasak**; her metrik gerçek kaynaktan gelir.
- Next.js route params: `Promise<{ id: string }>` — `await` edilir.
- Provider lib'leri (`lib/pipeline/openai|elevenlabs|gemini-image|kling.ts`)
  server-only; env yoksa import anında throw eder → runner lazy import kullanır.
- Yeni özellik eklerken: tsc + `npm run lint` + `npm run test:pipeline` temiz
  olmalı; UI metinleri İngilizce.

## 7. Bekleyen İşler (öncelik sırasıyla)

**Ödemeler yakında modu (9 Kasım):** `lib/payments.ts` `PAYMENTS_LIVE` (= `NEXT_PUBLIC_PAYMENTS_LIVE=true` veya `NEXT_PUBLIC_PADDLE_ENV=production`). Kapalıyken admin dışında Buy/Subscribe "Opening soon" + `PaymentsSoonCard` bekleme listesi (`POST /api/waitlist`, tablo `plan_waitlist` ✅ Supabase'de oluşturuldu, admin Users kartında sayı). Paddle live açılınca env'i production yap → mod kendiliğinden kapanır. Supabase Site URL `https://norveko.app` ✅ + redirect `https://norveko.app/**` ✅; `FULL_VIDEO_ENABLED`/`NEXT_PUBLIC_FULL_VIDEO_ENABLED=true` ✅ (redeploy yapıldı). `GENERATION_ENABLED` kilidi hâlâ açık (lansmanda kaldırılacak).

**LANSMAN KONTROL LİSTESİ (8 Kasım denetimi, Yağmur "yarın lansman"):**
1. **Paddle canlıda SANDBOX** (`NEXT_PUBLIC_PADDLE_ENV`, `Paddle.Environment.get()` = sandbox; Kadir'in hesabında sahte "Pro yearly" abonelik var). Gerçek ödeme için Paddle live doğrulaması (şirket/LEGAL_NAME) + canlı ürün/fiyatlar + Vercel'de `NEXT_PUBLIC_PADDLE_ENV=production`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` (canlı) ve **`NEXT_PUBLIC_PADDLE_PRICE_*` 9 fiyat id'si** (yoksa kod sandbox id'lerine düşer → canlı checkout açılmaz) + webhook URL. Olmadan: kayıt + 70 ücretsiz kredi çalışır, satın alma çalışmaz.
2. **Supabase e-posta limiti 2/saat** (yerleşik SMTP; Auth → Emails → SMTP Settings kapalı). 3. kayıttan itibaren doğrulama maili gitmez. Çözüm: Resend (ücretsiz 3k/ay) → Vercel DNS'e Resend DKIM/SPF (ImprovMX SPF'i ile birleştir: `v=spf1 include:spf.improvmx.com include:amazonses.com ~all`), Supabase Custom SMTP aç, Rate Limits → emails/h 100+.
3. **Supabase Auth Site URL `http://localhost:3000`** → `https://norveko.app`; Redirect URLs'e `https://norveko.app/**` ekle (`?next=` taşıyan callback'ler için). (Claude değiştiremedi: paylaşılan kaynak izni.)
4. **Feature gate'ler**: Vercel'de `GENERATION_ENABLED` (lansman kilidi) kaldır/`true`; `FULL_VIDEO_ENABLED=true` + `NEXT_PUBLIC_FULL_VIDEO_ENABLED=true` (yoksa landing MP4 vaat eder ama halk yalnız içerik paketi alır; /chat "Private beta" rozeti de bu env ile gizlenir) → redeploy.
5. Vercel'den artık gereksiz env'ler: `GOOGLE_OAUTH_CLIENT_ID/SECRET`, `TIKTOK_CLIENT_KEY/SECRET`, `YOUTUBE_TOKEN_KEY` (yoksa zaten yok).
6. ✅ Kontrol edildi: kayıt kredisi trigger'ı 70; pg_cron heartbeat (dakikalık) ve series-tick (saatlik) son çalışma başarılı; tsc/lint/66 test temiz; Google GIS girişi canlı; 3 bağlantı tablosu silindi.

**Lansmandan önce:** ~~YouTube/TikTok/Instagram "yayınla" metinleri~~ (8 Kasım: özellik kaldırıldı, metinler "hazır MP4" oldu). "Why Norveko" artık yalnız bizde olanı listeler (`WHY_NORVEKO` plans.ts; eski "Typical AI tool" sütunu kaldırıldı). Rakip isimli karşılaştırma yalnız ayrı "vs" sayfalarında, rakibin kendi fiyat sayfası + kaynak + kontrol tarihiyle.

Kod dışı (Kadir): ~~TikTok demo videosu / Google doğrulaması / YouTube API audit~~ (8 Kasım: yayın özelliği kaldırıldı, gerek kalmadı; Supabase tabloları + Vercel env + Google/TikTok uygulamaları kapatılacak). Paddle live, Vercel/Supabase Pro.
**tam video betası için Vercel env**: `SHOTSTACK_API_KEY`
+ `SHOTSTACK_ENV=stage` (test; `v1` = filigransız prod, PAYG $10),
~~`KLING_API_KEY`~~ ✅ 28 Ekim: Vercel'de (`norveko-prod`, deneme paketi 100
unit/30 gün). **Kling yeni platform API'si** (`lib/pipeline/kling.ts`): `POST
/text-to-video/kling-3.0` + `settings{resolution:"720p", aspect_ratio,
duration:int, audio:"off"}`, sorgu `GET /tasks?task_ids=`, durum
`succeeded` → runner'ın beklediği `succeed`'e çevrilir; eski `kling-v2-1`
"model is not supported" veriyor. Shotstack production (`v1`) ✅.
`FULL_VIDEO_BETA_USER_IDS=92779a9c-cb1c-47a8-bcc8-e07f4de6dc56`; `app/lib/legal.ts`
`LEGAL_NAME` placeholder'ı (şirket kurulunca); Paddle live ID'leri + webhook
event'leri (`adjustment.*`); ElevenLabs Starter planı (kütüphane sesleri için).
(`YOUTUBE_API_KEY` yeniden adlandırması 25 Ekim'de Vercel'de yapıldı; eski
`NEXT_PUBLIC_` değişkeni silindi — `app/lib/youtube.ts` fallback'i artık
sadece yerel .env için.)

Ürün (rakip analizine göre): ~~otomatik altyazı~~ → ~~tam MP4 render~~
(özel beta, canlı test bekliyor) → ~~9:16/16:9 seçimi~~ → ~~niş şablonları + örnek
galeri~~ (29 Ekim: landing `#examples` gerçek render'lar `lib/showcase.ts`
— Supabase `videos`/`thumbnails` bucket yolları, URL `NEXT_PUBLIC_SUPABASE_URL`'den;
`#templates` kartları `/chat?template=<id>`; fiyat kartlarında "≈ X paket /
X video" satırı `steps.ts`'ten hesaplanır. **Paket kredileri/fiyatları 29
Ekim'de gözden geçirildi, Kadir "şimdilik değiştirme" dedi** — Starter 500 ile
yalnızca 1×30 sn video çıkıyor; ileride tekrar bakılacak) →
~~YouTube'a doğrudan yükleme~~ + ~~TikTok~~ (8 Kasım'da kaldırıldı) → ~~seri modu/zamanlama~~ → ~~brand kit~~ → ~~ses klonlama~~ →
~~affiliate~~ (kredi bazlı davet). Ertelenen: timeline editör, AI avatar, mobil app.

Teknik borç: ~~sahne düzeyinde yeniden üretim + versiyon geçmişi~~ (31 Ekim: editörde sahne başına "Earlier pictures" `slot.editHistory` ≤8, `original` işareti, `restoreScene`; render sürümleri `steps.render.history` (queueRerender her yeniden render'da eskiyi saklar, filigranlı sürüm temiz videoya geri getirilmez), `useVersion` ücretsiz) +
`media_assets`/`projects.job_id` şeması; Supabase custom domain (Google
ekranındaki supabase.co yazısı için).

## 8. Çalışma Şekli (Kadir + Claude)

- Claude ana geliştiricidir; repo üzerinde doğrudan commit + push yapar
  (GitHub bağlı). Her görev kısa planla başlar, değişen dosyaların özeti ve
  sonraki adımla biter.
- Sadece ilgili dosyalara dokunulur; mevcut bileşenler yeniden kullanılır.
- Kadir beginner-intermediate seviyededir: adım adım, Türkçe açıklama.
