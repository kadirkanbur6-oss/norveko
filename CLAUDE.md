# CLAUDE.md — Norveko Project Context

> Bu dosya, yeni bir Claude oturumu başladığında proje bağlamını geri yüklemek içindir.
> Her büyük milestone sonrası güncellenmelidir. Son güncelleme: 2026-10-25 (gece)

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

### Fiyatlandırma mantığı (31 Ekim 2026, hedef **%60 brüt kâr** — Kadir)
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
Sabit aylık giderler (lansmanda): Vercel Pro $20, Supabase Pro $25, ElevenLabs
Starter $5, alan adı ~$1 → ~$51/ay ≈ ayda ~7.700 kredi (≈1,5 Business paketi)
satışla başa baş. Paket fiyatları (Paddle) değişmedi: Starter 500/$9, Pro 2000/$29,
Business 5000/$59.
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
- Form seçenekleri UI+API ortak: `lib/pipeline/options.ts`.
- Bitince sonuç `projects.content` JSONB'ye yazılır; başlık = AI'nin ilk title'ı.

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

Kod dışı (Kadir): **tam video betası için Vercel env**: `SHOTSTACK_API_KEY`
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
YouTube'a doğrudan yükleme → seri modu/zamanlama → ses klonlama + brand kit →
affiliate. Ertelenen: timeline editör, AI avatar, mobil app.

Teknik borç: sahne düzeyinde yeniden üretim + versiyon geçmişi +
`media_assets`/`projects.job_id` şeması; Supabase custom domain (Google
ekranındaki supabase.co yazısı için).

## 8. Çalışma Şekli (Kadir + Claude)

- Claude ana geliştiricidir; repo üzerinde doğrudan commit + push yapar
  (GitHub bağlı). Her görev kısa planla başlar, değişen dosyaların özeti ve
  sonraki adımla biter.
- Sadece ilgili dosyalara dokunulur; mevcut bileşenler yeniden kullanılır.
- Kadir beginner-intermediate seviyededir: adım adım, Türkçe açıklama.
