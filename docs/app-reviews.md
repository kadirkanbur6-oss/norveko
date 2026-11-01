# Lansman incelemeleri — TikTok, Google/YouTube, Paddle

Bu dosya Kadir'in (kod dışı) yapacağı başvuruların adım adım rehberidir.
Formlara yapıştırılacak metinler İngilizcedir; açıklamalar Türkçe.
Son güncelleme: 31 Ekim 2026.

---

## 0. Ortak hazırlık (bir kez)

- [ ] **Demo hesabı:** norveko.app'te paket almış (filigransız) bir hesapla, en az bir tam
      videosu olan bir proje hazır olsun. Kendi hesabın uygun.
- [ ] **Ekran kaydı:** macOS'ta `Cmd+Shift+5` → "Tüm ekranı kaydet". Tarayıcı penceresi tam ekran,
      dil İngilizce (Google izin ekranı İngilizce olmalı), zoom %100, gereksiz sekmeler kapalı.
- [ ] Videoları **YouTube'a "Liste dışı" (Unlisted)** yükle, linklerini formlara koyacaksın.
- [ ] Gizlilik politikası `https://norveko.app/privacy`, şartlar `https://norveko.app/terms`
      açılıyor mu, kontrol et (açılıyor).

---

## 1. TikTok — Production incelemesi

**Neden:** İnceleme geçmeden Norveko yalnızca gizli hesaplara "Only me" olarak paylaşabiliyor.

### 1.1 Portal ayarları (developers.tiktok.com → Norveko → Production)
- [ ] **Products:** Login Kit + Content Posting API (**Direct Post** açık). Başka ürün ekleme.
- [ ] **Scopes:** yalnız `user.info.basic` ve `video.publish` (fazlası red sebebi).
- [ ] **Redirect URI:** `https://norveko.app/api/tiktok/callback`
- [ ] **URL properties → URL prefix doğrula:** `https://norveko.app/` (videolar TikTok'a
      `https://norveko.app/media/videos/…` adresinden çekiliyor — PULL_FROM_URL). Doğrulama
      dosyası zaten `public/` içinde; gerekirse yeni dosya adını bana söyle, eklerim.
- [ ] **App icon:** `public/brand/norveko-icon-1024.png`
- [ ] **Terms / Privacy URL:** `https://norveko.app/terms`, `https://norveko.app/privacy`
- [ ] **Category:** Productivity / Content creation

### 1.1b Durum (31 Ekim akşam) — SONRA YAPILACAK
- ✅ App icon yüklendi (Kadir). URL prefix `https://norveko.app/` Production'da doğrulanmış.
- ⏳ **Demo video henüz çekilmedi.** TikTok, demo video yüklenmeden Production formunu KAYDETMİYOR; bu yüzden
  aşağıdaki alanlar video yüklenirken aynı oturumda yeniden girilmeli (Claude doldurur):
  - Category: **Photo & Video**
  - Description: `AI video studio: turn one idea into a finished short video and post it to your own TikTok account.`
  - Terms: `https://norveko.app/terms` · Privacy: `https://norveko.app/privacy`
  - Platforms: **Web** → Web/Desktop URL `https://norveko.app/` (sondaki `/` şart, doğrulanmış önekle aynı olmalı)
  - App review açıklaması: aşağıdaki 1.3 "video.publish" + "user.info.basic" metinlerinin birleşimi (≤1000 kr)
  - Products: **Login Kit** (Redirect URI `https://norveko.app/api/tiktok/callback`) + **Content Posting API**
    (**Direct Post** açık; Verify domains = zaten doğrulanmış önek)
  - Scopes: `user.info.basic`, `video.publish` (`video.upload` otomatik geliyor, silinemiyor)
- Çekim öncesi: Redkalien TikTok hesabını **gizliye** al (Sandbox yalnız gizli hesaba paylaşır), çekimden sonra
  tekrar herkese açık yap.

### 1.2 Demo video çekim senaryosu (Sandbox anahtarlarıyla, ~2 dk)
TikTok, yetkilendirme adımı olmayan veya "tek tıkla paylaş" gösteren demoları reddediyor.
Ekranda İngilizce kısa açıklamalar (veya sesli anlatım) olsun.

| # | Ekranda ne var | Söylenecek / yazılacak |
|---|---|---|
| 1 | `norveko.app` ana sayfa → giriş | "Norveko turns one idea into a finished short video." |
| 2 | Settings → **Connect TikTok** → TikTok izin ekranı → izin ver → Settings'e dönüş, hesap adı görünüyor | "The creator connects their own TikTok account with Login Kit (user.info.basic, video.publish)." |
| 3 | Projects → tam videosu olan proje → Final video oynat | "This is the creator's finished video." |
| 4 | **Post to TikTok → Post**: hesap adı + avatar, video önizlemesi, düzenlenebilir caption | "We show which account will receive the post and a preview." |
| 5 | "Who can view this video" açılır listesi **boş başlıyor**, seçenekleri göster, birini seç | "Privacy options come from creator_info; there is no default." |
| 6 | Allow comments / Duet / Stitch **kapalı başlıyor**; hesapta kapalı olan gri | "Interactions are off by default and greyed out when disabled in the account." |
| 7 | **Disclose video content** aç → Your brand / Branded content seç → etiket metni; Branded seçiliyken "Only me" pasif | "Commercial content disclosure follows the sharing guidelines." |
| 8 | Music Usage Confirmation onay kutusu → **Post to TikTok** | "The creator explicitly consents before anything is sent." |
| 9 | "Sent to TikTok… may take a few minutes" → **Check status** → "Posted to TikTok" | "We poll the publish status." |
| 10 | TikTok uygulamasında/web'de videonun profilde göründüğü an | "The post appears on the creator's profile, labelled AI-generated." |

> Sandbox'ta hesap gizli olmalı ve görünürlük "Only me" seçilebilir; bu demo için yeterli.

### 1.3 Form metinleri (kopyala-yapıştır)

**App description**
```
Norveko is an AI video studio for faceless YouTube and TikTok creators. A creator types one idea;
Norveko researches it, writes the script, generates the voiceover, visuals and subtitles, and
renders a finished vertical video. Creators can then post the finished video to their own TikTok
account from the project page.
```

**user.info.basic — how is it used?**
```
After the creator connects TikTok, we show their display name and avatar in Norveko (Settings and
the "Post to TikTok" composer) so they always know which TikTok account will receive the post.
We store only the open_id, display name and avatar URL.
```

**video.publish — how is it used?**
```
When the creator clicks "Post to TikTok" on a finished project, we call creator_info to show their
nickname, the privacy options and interaction settings, show a preview, let them edit the caption,
choose visibility (no default), set comments/duet/stitch (off by default), disclose commercial
content, and agree to the Music Usage Confirmation. Only after this explicit action do we call
the Direct Post API (PULL_FROM_URL from our verified domain norveko.app) and poll the publish
status. Posts are marked is_aigc=true. We never post without the creator's action and never add
watermarks or branding to the creator's video.
```

---

## 2. Google — OAuth doğrulaması (YouTube kapsamları)

> **31 Ekim akşam değişikliği:** YouTube yükleme artık AYRI bir Google Cloud projesinde: **Norveko Publishing**
> (`norveko-publishing`). Sebep: eski "Norveko" projesinin onaylı alan adlarında Supabase girişi için
> `zpvtekjjsdjtbvidrgay.supabase.co` var; Google doğrulaması her alan adının sahipliğini ister, supabase.co
> kanıtlanamaz. Yeni projede yalnız `norveko.app` var. Kurulu: YouTube Data API v3 etkin, Branding (ad, e-posta,
> site/gizlilik/şartlar linkleri, alan `norveko.app`), Data access (`youtube.upload`, `youtube.readonly`),
> Audience External + **In production**, Web istemcisi **"Norveko Web"** (yönlendirme
> `https://norveko.app/api/youtube/callback`). Vercel'de `GOOGLE_OAUTH_CLIENT_ID/SECRET` bu istemcinin değerleri
> olmalı; değişince YouTube Ayarlar'dan yeniden bağlanır. Eski projedeki "Norveko Web" istemcisi artık kullanılmıyor
> (Supabase Google girişi eski projede kalır, doğrulama gerektirmez). Logo isteğe bağlı (yüklenirse marka da
> doğrulanır).

**Neden:** Doğrulanmamış uygulamada 100 kullanıcı sınırı + "Google hasn't verified this app" uyarısı.

### 2.1 Ön koşullar (console.cloud.google.com → Google Auth Platform)
- [ ] **Branding:** uygulama adı "Norveko", logo (`public/brand/norveko-icon-1024.png` 120×120'e
      küçültülmüş), destek e-postası, **Application home page** `https://norveko.app`,
      **Privacy policy** `https://norveko.app/privacy`, **Terms** `https://norveko.app/terms`.
- [ ] **Authorized domains:** `norveko.app` (Search Console'da aynı Google hesabıyla doğrulanmış olmalı:
      search.google.com/search-console → Alan → DNS TXT kaydı Vercel'de).
- [ ] **Data access:** yalnız `youtube.upload` ve `youtube.readonly`.
- [ ] Ana sayfada gizlilik politikası linki görünür (footer'da var).

### 2.2 Demo video (YouTube'a liste dışı, ~2 dk) — Google'ın istedikleri
1. Tarayıcı adres çubuğu görünür olsun.
2. `norveko.app` → giriş → Settings → **Connect YouTube**.
3. **Google izin ekranı İngilizce** (sol alttaki dil seçici) ve **adres çubuğundaki URL'de
   `client_id=` görünsün** (ekranı kısa süre durdur / büyüt).
4. İki kutuyu da işaretle, izin ver → Settings'te kanal adı görünüyor (*youtube.readonly*: kanal adı ve
   avatarını göstermek için).
5. Projects → bir proje → **Upload to YouTube**: başlık/açıklama/etiket, görünürlük, zamanlama →
   yükle → "Open on YouTube" → YouTube Studio'da video (*youtube.upload*).
6. Settings → **Disconnect** (erişim geri alınıyor).

### 2.3 Kapsam gerekçeleri (form)

**youtube.upload**
```
Norveko generates a finished short video for the creator. When the creator clicks "Upload to
YouTube" on a project, we upload that video to the creator's own channel with the title,
description, tags, visibility and optional publish time they chose (videos.insert), and set the
generated thumbnail (thumbnails.set). We never upload without the creator's action (or a series
schedule the creator set up), and we mark uploads as containing synthetic media.
```

**youtube.readonly**
```
Used only to read the connected channel's id, title and avatar (channels.list mine=true) so the
creator sees which channel will receive uploads. We do not read videos, comments or analytics with
this scope.
```

**Why can't a narrower scope work?** `youtube.upload` does not return the channel identity;
`youtube.readonly` is the narrowest scope that does.

---

## 3. YouTube API Services — denetim (audit) formu

**Neden:** Denetlenmemiş API projesinden yüklenen videolar **private'a kilitlenir**. Herkese açık
yükleme için bu form şart.

- Form: <https://support.google.com/youtube/contact/yt_api_form> → "YouTube API Services – Audit and
  Quota Extension".
- Kullanım: "Uploading videos created by the user to their own channel". Kota artışı gerekmez
  (yükleme ~100 birim), sadece **audit** iste.
- Hazır olanlar (formda soruluyor):
  - Gizlilik politikası Google Privacy Policy'ye ve YouTube ToS'a link veriyor (`/privacy` 4.1) ✅
  - Yükleme ekranında "By uploading, you agree to the YouTube Terms of Service" ✅
  - Erişimi geri alma: Settings → Disconnect + Google izinleri linki ✅
  - YouTube verisi saklanmıyor (yalnız kanal id/ad/avatar, şifreli refresh token) ✅
- 2.2'deki demo videoyu ve ekran görüntülerini (Upload formu, Settings kartı) ekle.

---

## 4. Paddle — canlıya geçiş

- [ ] Paddle **Live** hesabında doğrulama (kimlik + web sitesi) onaylı.
- [ ] Live'da 3 ürün/fiyat: Starter 500 kredi $9 · Pro 2000 kredi $29 · Business 5000 kredi $59 (sandbox'takiyle aynı).
- [ ] Vercel env (Production): `NEXT_PUBLIC_PADDLE_ENV=production`, `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` (live), `NEXT_PUBLIC_PADDLE_PRICE_STARTER/PRO/BUSINESS` (live), `PADDLE_API_KEY` (live),
      `PADDLE_WEBHOOK_SECRET` (live). Değişken adları `.env.example`'da.
- [ ] Live **Notification destination:** `https://norveko.app/api/webhooks/paddle`, olaylar
      `transaction.completed`, `adjustment.created`, `adjustment.updated`.
- [ ] **Live API anahtarı** (`PADDLE_API_KEY`): Paddle API anahtarlarının süresi doluyor (sandbox'taki 1 Kasım'da
      doldu, "Manage plan" çalışmadı). Live anahtarda izinler: Customer portal sessions W, Customers W,
      Subscriptions W, Transactions W, Adjustments R, Prices R, Products R; bitiş tarihini takvime yaz.
- [ ] Live'da abonelik ürünleri: "Norveko Creator plan" ($6/hafta, $19/ay, $190/yıl) ve "Norveko Pro plan"
      ($15/hafta, $49/ay, $490/yıl), max adet 1 → id'leri Vercel `NEXT_PUBLIC_PADDLE_PRICE_{CREATOR,PRO}_{WEEK,MONTH,YEAR}`.
- [ ] Bildirim hedefine `subscription.*` (created/updated/activated/canceled/paused/resumed/past_due) da eklenecek.
- [ ] Gerçek kartla $9'lık Starter al → kredi eklendi mi, filigran kalktı mı → Paddle'dan iade et →
      kredi geri düştü mü.

> Env değerlerini sen gir; ben ekranı açıp hangi alana ne gireceğini gösteririm.

## 5. Lansman anahtarları (en son)

1. Vercel Pro + Supabase Pro'ya geç.
2. Vercel env: `GENERATION_ENABLED=true`, `FULL_VIDEO_ENABLED=true`,
   `NEXT_PUBLIC_FULL_VIDEO_ENABLED=true`, TikTok **Production** anahtarları
   (`TIKTOK_CLIENT_KEY/SECRET`).
3. Redeploy → gizli pencerede yeni hesap → ücretsiz deneme videosu üret → uçtan uca kontrol.

## 6. (İsteğe bağlı) Supabase custom domain

Google giriş ekranında "…supabase.co'ya devam et" yazısı yerine `auth.norveko.app` görünür.
- Supabase **Pro** + **Custom Domain eklentisi** (~$10/ay) gerekir.
- Supabase → Project Settings → Custom Domains → `auth.norveko.app` → verilen CNAME + TXT kayıtlarını
  Vercel DNS'e ekle → doğrula → aktive et.
- Sonra bana haber ver: `NEXT_PUBLIC_SUPABASE_URL`'i yeni alana çevirip Google OAuth istemcisindeki
  yönlendirme adreslerini ve `next.config.ts` görsel/medya ayarlarını güncelleyeceğim.
