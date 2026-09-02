# Verify chat-message-drop — two proof tests (Test A / Test B)

## Goal

TUI'de yazılan mesaj bazen chat'e düşmüyor / modele gönderilmiyor / streaming başlamıyor.
Mesaj DB'ye **persist** oluyor (kapatıp açınca görünüyor) ama **o an** modele gitmiyor, chat ekranı
bazen boş kalıyor. Bu iki ayrı hipotezi **bağımsız, deterministik testlerle kanıtlamak** istiyoruz.

Testler bir bugfix DEĞİL — **mevcut kod davranışını KANITLAYAN** karakterizasyon/regresyon testleridir.
Mevcut kodda **GEÇMELİLER** (çünkü bug mevcuttur). Hipotez doğruysa test kırmızıdan yeşile bir bugfix
için regresyon kanıtı olur; hipotez yanlışsa test gerçek davranışı ortaya koyar.

İki test ayrı dosyada (veya tek dosyada iki `describe`) — plan iki ayrı dosya önerir.

---

## Steps

### Step 1 — Test A dosyası: `busy` iken `ensureRunning` yeni prompt'u düşürdüğünü kanıtla

**Dosya:** `packages/opencode/test/session/prompt-rejects-busy.test.ts`

**Test adı (behavioral):**
`"busy olduğunda yeni prompt persist edilir ama loop çalışmaz (modele gitmez)"`

**Hedeflenen bug (doğrulanmış kaynaklar):**
- `SessionPrompt.prompt` (`src/session/prompt.ts:191-213`): `createUserMessage` persist + event
  fırlatır (satır 195), sonra `input.noReply === true` değilse `loop({sessionID})` → `state.ensureRunning`
  → `Runner.ensureRunning` → `runLoop` (satır 211).
- `Runner.ensureRunning` (`src/effect/runner.ts:115-138`): state `"Running"` iken **yeni `work`'ü
  TAMAMEN YOK SAYAR** — sadece mevcut run'ın `done` Deferred'ına await eder, geçilen `work` (yani yeni
  `runLoop`) **asla start edilmez** (satır 120-122). Yalnızca `"Idle"` durumunda `startRun(work)` çalışır.
- `SessionRunState.ensureRunning` (`src/session/run-state.ts:87-93`): per-session `Runner` üzerinde
  `ensureRunning(work)` çağırır; arada geçen `work` `runLoop`'tur.
- Yani: prompt eklenir, kullanıcı mesajı DB'ye yazılır (persist), ama runner hâlâ bir önceki run'ı
  çalıştırıyorsa yeni mesaj modele GİTMEZ. Bu, kullanıcının "mesaj DB'de var ama modele gitmiyor"
  semptomuyla birebir örtüşür.
- TUI input'u kilitlemez: `routes/session/index.tsx:182` `disabled` yalnızca pending
  permission/question varken `true` — busy loop'ken input serbesttir.

**Setup (layer'lar / stub'lar):**
- Kalıbı `test/effect/runner.test.ts`'den al (Runner'ın `Running` durumunu deterministik şekilde
  kurma). `it.live` kullan (gerçek zaman/sleep ister).
- Prompt katmanını gerçek (`SessionPrompt`) tutup **LLM/loop tarafını stub** etmenin en temiz yolu,
  `test/v2/session.test.ts`'deki `stubPromptLayer` desenine benzer bir stub `SessionPrompt.loop`
  katmanı kurmak VE real `Runner`/`SessionRunState`'i path'e almaktır. Ancak bug `runner.ts` ile
  `prompt.ts`'in **birlikte** davranışını kanıtlıyor olmalı.
- En deterministik kurgu:
  - Gerçek `SessionRunState.defaultLayer` + `SessionStatus.defaultLayer` + `Bus.layer` +
    `SyncEvent.defaultLayer` + gerçek `Session` (DB persist'i için).
  - `SessionPrompt`'u, `prompt` metodunu **gerçek** bırakıp `loop` metodunu kontrol edilebilir bir
    Deferred/Latch'le bloklayan bir layer ile soy. (Katman arayüzünden `prompt`'u real kodla
    eşleyemiyorsak: `prompt`'u gerçek çağırmanın yolu tüm V1 layer tower'ı; alternatif olarak
    `test/session/prompt.test.ts`'deki mevcut layer kurulumunu temel al).

**Testin kurgusu (senaryo):**
1. Bir `sessionID`'ye ilk prompt'u gönder ve loop'u **çalışır (Running)** durumda bırak.
   - Loop'u blocklamak için `loop` tarafta bir `Latch`/`Deferred` kullan: ilk `prompt` için
     `ensureRunning` → `startRun(work)` → `runLoop` başlar ve first `yield`'de bloklanır.
   - `runner.busy === true` / `SessionStatus` `busy` olduğunu assert et (loop gerçekten Running).
   - İlk prompt'un `messageID`'sini kaydet.
2. Bu bloklı durumda **ikinci** bir `prompt` gönder (`it.live` içinde, second call'u `fork` ile ya da
   `Effect.all` concurrency ile; Runner yalnızca tek run'ı çalıştırdığı için ikinci `ensureRunning`
   mevcut run'ın `done`'una await edecek).
3. DETERMINISM: İkinci prompt için DEĞERLENDİRME YAPMADAN ÖNCE loop hâlâ bloklıyken KONTROL ET.
   - İkinci prompt'un `createUserMessage` **çalıştığını** ve kullanıcı mesajının DB'ye persist
     edildiğini assert et (aşağıda "assert edilecek durumlar").
   - İkinci prompt için **hiçbir** `message.updated` / `message.part.delta` / assistant event'inin
     fırlatılmadığını assert et.
4. Loop'u serbest bırak (Latch'i aç), her iki run da tamamlansın, teardown'da scope kapanır.

**Assert edilecek kesin durumlar:**
- İkinci prompt'un `messageID`: DB'de (MessageTable `sessions.listMessages` veya `sessions.get`)
  roller `"user"` olarak VAR.
- İkinci prompt'un `messageID`'sine ait **assistant response YOK** (`messages` içinde onun
  `parentID`'si olan hiçbir `role: "assistant"` mesaj yok).
- İkinci prompt'un `sessionID`'si için `message.updated` (assistant) ve `message.part.delta`
  event'lerinin sayısı `0` (loop çalışmadığı için none).
- (Kontrol) İlk prompt çalıştırsın: blok serbest bırakılınca ilk run'ın assistant mesajı DB'ye düşer.

**Mevcut yardımcılar / desenler:**
- `test/effect/runner.test.ts` — Runner'ı `Running`'e alma (Deferred gate + `fork` + `busy` assert).
- `test/lib/effect.ts` `testEffect` / `it.live` — Effect runtime.
- `test/fixture/fixture.ts` `tmpdirScoped` / `provideTmpdirInstance` / `disposeAllInstances`.
- Event gözleme: `Bus.Service.subscribeAllCallback` veya `subscribe(Callback)` ile `message.updated` /
  `message.part.delta` / `SessionEvent.*` yakala (`afterEach(() => unsubscribe())`).

**Bug VARLIGINI kanıtlama:** Bug yoksa (idiyse runner ikinci `work`'ü de başlatıyordu) ikinci prompt
için assistant event'i üretilir ve assert patlar. Mevcut kodda `runner.ts:120-122` work'ü yok saydığı
için test deterministik şekilde GEÇER → bug mevcut.

---

### Step 2 — Test B dosyası: SSE reconnect gap / replay-yok davranışını kanıtla

**Dosya:** `packages/opencode/test/cli/cmd/tui/context/global-event-gap.test.ts`

**Test adı (behavioral):**
`"SSE bağlantısı yokken loop event'leri boş dinleyiciye düşer; DB-read (sync) kurtarır"`

**Hedeflenen bug (doğrulanmış kaynaklar):**
- `src/cli/cmd/tui/context/sdk.tsx:74-108` `startSSE()` → `sdk.global.event` (`/global/event`); bağlantı
  kopunca exponential backoff; yeniden bağlanınca **yalnızca o andan itibaren** dinler. Replay/backfill
  YOK.
- `src/server/routes/instance/httpapi/handlers/global.ts:36-44` — `eventResponse()`: `Stream.callback`
  ile `GlobalBus.on("event", handler)`; SSE bağlı değilken listener yok.
- `src/bus/index.ts:101` — `Bus.publish` her atımda `GlobalBus.emit("event", {...})` çağırır. `GlobalBus`
  (`src/bus/global.ts`) bir Node `EventEmitter`'dır: **dinleyici yoksa event kalıcı kayb olur**
  (`super.emit` `false` döner, hiçbir şey saklanmaz). Replay/backlog yok.
- `src/cli/cmd/tui/context/sync.tsx:506-529` — `session.sync()` tam reload: DB'den okur
  (`sdk.client.session.messages`) → mesaj görünür olur.
- Sonuç: Loop SSE kesintisi sırasında çalışırsa event'ler boş dinleyiciye gider → chat boş; kapatıp
  açınca / sync çağırınca DB-read mesajı gösterir.

**Setup (layer'lar / stub'lar):**
- `Bus.layer` (gerçek `Bus` → `GlobalBus.emit`) + `SyncEvent.defaultLayer` + gerçek `Session`
  (DB persist).
- SSE ağına/serve edene GEREK YOK. Bug'un çekirdeği `GlobalBus`'ın replay'siz oluşudur — bunu
  deterministik olarak doğrudan test et.
- TUI sync store'unu (SolidJS basit store, sync.tsx) full bağlamak ağır; bunun yerine `sync.tsx:506-529`
  `session.sync()` **sözleşmesini** (DB-read ile mesaj listesini döndürür) temsil eden çağrıyı kullan.

**Testin kurgusu (senaryo):**
1. `GlobalBus`'tan her **listener'ı kaldır** (`GlobalBus.removeAllListeners("event")`) — SSE bağlı
   değil durumunu simüle et (SSE sonrası listener eklenmemiş olması).
   - Bir tracking listener takmak GEREKMEZ çünkü amaç "dinleyici yokken kayıp" — ama ispat için
     ayrı bir handler ekleyip aynı window'da hiç event almadığını göster.
2. Bir session'da loop'u çalıştır (V1 `SessionPrompt.prompt`, gerçek ancak LLM tarafını stub —
   `test/session/prompt.test.ts` tower'ı veya babalık `stubPromptLayer` deseni). Loop mesaj üretir.
3. SessionID için tüm mesajları **DB'den** oku (`sessions.listMessages` veya SyncEvent projectors →
   `SessionMessageTable` varlığı). Mesajların DB'de `"user"` + `"assistant"` VAR olduğunu assert et —
   **fakat** adım 1'deki tracking handler'a `message.updated`/`message.part.delta` event'lerinin
   `0` olarak ulaştığını assert et.
4. Şimdi `session.sync()` sözleşmesini çağır (TUI'nin yaptığı db-read: `sessions.listMessages`);
   mesajların görünür olduğunu (dönen listede user + assistant var) assert et → "kapatıp açınca görünür".
5. `afterEach`: `GlobalBus.removeAllListeners("event")` + `disposeAllInstances()` + `mock.restore()`.

**Assert edilecek kesin durumlar:**
- Loop tamamlandığında (SSE/GlobalBus listener YOKTUR): DB'de user + assistant mesajları **VAR**.
- Aynı window'da, eğer test ayrı bir `GlobalBus.on("event")` handler'ı varken loop koşsaydı o handler
  **hiçbir mesaj event'i ALMADI** — yani canlı event'ler kalıcı kayboldu (replay yok).
  - Bu, TUI sync store'unun SSE kesintisi sırasında boş kaldığını doğrular.
- `session.sync()` (DB-read) çağrılınca aynı mesajlar listesinde görünür → reconnect/sync sonrası
  chat dolar.

**Mevcut yardımcılar / desenler:**
- `src/bus/global.ts` `GlobalBus` — doğrudan Node EventEmitter; `listenerCount("event")` ile saklı
  listener olmadığını kanıtlayabiliriz.
- `test/v2/session.test.ts` `stubPromptLayer` — prompt'u stub'layıp `SessionEvent.*.Sync` fırlatan
  desen; DB'ye (SessionMessageTable) mesaj yazılışını doğrular.
- `test/fixture/fixture.ts` — tmp instance, `disposeAllInstances`, `provideTmpdirInstance`.
- `Bus.subscribeAllCallback` / `SyncEvent` capture — "dinleyici" olarak GlobalBus handler kullanılır.

**Bug VARLIGINI kanıtlama:** Bug yoksa (idiyse GlobalBus replay-lı ya da TUI sync event'lerle
doluyordu) step 3'te DB'de varken event'lerin `0` ulaşması assert'i patlar. Mevcut kodda
`GlobalBus.emit` (bus/index.ts:101) dinleyici yokken event'i düşürdüğü için test GEÇER → bug mevcut.
`session.sync()` DB-read'i (sync.tsx:506-529) mesajları kurtardığı için "reload sistemde görünür"
koşulu da sağlanır.

---

## Architecture Decisions

**Chosen approach:**
- Her iki test de **gerçek üretim kodunu** (real Runner, real Bus→GlobalBus, real DB persist) çalıştırır;
  yalnızca loop'un LLM/stream tarafını deterministik bir blok/stub ile kontrol eder. Bu, bug'ın varlığını
  gerçek davranış üzerinde kanıtlar, implementasyon detayını kopyalamaz.
- Test A, bug'ı runner-state seviyesinde kanıtlar: `ensureRunning`'in `Running` iken work'ü yok sayması
  (runner.ts:120-122) + prompt'un her durumda persist etmesi (prompt.ts:195).
- Test B, bug'ı iletim katmanında kanıtlar: `GlobalBus.emit`'in dinleyicisiz call'da event'i düşürmesi
  (bus/index.ts:101) + sync.tsx DB-read'inin kurtarması (sync.tsx:506-529).
- Determinizm için her iki test de:
  - Yapay sabit bekleme (`sleep(Nms)`) yerine **senkronizasyon primitive'leri** (Latch/Deferred/Queue)
    ve Event sink (PubSub / GlobalBus handler / subscribeAllCallback) kullanır.
  - `mock.module` persistence sorununa karşı `afterEach(() => mock.restore())` (repo kuralı).

**Alternatives considered:**
- **Full TUI render testi:** sync store + SSE + route'u gerçekten devreye sokar ama SolidJS store + real
  SSE serve + abonelik yaşam döngüsü ağır ve flaky'dir. Gerekli kanıt için fazla karmaşık — plan bunu
  önermez; TUI tarafı yalnız sözleşme düzeyinde (sync.tsx DB-read) temsil edilir.
- **Sadece saf birim test (runner.ts izole):** `test/effect/runner.test.ts`'te zaten `ensureRunning`
  work-yok-sayma kapsaması var. Ancak Test A'nın asıl değeri **persist etme + run bermemeyi BİRLİKTE**
  kanıtlamasıdır — bu yüzden gerçek `SessionPrompt.prompt` path'ini kullanır.
- **Çevirmeli network SSE testi (gerçek HTTP):** determinizm zayıf, timeout riski var; bug'ın kökü
  `GlobalBus`'ın replay'siz EventEmitter oluşudur, ağı yan yana test etmek gerekmez.

**Trade-offs:**
- Test A, gerçek `SessionPrompt` ve zengin layer kurulumu gerektirir (prompt.test.ts tower'ına benzer);
  kurulum maliyeti yüksek ama ispat doğrudandır. `stubPromptLayer` deseni (v2/session.test.ts) baz alınarak
  layer sayısı azaltılabilir.
- Test B, event capture'ı `GlobalBus.on("event")` handler'ıyla yapar; bu, üretimdeki SSE handler'ının
  (global.ts:39) taklididir ve deterministiktir. Gerçek SSE stream'ini test etmez.

---

## Open Questions

1. **Test A layer kurulumu:** `SessionPrompt.prompt`'u real kullanıp `loop`'u bloklanan katmanla soyarken
   en temiz yol hangisi? `test/session/prompt.test.ts`'deki mevcut layer tower'ı mı, yoksa
   `test/v2/session.test.ts` `stubPromptLayer` benzeri daha hafif bir stub mı? (Plan, ikisinden birini
   seçmeyi bırakıyor; implementer karar verir.) Not: bug, real `runner.ts` davranışına bağlı olduğundan
   `Runner`/`SessionRunState` real kalmalı.
2. **Test A runner'ı `Running`'e alma yolu:** İlk loop'u bloklamak için LLM/loop stub'ında
   `Latch`/`Deferred` kullanmak net. Ama `runLoop`'un kaçıncı `yield`'inde bloklanacağı loop-gerçekse
   farklılık gösterebilir — "busy"yi `SessionStatus` veya `runner.busy` üzerinden (yapısal) assert etmek
   en sağlamı.
3. **Test B loop üretimi:** V1 `SessionPrompt.prompt` gerçekten LLM gerektirir. LLM'i stub mı yoksa
   `stubPromptLayer` ile `SessionEvent.*.Sync` fırlatıp `SessionMessageTable`'ı projectors üzerinden mi
   dolduracağız? İkincisi daha hafif ve deterministiktir (v2/session.test.ts kanıtı).
4. **Test B "sync kurtarması":** `session.sync()` TUI sözleşmesini, gerçek `sdk.client.session.messages`
   yerine doğrudan `sessions.listMessages` (service) ile mi temsil edelim? (Test ortamında SDK/HTTP
   client kurmak gerekmez; service-level DB-read yeterli kanıttır.)
5. Test B'de `GlobalBus`'ın fareyle aynı süreçte paylaşıldığını unutma — `afterEach`'te
   `removeAllListeners("event")` ile tam temizlik şart (fake/gap leak riski).