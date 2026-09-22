# ACP Terminal Backend Entegrasyonu

**Tarih:** 2026-09-16  

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `56dd7dd` (terminal backend lifecycle) plus `ee025f0`, `d86cf50`, `41993ad`, `9fe655a`, `dba330a`, `c21ae65`; evidence `packages/opencode/src/acp/agent.ts` (terminal-backend wiring) and `test/acp/terminal-backend.test.ts`.

The substance of the plan's own Durum note stands — a real Zed smoke test is still outstanding — but the line's status value is superseded by this block.
**Durum:** Uygulandı — gerçek Zed smoke testi bekliyor  
**Kapsam:** OpenCode’un ACP üzerinden Zed ve diğer client’larda gerçek terminal akışı, canlı çıktı ve güvenilir tool-call lifecycle desteği

## 1. Amaç

OpenCode ACP agent’ı, terminal capability’si sunan ACP client’larda shell komutlarını client’ın terminal backend’i üzerinden çalıştırabilmeli. Böylece:

- Komut, Zed Agent Panel’de gerçek komut olarak görünmeli.
- Komut çıktısı canlı terminal içeriği olarak görünmeli.
- Çıktı, modelin tool sonucu olarak da alınabilmeli.
- Komut tamamlandığında exit status ve final çıktı ACP’ye doğru aktarılmalı.
- Komut iptali, timeout ve client bağlantısının kopması güvenli şekilde ele alınmalı.
- Terminal capability’si olmayan client’larda mevcut local shell davranışı korunmalı.
- Aynı tool call için birden fazla `completed` güncellemesi gönderilmemeli.

Bu çalışma yalnızca Zed’e özel bir workaround olmamalı; ACP v1 terminal capability’sini destekleyen tüm client’lar için capability-driven bir backend seçimi sağlamalıdır.

## 2. Mevcut durum ve bulgular

### 2.1 ACP bağlantısı

- ACP giriş noktası `packages/opencode/src/cli/cmd/acp.ts` içindedir.
- OpenCode burada `AgentSideConnection` oluşturur ve ACP agent’ı bu bağlantıya bağlar.
- Zed client, ACP agent’ına `session/update` bildirimleri gönderir.
- `AgentSideConnection` SDK’sı `createTerminal`, `terminalOutput`, `waitForTerminalExit`, `killTerminal` ve `releaseTerminal` metotlarını sunabilmektedir.
- Mevcut ACP kodunda bu metotların kullanıldığı bir terminal backend bulunmamaktadır.

### 2.2 Shell çalıştırma

- V2 shell lifecycle `packages/opencode/src/session/loop/shell.ts` içinde yürütülür.
- Komut shell seçimi ve argüman üretimi OpenCode tarafında yapılır.
- Komut `ChildProcess.make(...)` ile OpenCode prosesinin çalıştığı ortamda lokal olarak başlatılır.
- Shell başında `SessionEvent.Shell.Started.Sync` yayınlanır.
- Shell sonunda `SessionEvent.Shell.Ended.Sync` yayınlanır.
- Çıktı ayrıca tool-result akışı üzerinden `SessionEvent.Tool.Success.Sync` ile gelebilir.

### 2.3 ACP event forwarding

- `packages/opencode/src/acp/agent.ts`, global event stream’i dinler.
- `session.next.shell.started` ve `session.next.shell.ended` olayları ACP’ye aktarılır.
- `packages/opencode/src/acp/tool-dispatch.ts`, `tool_call`, `tool_call_update`, `rawInput`, `rawOutput` ve text content üretir.
- Shell komutu görünür olsun diye mevcut çalışma ağacında shell başlığı ve başlangıç content’i gerçek komuta çevrilmiştir.
- Shell sonucu regular ACP text content olarak gönderilmektedir.
- Zed’in bazı sürümlerinde `rawInput.command` ve canlı `tool_call_update.content` Agent Panel’de görünmeyebilmektedir. Bu durum ACP wire formatının geçersiz olduğu anlamına gelmez.

### 2.4 Mevcut riskler

1. **Terminal backend yok:** OpenCode local process çalıştırıyor; Zed’in terminal UI’sine bağlanmıyor.
2. **Çift completion riski:** Shell için hem `session.next.shell.ended` hem `session.next.tool.success` gelebilir. İkisi de `completed` update üretirse naif client’larda duplicate görülebilir.
3. **Client capability belirsizliği:** Agent, `clientCapabilities.terminal` değerini açıkça okuyup backend seçmiyor.
4. **Çift çalıştırma riski:** `terminal/create` kullanılırken mevcut local `ChildProcess` de çalıştırılmaya devam ederse komut iki kez çalışır. Bu kabul edilemez.
5. **Model çıktısı / UI çıktısı ayrımı:** Client terminali canlı UI çıktısını sağlayabilir; agent yine de final `terminal/output` çağrısıyla model tool sonucunu üretmelidir.
6. **Bağlantı kopması:** Client terminali oluşturulduktan sonra ACP bağlantısı koparsa terminal release/cleanup garantilenmelidir.

## 3. ACP terminal semantiği

ACP terminal backend’i, agent’ın client’a şu işlemleri yaptırdığı bir akıştır:

1. Agent, `clientCapabilities.terminal === true` olduğunu doğrular.
2. Agent `terminal/create` çağrısıyla client ortamında komut başlatır.
3. Client hemen bir `terminalId` döndürür.
4. Agent bu `terminalId` değerini `tool_call.content` içinde `{ type: "terminal", terminalId }` olarak embed eder.
5. Client terminal çıktısını canlı gösterir.
6. Agent `terminal/wait_for_exit` ile tamamlanmayı bekler.
7. Agent `terminal/output` ile model için final çıktıyı alır.
8. Agent `tool_call_update` ile `completed` veya `failed` bildirir.
9. Agent `terminal/release` çağırır.

ACP terminal protokolünde terminal yalnızca UI süsü değildir; komut client ortamında çalıştırılır. Bu nedenle mevcut local shell child process’ine sonradan terminal bağlamak mümkün değildir. Backend seçimi komut başlamadan önce yapılmalıdır.

## 4. Tasarım kararı

### 4.1 Capability-driven backend seçimi

Varsayılan seçim:

```text
ACP session başladı
        |
        v
Client terminal capability true mı?
        |
   +----+----+
   |         |
  evet      hayır / bilinmiyor
   |         |
ACP         Local
terminal    shell
backend     backend
```

Önerilen modlar:

- `auto` — terminal capability varsa ACP terminal backend, yoksa local backend.
- `client` — capability yoksa açık ve anlamlı hata; local fallback yapılmaz.
- `local` — mevcut davranış; ACP terminal capability’si kullanılmaz.

İlk aşamada kullanıcı konfigürasyonu eklemek yerine `auto` varsayılanı kullanılabilir. Debug ve geri dönüş için ileride `OPENCODE_ACP_TERMINAL_BACKEND=auto|client|local` gibi bir geliştirme seçeneği eklenebilir.

### 4.2 Backend arayüzü

Shell çalıştırma kodunun ACP’ye özel dallarla kirlenmesini önlemek için küçük bir backend sınırı oluşturulmalıdır. İsimler uygulama sırasında mevcut modül yapısına göre netleştirilebilir:

```ts
type ShellExecutionRequest = {
  sessionID: string
  callID: string
  cwd: string
  command: string
  shell: string
  args: string[]
  env: Record<string, string>
  timeoutMs?: number
}

type ShellExecution = {
  output: Effect.Effect<string>
  wait: Effect.Effect<{ output: string; exitCode?: number; signal?: string }>
  cancel: Effect.Effect<void>
  release: Effect.Effect<void>
  display?: { terminalId: string }
}

interface ShellBackend {
  readonly kind: "local" | "acp-client"
  execute(request: ShellExecutionRequest): Effect.Effect<ShellExecution>
}
```

Arayüzün kesin şekli implementasyon sırasında mevcut `Effect` ve `ChildProcess` abstraction’larına göre uyarlanmalıdır. Gereksiz genel amaçlı process framework’ü oluşturulmamalıdır.

### 4.3 Local backend

Local backend mevcut davranışın taşınmış halidir:

- `Shell.preferred(...)` ve `Shell.args(...)` çıktısını kullanır.
- `ChildProcess.make(...)` ile komut çalıştırır.
- stdout/stderr birleştirme ve incremental output davranışını korur.
- `TERM=dumb`, environment merge, cwd ve Windows shell argüman semantiğini korur.
- TUI, HTTP API ve ACP dışındaki tüm shell çağrıları bu backend’i kullanmaya devam eder.

Local backend’in ilk refactor adımından önce characterization testleri yazılmalıdır.

### 4.4 ACP client terminal backend

ACP backend:

- `AgentSideConnection.createTerminal(...)` çağırır.
- `sessionId`, `command`, `args`, `env`, `cwd` ve output byte limitini aktarır.
- Dönen `terminalId` değerini execution state içinde tutar.
- `tool_call` başlangıç bildiriminde terminal content’i embed eder.
- Client terminal çıktısını canlı gösterdiği için local stdout forwarding yapmaz.
- Model sonucu için `waitForExit` ve `currentOutput`/`terminalOutput` kullanır.
- İptalde `kill`, sonrasında `output` ve `release` çağrılarını doğru sırada yürütür.
- Başarıda final output ve exit status’u core shell lifecycle’a döndürür.
- Client capability eksikse bu backend hiç çağrılmaz.

## 5. Shell lifecycle entegrasyonu

### 5.1 Backend seçimi zamanı

Backend seçimi `ChildProcess` yaratılmadan önce yapılmalıdır. Aşağıdaki sıralama korunmalıdır:

1. Tool permission kontrolü.
2. Shell command/shell/args/env/cwd normalizasyonu.
3. ACP client capability ve backend mode kontrolü.
4. Seçilen backend ile execution başlatma.
5. `SessionEvent.Shell.Started` yayınlama.
6. Tool progress ve görünür ACP tool call üretme.
7. Output/exit bekleme.
8. `SessionEvent.Shell.Ended` yayınlama.
9. Tool success/error persistence.
10. ACP terminal release.

Başlama event’inin backend gerçekten başarıyla oluşturulduktan sonra veya mevcut local davranışı bozmadan belirlenmiş transaction noktasında yayınlanması gerekir. Event’in başarısız bir `terminal/create` işleminden önce yayınlanması client’ta sonsuza kadar running tool bırakabilir.

### 5.2 V2 event uyumluluğu

Her iki backend de aynı V2 event sözleşmesini üretmelidir:

- `session.next.shell.started`: `sessionID`, `callID`, `command`, `timestamp`
- `session.next.shell.ended`: `sessionID`, `callID`, `output`, `timestamp`
- Tool success veya failure event’i mevcut processor akışına uygun şekilde üretilmelidir.

ACP adapter, backend türünü client’a ayrı bir internal alan olarak göndermemelidir. ACP client’ın gördüğü tool call semantiği backend’den bağımsız olmalıdır.

### 5.3 Tool call görünürlüğü

Shell başlangıcında:

- `title`: gerçek command veya command’ı anlamlı biçimde temsil eden başlık.
- `kind`: `execute`.
- `rawInput`: en az `{ command }`, mümkünse mevcut shell tool input’unun güvenli normalize edilmiş hali.
- `content`: command text fallback’i.
- ACP backend seçilmişse aynı content dizisinde terminal block.

Terminal block ve text fallback’in aynı tool call’da birlikte taşınması client uyumluluğunu artırır. Client terminal block’u desteklemiyorsa regular text command yine görülebilir.

### 5.4 Tool call sonucu

Başarılı sonuçta:

- `status: "completed"`
- `content`: final text output; output boşsa command fallback’i veya boş output semantiği açıkça test edilmeli.
- `rawOutput`: `{ output, metadata }`
- `title` ve `rawInput`: önceki tool call ile aynı anlamı korumalı.

Başarısız sonuçta:

- `status: "failed"`
- error text `content` içinde görünür olmalı.
- `rawOutput.error` doldurulmalı.

## 6. Duplicate ve lifecycle idempotency

### 6.1 Problem

Bir shell çağrısı için aşağıdaki event’ler aynı execution’ı temsil edebilir:

- `session.next.shell.ended`
- `session.next.tool.success`
- raw Bus event
- sync envelope kopyası

Raw/sync duplicate’leri event ID/type deduplication ile ele alınmalıdır. Ancak `shell.ended` ve `tool.success` farklı event türleri olduğu için yalnızca event key dedup yeterli değildir.

### 6.2 Çözüm

ACP tool registry içinde her `callID` için terminal durum tutulmalıdır:

```text
pending -> in_progress -> completed
pending -> in_progress -> failed
```

- `completed` veya `failed` sonrası ikinci terminal event ACP client’a tekrar gönderilmemeli.
- Yeni bir `tool.called` veya yeni shell execution aynı callID’yi gerçekten yeniden kullanıyorsa state sıfırlanmalı.
- Terminal state session bazında tutulmalı; farklı session’lar arasında callID çakışması olmamalı.
- Terminal update gönderimi başarısız olduğunda loglama yapılmalı; state stratejisi retry gereksinimine göre belirlenmeli.
- `tool_call_update.content` ACP’de collection replacement semantiğine sahip olduğundan output snapshot’ları append edilmemeli.

Bu idempotency davranışı hem Zed hem de diğer ACP client’lar için zorunlu güvenlik katmanıdır.

## 7. Capability ve session state

### 7.1 Capability elde etme

Implementasyon sırasında kullanılan `@agentclientprotocol/sdk` sürümünde client capability bilgisinin hangi callback/agent lifecycle alanında sunulduğu kesinleştirilmelidir. Capability değeri:

- initialize cevabından sonra okunmalı.
- session başlamadan önce hazır olmalı.
- global bir mutable flag yerine ACP connection/session kapsamına bağlanmalı.
- Capability hiç gelmezse `false` kabul edilmeli.

### 7.2 Session bazlı state

`ACPSessionState` veya ACP Agent iç state’inde en az şu bilgiler gerekebilir:

- seçilmiş shell backend modu,
- terminal capability değeri,
- aktif `callID -> terminalId` eşlemesi,
- terminal release durumu,
- cancel/connection abort sinyali,
- backend terminal handle’ı.

Terminal handle’ları session kapanışında ve ACP bağlantısı abort olduğunda temizlenmelidir.

### 7.3 Connection scope

Aynı OpenCode process’i içinde birden fazla ACP connection veya session bulunabilir. Bir client’ın terminal capability’si diğer session’a taşınmamalıdır. Testler capability isolation’ı açıkça doğrulamalıdır.

## 8. İptal, timeout ve hata yönetimi

### 8.1 ACP prompt cancel

- ACP `session/cancel` geldiğinde ilgili execution lookup edilmelidir.
- ACP backend için `terminal/kill` çağrılmalı.
- Mümkünse final `terminal/output` alınmalı.
- `terminal/release` garanti edilmelidir.
- Core shell state tamamlanmış/iptal edilmiş olarak işaretlenmelidir.
- ACP client’a tek bir failed/completed terminal update gönderilmelidir.

### 8.2 Client connection abort

- `connection.signal` abort olduğunda aktif ACP terminal’leri release/kill edilmelidir.
- Release sırasında yeni ACP request gönderilemezse hata yutulup loglanmalıdır.
- Process kapanışını bekleten dangling fiber/promise bırakılmamalıdır.

### 8.3 Timeout

- Mevcut shell timeout semantiği korunmalıdır.
- ACP terminal backend timeout olduğunda `kill -> output -> release` sırası uygulanmalıdır.
- Timeout çıktısı kullanıcıya metadata ile aktarılabilir; mevcut `<metadata>` biçimi korunacaksa characterization testi eklenmelidir.

### 8.4 Client terminal hataları

Aşağıdaki durumlar açık ve gözlemlenebilir hata üretmelidir:

- `terminal/create` reddedildi.
- Client capability true bildirip metodu uygulamıyor.
- `terminal/output` başarısız.
- `wait_for_exit` başarısız.
- `terminal/release` başarısız.
- Terminal ID bilinmiyor veya client terminali erken kapatmış.

Bu hatalarda local shell’e sessizce fallback yapılmamalıdır; aksi halde aynı command iki kez çalışabilir. Fallback yalnızca backend seçimi aşamasında ve command başlamadan önce yapılmalıdır.

## 9. Environment, cwd ve shell uyumluluğu

ACP `terminal/create` için:

- `cwd` absolute path olmalıdır.
- `command` ve `args` ayrı alanlara çevrilmelidir.
- Environment formatı ACP’nin `EnvVariable[]` şekline dönüştürülmelidir.
- OpenCode’un `shell.env` plugin hook çıktısı client terminaline aktarılmalıdır.
- `TERM=dumb` gibi mevcut UI/çıktı davranışları client terminal backend’inde yeniden değerlendirilmelidir; körlemesine aktarılmamalıdır.
- Windows’ta `powershell`, `cmd` ve `bash` argümanları mevcut `Shell.args` semantiği ile karşılaştırılmalıdır.
- Path quoting/shell injection riski için command string yeniden shell interpolation’dan geçirilmemelidir.
- ACP client’ın çalışma ortamı OpenCode server ortamından farklı olabilir; bu fark dokümante edilmeli ve test edilmelidir.

Özellikle Zed Windows senaryosu ayrı integration test matrisi gerektirir.

## 10. Test stratejisi

Bu çalışma büyük bir shell execution refactor’ı olduğundan Rule 3 uygulanmalıdır: davranış taşıma veya dosya ayırma işleminden önce mevcut davranışı kilitleyen characterization testleri yazılmalıdır.

### Faz A — Mevcut davranış characterization

`packages/opencode/test/` altında:

- local shell command/args/cwd/env üretimi,
- stdout/stderr birleştirme,
- empty output,
- non-zero exit,
- abort,
- timeout,
- shell started/ended event sırası,
- tool success ile shell ended’in birlikte gelmesi,
- Windows shell varyantları,
- ACP local fallback event forwarding,
- replay shell message forwarding

kilitlenmelidir.

### Faz B — ACP dispatcher unit testleri

`packages/opencode/test/acp/` içinde:

- shell pending update command title/rawInput/content,
- in-progress update,
- completed output content/rawOutput,
- empty output command fallback,
- failed output,
- same `callID` için duplicate completion bastırma,
- raw event + sync envelope dedup,
- iki session izolasyonu,
- repeated callID pending reset,
- terminal content block serialization

test edilmelidir.

### Faz C — Fake terminal client testleri

Fake `AgentSideConnection` şunları desteklemelidir:

- `createTerminal` çağrı kaydı,
- dönen terminal ID,
- `waitForExit`,
- `currentOutput` veya `terminalOutput`,
- `kill`,
- `release`.

Testler şu invariant’ları kontrol etmelidir:

1. `createTerminal` tam olarak bir kez çağrılır.
2. Local `ChildProcess` ACP backend seçiliyken hiç çağrılmaz.
3. `tool_call` terminal block içerir.
4. Final output model sonucuna aktarılır.
5. `release` normal başarıda çağrılır.
6. Cancel/timeout’ta `kill` ve `release` çağrılır.
7. Release iki kez çağrılmaz.
8. Terminal capability false olduğunda `createTerminal` çağrılmaz.

### Faz D — ACP wire/integration testleri

NDJSON seviyesinde veya mevcut ACP test harness’i ile:

- initialize capability true,
- session/new,
- prompt ile shell tool,
- terminal/create request,
- terminal ID ile tool_call,
- terminal output/wait,
- completed update,
- terminal/release

tam akışı test edilmelidir.

Capability false ve capability alanı eksik varyantları da çalıştırılmalıdır.

### Faz E — Zed smoke test

Manuel veya otomatik smoke checklist:

- Zed yeni ACP session açar.
- `echo hello` komutunda command görünür.
- Uzun süren komutta canlı terminal çıktısı görünür.
- Final çıktı kaybolmaz.
- Boş çıktılı command kartı tamamlanır.
- Başarısız command failed görünür.
- Cancel sonrası process yaşamaya devam etmez.
- Session yeniden açıldığında replay tek kayıt gösterir.
- Aynı tool output duplicate görünmez.

## 11. Uygulama fazları

### Faz 0 — Protokol ve SDK doğrulaması

1. Kullanılan ACP SDK’nın `AgentSideConnection` terminal API’sini doğrula.
2. Initialize callback’inde client capability bilgisinin erişim noktasını belirle.
3. `terminal/create` request shape’ini mevcut SDK tipiyle eşleştir.
4. `ToolCallContent` terminal union shape’ini doğrula.
5. Zed’in güncel ACP log davranışını bir smoke fixture ile kaydet.
6. Terminal desteklemeyen test client davranışını tanımla.

**Çıkış kriteri:** Capability okuma ve terminal method çağrıları için kesin API sözleşmesi belgelenmiş olmalı.

### Faz 1 — Characterization ve idempotency

1. Mevcut local shell testlerini yaz.
2. Shell ended + tool success çift event senaryosunu testle.
3. ACP terminal completion registry/state tasarımını testle.
4. Duplicate completion bastırmayı uygula.
5. Mevcut ACP command/output görünürlük testlerini genişlet.

**Çıkış kriteri:** Local shell davranışı değişmeden ACP dispatcher tek terminal completion üretmeli.

### Faz 2 — Shell execution boundary

1. Local shell execution kodunu küçük backend sınırına taşı.
2. Characterization testlerini aynı backend üzerinden çalıştır.
3. Core V2 shell event’lerinin backend’den bağımsız kaldığını doğrula.
4. TUI/HTTP/ACP dışı tüketicilerin local backend kullandığını doğrula.

**Çıkış kriteri:** Local backend mevcut testlerle parity sağlamalı ve ACP için seçim noktası hazır olmalı.

### Faz 3 — ACP terminal backend

1. Capability ve backend mode state’ini ekle.
2. `ACPClientTerminalBackend` oluştur.
3. `terminal/create` parametre mapping’ini uygula.
4. Terminal handle lifecycle’ını uygula.
5. Tool call terminal content embedding’ini uygula.
6. Final output/exit status mapping’ini uygula.
7. Normal release, cancel, timeout ve connection abort cleanup’ını uygula.

**Çıkış kriteri:** Fake terminal client testleri tamamlanmalı; local process ACP backend modunda çalışmamalı.

### Faz 4 — Fallback ve uyumluluk

1. Capability true/false/missing seçim testleri.
2. `auto`, `client`, `local` mode davranışı.
3. Terminal API runtime missing durumunu güvenli error olarak ele alma.
4. Eski ACP client’larda regular text fallback.
5. Replay path’in değişmeden çalışması.
6. Session/load ve reconnect senaryoları.

**Çıkış kriteri:** En az bir terminal destekleyen ve bir terminal desteklemeyen fake client aynı test paketinde başarılı olmalı.

### Faz 5 — Zed ve çoklu client doğrulaması

1. Zed ile gerçek `opencode acp` smoke test.
2. ACP logunda `terminal/create` ve terminal block doğrulaması.
3. Live output ve final output doğrulaması.
4. Terminal content desteklemeyen client için regular content doğrulaması.
5. Duplicate ve reconnect testi.
6. Windows/Linux/macOS shell mapping kontrolü.

**Çıkış kriteri:** Zed’de command ve live output görünür; fallback client’lar bozulmaz.

### Faz 6 — Dokümantasyon ve rollout

1. `packages/opencode/src/acp/README.md` güncelle.
2. Zed configuration ve build/restart adımlarını güncelle.
3. Backend mode/debug flag dokümante et.
4. Bilinen Zed UI sınırlamalarını ayırarak belirt.
5. Release note ve migration notu ekle.
6. ACP package typecheck, ACP testleri ve ilgili shell testlerini çalıştır.

## 12. Beklenen dosya etkisi

Kesin dosya listesi uygulama öncesi tekrar doğrulanmalıdır. Muhtemel etki alanları:

### Birincil dosyalar

- `packages/opencode/src/cli/cmd/acp.ts`
- `packages/opencode/src/acp/agent.ts`
- `packages/opencode/src/acp/tool-dispatch.ts`
- `packages/opencode/src/acp/session.ts`
- `packages/opencode/src/acp/types.ts`
- `packages/opencode/src/session/loop/shell.ts`
- `packages/opencode/src/tool/shell/execute.ts`

### Muhtemel yeni dosyalar

- `packages/opencode/src/acp/terminal-backend.ts`
- `packages/opencode/src/acp/local-shell-backend.ts`
- `packages/opencode/src/acp/client-terminal-backend.ts`

Yeni dosya split’i yapılacaksa ilgili karakterizasyon testleri önce yazılmalıdır. Tek kullanımlık helper’lar için gereksiz modül çıkarılmamalıdır.

### Test dosyaları

- `packages/opencode/test/acp/event-subscription.test.ts`
- `packages/opencode/test/acp/process-message.test.ts`
- `packages/opencode/test/acp/sync-unwrap.test.ts`
- `packages/opencode/test/acp/terminal-backend.test.ts` (gerekirse)
- `packages/opencode/test/session/loop/shell.test.ts` veya mevcut shell test dosyası
- `packages/opencode/test/tool/shell.test.ts`

### Dokümantasyon

- `packages/opencode/src/acp/README.md`
- Gerekirse ACP’ye yakın `AGENTS.md` notları

## 13. SDK regeneration ve typecheck notları

- ACP terminal capability mevcut generated SDK/event tiplerinde temsil ediliyorsa SDK güncellemesi gerekebilir.
- Server-side API schema değişmiyorsa OpenCode SDK regeneration gerekmeyebilir; uygulama sırasında doğrulanmalıdır.
- SDK regeneration yapılırsa `packages/opencode` ve `packages/app` typecheck birlikte çalıştırılmalıdır.
- `packages/app` incremental build-info cache’i nedeniyle temiz typecheck gereksinimi değerlendirilmelidir.
- Normal doğrulama:

```text
cd packages/opencode
bun test test/acp
bun typecheck
```

- Shell execution değişikliği daha geniş etki yaratırsa ilgili shell testleri ve tam package test suite çalıştırılmalıdır.
- Root test script’i kullanılmamalıdır.

## 14. Riskler ve azaltma planı

| Risk | Etki | Azaltma |
|---|---|---|
| Komut iki kez çalışır | Veri kaybı / yan etki | Backend seçimini ChildProcess öncesine al; fallback’i execution başladıktan sonra yapma |
| Zed capability bildirmez | Live terminal yok | `auto` local fallback + regular ACP content |
| Client terminal metodu bozuk | Tool stuck | Create başarısızlığını terminal failure olarak bildir; sessiz fallback yapma |
| İki completion update | Duplicate UI | callID başına terminal state/idempotency |
| Client regular content göstermiyor | Output görünmez | Terminal content embed et; final regular content’i yine gönder |
| Client bağlantısı kopar | Dangling process | abort listener ile kill/release cleanup |
| Terminal client cwd farklı | Yanlış dosyada çalışma | absolute cwd mapping, wire log ve smoke test |
| Windows shell farkı | Komut başarısızlığı | Shell.args parity testleri |
| Terminal output limiti | Eksik model context’i | outputByteLimit seçimi, truncation metadata ve final output testi |
| Release iki kez yapılır | Protocol error | ownership/state guard |
| Core shell event sırası bozulur | Replay/state bozulur | characterization + V2 projector testleri |
| ACP permission iki kez sorulur | Kötü UX | Agent permission ile client terminal permission sınırını açıkça belirle |

## 15. Permission kararı

Bu konu uygulama başlamadan önce netleştirilmelidir:

- OpenCode’un mevcut permission sistemi tool execution iznini korumalıdır.
- Zed’in `terminal/create` çağrısı ayrıca client-side permission UI gösterebilir.
- Aynı operasyon için iki bağımsız prompt oluşması mümkünse UX kararı verilmelidir.
- Agent permission reddederse `terminal/create` hiç çağrılmamalıdır.
- Client terminal permission reddederse tool failed/cancelled olarak kapanmalıdır.
- Permission bypass için client capability kullanılmamalıdır.

İlk implementasyon için öneri: OpenCode agent permission kontrolünü koru; client’ın kendi terminal policy’sini ayrıca destekle; iki katmanlı prompt davranışını dokümante et ve smoke testte ölç.

## 16. Gözlemlenebilirlik

Debug loglarına aşağıdaki alanlar eklenmelidir:

- `sessionID`
- `callID`
- `backend: "local" | "acp-client"`
- `terminalId` (secret değildir; yine de gereksiz yere user-facing log’a yazılmamalı)
- capability sonucu
- create/wait/output/kill/release adımı
- exit code/signal
- output length/truncated
- fallback nedeni
- duplicate terminal event bastırıldı mı

Komutun kendisi mevcut güvenlik/loglama politikasına göre redacted veya kontrollü loglanmalıdır. Secret içeren command argümanları düz log’a yazılmamalıdır.

## 17. Kabul kriterleri

Çalışma tamamlanmış sayılmadan önce:

- [x] OpenCode ACP initialize sonucundaki terminal capability doğru okunuyor.
- [x] Capability true olan client’ta shell command local `ChildProcess` ile çalıştırılmıyor.
- [x] `terminal/create` tam bir kez çağrılıyor.
- [x] `tool_call` gerçek command, `rawInput` ve terminal content içeriyor.
- [ ] Zed’de uzun komutun canlı çıktısı görünür.
- [x] Final output hem client UI hem model tool sonucu için mevcut.
- [x] Empty output command kartı tamamlanıyor.
- [x] Non-zero exit failed veya mevcut shell error semantiğine uygun kapanıyor.
- [x] Cancel/timeout kill ve release yapıyor.
- [x] ACP connection abort aktif terminalleri temizliyor.
- [x] Capability false/missing client local fallback ile çalışıyor.
- [x] Fallback sırasında komut iki kez çalışmıyor.
- [x] Aynı callID için yalnızca bir terminal completion gönderiliyor.
- [ ] Replay sonrası command/output tek kez görünür.
- [x] İki session birbirinin terminal state’ini etkilemiyor.
- [x] ACP testleri, shell testleri ve typecheck başarılı.
- [x] ACP README’de backend/fallback davranışı açıklanıyor.

## 18. Uygulama sırasında cevaplanacak açık sorular

1. Kullanılan ACP SDK’da client capability Agent instance’ına hangi lifecycle alanından aktarılıyor?
2. Zed’in mevcut sürümü regular text fallback ve terminal block’u aynı tool call’da nasıl render ediyor?
3. `terminal/create` için OpenCode shell argümanları command/args olarak güvenilir biçimde ayrılabiliyor mu?
4. ACP terminal backend çıktısında stderr/stdout ayrımı gerekiyor mu, yoksa mevcut birleşik output korunacak mı?
5. Terminal output polling sıklığı model tool progress’i için gerekli mi?
6. OpenCode permission prompt’u ile Zed terminal prompt’u birlikte gösterildiğinde hangi UX tercih edilecek?
7. `outputByteLimit` için mevcut truncation limitleriyle uyumlu tek bir değer var mı?
8. Client terminal ortamı server cwd/env’inden farklı olduğunda kullanıcıya nasıl bilgi verilecek?
9. Terminal capability `auto` seçimi için kalıcı config mi, yalnızca ACP session state mi kullanılacak?

## 19. Önerilen ilk uygulama sırası

En düşük riskli sıra:

1. SDK capability API’sini doğrula.
2. Shell ended + tool success duplicate completion testini ekle ve idempotency’yi düzelt.
3. Mevcut local shell davranışını characterization testleriyle kilitle.
4. Shell execution backend sınırını çıkar.
5. Local backend parity testlerini geçir.
6. Fake ACP terminal backend’i ve lifecycle testlerini ekle.
7. Capability-driven seçim ve no-double-execution guard’ını ekle.
8. Terminal content embedding + final output mapping’i ekle.
9. Cancel/timeout/abort/release akışlarını ekle.
10. Fallback ve multi-session testlerini geçir.
11. Zed gerçek smoke testini çalıştır.
12. Dokümantasyon ve rollout notlarını güncelle.

Bu sıra, Zed entegrasyonunu doğrudan production shell akışına bağlamadan önce mevcut davranışın korunmasını ve çift çalıştırma riskinin kontrol altına alınmasını sağlar.

## 20. Uygulama günlüğü

### 2026-09-16 — ACP terminal backend lifecycle düzeltmeleri

- `packages/opencode/src/acp/terminal-backend.ts` eklendi/güncellendi: capability-driven `auto|client|local` seçim, session kapsamlı terminal registry ve idempotent `kill → release` cleanup.
- `packages/opencode/src/acp/agent.ts` güncellendi: initialize capability kaydı, session kapanışı ve event stream sonlanışında terminal cleanup.
- `packages/opencode/src/session/loop/shell.ts` güncellendi: ACP terminal interrupt durumunda local child process çalıştırmama ve aktif terminali kill etme.
- `packages/opencode/src/acp/tool-dispatch.ts` ve ilgili event testleri güncellendi: gerçek shell command görünürlüğü ve duplicate completion bastırma.
- `packages/opencode/test/acp/terminal-backend.test.ts` eklendi: local fallback, client-mode hata, tekil kill/release ve session cleanup testleri.
- `packages/opencode/src/acp/README.md` güncellendi: backend mode ve cleanup davranışı belgelendi.
- Doğrulama: ACP hedef testleri `17 pass`; mevcut ACP paketi `102 pass`; shell testleri `108 pass, 1 skip`; `packages/opencode` typecheck başarılı; `git diff --check` başarılı.
- Açık kalan doğrulama: gerçek Zed smoke testi ve replay davranışının gerçek client üzerinde manuel teyidi.
