# Plan: opencode Ana Süreç Bellek Tüketimini Azaltma

**Tarih:** 2026-08-02

**Status:** ✅ EXECUTED (reviewed 2026-09-22) — landed in `dc1c307`: lazy provider database (`provider/provider.ts:1166-1172` `getDatabaseProvider` cache) and lazy onnxruntime (`search/embedding.ts:8` type-only import, `:150` dynamic import); LSP diagnostic maps bounded in `40ae66a` / `5f52117`. Supersedes the `Durum: Taslak` line below.
**Durum:** Taslak
**Hedef:** opencode ana sürecinin runtime bellek footprint'ini azaltmak

## Mevcut Durum (Ölçümler)

Rebuild sonrası canlı sistem ölçümü (PID 1642333):

| Kategori | RSS | Not |
|---|---|---|
| JSC-heap (WKFastMalloc) | 531 MB | JavaScript objeleri, modüller, veri yapıları |
| binary (code+data) | 142 MB | opencode binary segmentleri |
| JSC-Gigacage | 102 MB | GC cage (Bun runtime) |
| anon-other | 98 MB | Diğer anonim mapping'ler |
| JSC-JIT | 39 MB | JIT-derlenmiş kod |
| deleted mappings | 32 MB | Silinmiş native addon mapping'leri |
| JSC-StructureHeap | 13 MB | JS structure layout |
| **Toplam RSS** | **961 MB** | |

## Analiz: Bellek Tüketen Kaynaklar

### 1. models-snapshot (Eager, ~50-100 MB tahmini)

- **Dosya:** `src/provider/models-snapshot.js` (3.3 MB JSON)
- **İçerik:** 178 provider, 5949 model
- **Yükleme:** `models.ts:136-140` `loadSnapshot` dynamic import ile yükleniyor (bu kısım iyi)
- **Sorun:** `provider.ts:1031` `const database = mapValues(modelsDev, fromModelsDevProvider)` — tüm 5949 modeli init sırasında dönüştürüyor
- `fromModelsDevProvider` (`provider.ts:977-1009`) her model için `fromModelsDevModel` çağırır, experimental modes için ek model objeleri oluşturur
- Sonuç: 5949+ Model objesi + variants + capabilities + cost + limit + modalities hepsi memory'de
- `database` sonradan `providers` record'una kopyalanıyor (`provider.ts:1033-1266`), yani çoğu iki kopya

### 2. ONNX Embedding (Eager, ~15-20 MB tahmini)

- **Dosya:** `src/search/embedding.ts:8` `import * as ort from "onnxruntime-web"` — eager
- **WASM:** `src/search/wasm/ort-wasm-simd-threaded.wasm` (13 MB)
- **Import zinciri:** `tool/registry.ts:57` `import { EmbeddingService } from "@/search/embedding"` — eager
- **Sorun:** Semantic search kullanılmasa bile ONNX runtime ve WASM memory'ye yükleniyor
- `EmbeddingService.layer` (`embedding.ts:215-244`) backend creation'ı lazy yapıyor (config ilk `embed()` çağrısında okunuyor) ama `onnxruntime-web` modülü ve WASM dosyası eager yükleniyor
- `createLocalProvider` (`embedding.ts:155-184`) ONNX inference session oluşturduğunda ek bellek allocate ediyor

### 3. LSP Diagnostic Maps (Per-client, büyüyor)

- **Dosya:** `src/lsp/client.ts:160-164`
- **Maps:** `pushDiagnostics`, `pullDiagnostics`, `published`, `diagnosticRegistrations`, `registrationListeners` + `files` record (`client.ts:301`)
- **Sorun:** Her benzersiz dosya için diagnostic dizisi memory'de kalıyor
- `shutdown()` (`client.ts:683-694`) zaten tüm map'leri temizliyor — ama shutdown çağrılana kadar büyüyor
- InstanceState finalizer'ı (`lsp.ts:212-219`) `client.shutdown()` çağırıyor, yani instance dispose edildiğinde temizleniyor
- **Asıl sorun:** Uzun süreli tek instance'da çok sayıda dosya açıldığında birikiyor, cleanup yok
- Diagnostic'ler dosya kapandığında bile memory'de kalıyor (LSP `textDocument/didClose` handler'ı temizlemiyor)

## Öneriler

### Öneri 1: models-snapshot'ı Provider Bazında Lazy Yap

**Etki:** ~50-100 MB heap kazancı
**Risk:** Orta — provider erişim pattern'lerini değiştiriyor
**Karmaşıklık:** Orta

**Yaklaşım:** `fromModelsDevProvider`'ı çağırmak yerine, raw `ModelsDev.Provider`'ı sakla, sadece erişildiğinde dönüştür.

**Değişiklikler:**

1. `provider.ts:1031` — `database` artık `Record<ProviderID, ModelsDev.Provider>` (raw, dönüştürülmemiş)
2. `fromModelsDevProvider` lazy wrapper oluştur:
   ```ts
   const databaseRaw = modelsDev // raw ModelsDev.Provider record
   const database = new Proxy(databaseRaw, {
     get(target, providerID: string) {
       return fromModelsDevProvider(target[providerID])
     }
   })
   ```
   veya daha sade: `database`'i raw sakla, `mergeProvider` ve `database[providerID]` erişimlerini wrapper fonksiyon ile değiştir.
3. `mergeProvider` (`provider.ts:1054-1065`) ve `database[providerID]` erişimleri (`provider.ts:1061, 1089, 1110, 1199, 1241, 1252`) lazy dönüştürme kullanacak.
4. `providers` record'una kopyalama yerine, sadece aktif provider'lar için dönüştür.

**Alternatif (daha güvenli):** Sadece `enabled_providers`/`disabled_providers` config'ine göre filtrele. Kullanıcının kullanmadığı provider'lar için `fromModelsDevProvider` çağrılmasın. `provider.ts:1072-1073`'te `disabled`/`enabled` set'leri zaten var — bunları `database` oluşturmadan önce uygula.

**Karakterizasyon testleri (Rule 3):**
- `test/provider/` altında mevcut testleri çalıştır: `bun test test/provider/`
- `fromModelsDevProvider` çıktısının aynı kalacağını teyit et
- `Provider.Service.list()` ve `getModel()` çıktıları aynı olmalı

**Doğrulama:**
- `bun typecheck` from `packages/opencode`
- `bun test test/provider/` (mevcut testler)
- Rebuild + RSS ölçümü: JSC-heap'te ~50-100 MB düşüş bekleniyor

---

### Öneri 2: ONNX Embedding'i Dynamic Import Yap

**Etki:** ~15-20 MB heap kazancı (semantic search kullanılmadığında)
**Risk:** Düşük — sadece import timing değişiyor
**Karmaşıklık:** Düşük

**Yaklaşım:** `onnxruntime-web` ve WASM dosyalarını ilk `embed()` çağrısına kadar yükleme.

**Değişiklikler:**

1. `embedding.ts:8` — `import * as ort from "onnxruntime-web"` kaldır
2. `embedding.ts:13-14` — `import ortWasmMjs` ve `import ortWasmBin` static import'larını kaldır
3. `createLocalProvider` (`embedding.ts:155-184`) içinde dynamic import kullan:
   ```ts
   async function createLocalProvider(modelId: string, dimension: number) {
     const ort = await import("onnxruntime-web")
     const ortWasmMjs = (await import("./wasm/ort-wasm-simd-threaded.mjs" with { type: "file" })).default
     const ortWasmBin = (await import("./wasm/ort-wasm-simd-threaded.wasm" with { type: "file" })).default
     // ... mevcut ONNX init kodu
   }
   ```
4. `registry.ts:57-59` — `EmbeddingService` import'u type-only'a çevrilebilir mi kontrol et. `EmbeddingService` Context.Service class olduğu için type-only import yeterli olabilir; `defaultLayer` ayrı dynamic import ile yüklenmeli.
5. `registry.ts:61` — `searchAndEmbeddingLayer`'ı lazy yap. Layer build sırasında değil, ilk semantic search çağrısında yüklensin.

**Dikkat:**
- `embedding.ts:215-244` `layer` zaten backend creation'ı lazy yapıyor, sadece modül yüklemesi eager
- `with { type: "file" }` import'ları `Bun.build --compile` modunda bunfs'e embed ediliyor — dynamic import da aynı path'i çözmeli
- `AGENTS.md` notu: "EmbeddingService config is lazy, not eager" — bu değişiklik o pattern'i tamamlıyor

**Karakterizasyon testleri (Rule 3):**
- `test/search/` altında mevcut testleri çalıştır: `bun test test/search/`
- `EmbeddingService.embed()` çıktısının aynı kalacağını teyit et
- İlk `embed()` çağrısının biraz daha yavaş olacağını (modül yükleme) kabul et

**Doğrulama:**
- `bun typecheck` from `packages/opencode`
- `bun test test/search/` (mevcut testler)
- Rebuild + RSS ölçümü: semantic search kullanılmadan JSC-heap'te ~15-20 MB düşüş bekleniyor

---

### Öneri 3: LSP Diagnostic Maps için Dosya Kapanışında Cleanup

**Etki:** Uzun session'larda değişken (10-100 MB, açılan dosya sayısına bağlı)
**Risk:** Düşük-Orta — LSP protokol davranışını değiştiriyor
**Karmaşıklık:** Düşük

**Yaklaşım:** `textDocument/didClose` handler'ında diagnostic map'lerden dosyayı sil.

**Değişiklikler:**

1. `client.ts` — `textDocument/didClose` notification handler'ı ekle (yoksa):
   ```ts
   connection.onNotification("textDocument/didClose", (params) => {
     const filePath = getFilePath(params.textDocument.uri)
     if (!filePath) return
     pushDiagnostics.delete(filePath)
     pullDiagnostics.delete(filePath)
     published.delete(filePath)
     delete files[filePath]
   })
   ```
2. `client.ts:647-648`'te zaten `pushDiagnostics.delete` ve `pullDiagnostics.delete` var — bu pattern'i `didClose`'a taşı.
3. `files` record'undan da sil (`client.ts:693` pattern'ini kullan).
4. `published` map'inden de sil — dosya kapandığında diagnostic artık geçersiz.

**Dikkat:**
- LSP protokolü `textDocument/didClose` gönderildiğinde server'ın diagnostic'leri temizlemesini önerir ama zorunlu değil
- opencode client tarafında temizlemek, server tekrar diagnostic gönderirse `pushDiagnostics.set` ile yeniden eklenecek — sorun yok
- `shouldSeedDiagnosticsOnFirstPush` (`client.ts:192`) ilk push'ta seed yapıyor — dosya kapanıp tekrar açılırsa seed yeniden yapılır
- `dedupeDiagnostics` (`client.ts:165-166`) her iki map'i okuyor — bir map boşsa `[]` döner, sorun yok
- `Bus.publish(Event.Diagnostics, ...)` (`client.ts:169`) — cleanup sonrası diagnostic event'i göndermeye gerek yok (dosya kapandı)

**Karakterizasyon testleri (Rule 3):**
- `test/lsp/` altında mevcut testleri çalıştır: `bun test test/lsp/`
- Diagnostic akışını test eden mevcut testler var mı kontrol et
- `didClose` sonrası `diagnostics()` çağrısının o dosya için `[]` döndüğünü teyit et
- Dosya tekrar açıldığında diagnostic'lerin yeniden geldiğini teyit et

**Doğrulama:**
- `bun typecheck` from `packages/opencode`
- `bun test test/lsp/` (mevcut testler)
- Uzun session + çok dosya açma senaryosunda RSS ölçümü

---

## Uygulama Sırası

1. **Öneri 2 (ONNX dynamic import)** — en düşük risk, hızlı kazanç
2. **Öneri 3 (LSP cleanup)** — düşük risk, bağımsız değişiklik
3. **Öneri 1 (models-snapshot lazy)** — en yüksek etki ama en karmaşık, sona bırak

Her öneri ayrı commit. Her öneri sonrası:
1. `bun typecheck` from `packages/opencode`
2. İlgili test dizinini çalıştır
3. Rebuild + RSS ölçümü (JSC-heap kategorisi)

## Toplam Beklenen Kazanç

- Öneri 1: ~50-100 MB
- Öneri 2: ~15-20 MB
- Öneri 3: ~10-100 MB (session'a bağlı)
- **Toplam:** ~75-220 MB JSC-heap kazancı

Mevcut 531 MB JSC-heap → hedef ~310-456 MB arası.

## Ölçüm Metodolojisi

Her değişiklik sonrası:

```bash
# Rebuild
cd packages/opencode && bun run build -- --single --skip-install --skip-embed-web-ui

# Çalıştır + ölç
opencode  # yeni session başlat
# ... birkaç dosya aç, birkaç prompt gönder ...
PID=$(pgrep -f "opencode -c" | head -1)
grep -E 'VmRSS|VmSwap' /proc/$PID/status
awk '/^[0-9a-f]/{path="";for(i=6;i<=NF;i++)path=path" "$i;sub(/^ /,"",path);if(path=="")path="[anon]";rss=0}
/^Rss:/{rss=$2}
/^VmFlags:/{if(path~/WKFastMalloc/)t["JSC-heap"]+=rss;else if(path~/JSGigacage/)t["JSC-Gigacage"]+=rss;else if(path~/opencode-linux/)t["binary"]+=rss}
END{for(c in t)printf "%12d KB  %s\n",t[c],c}' /proc/$PID/smaps | sort -rn
```

## Riskler ve Geri Alım

- Her öneri ayrı commit — geri almak kolay
- Öneri 1'de provider erişim pattern'leri değişiyor — `list()` ve `getModel()` çıktıları aynı kalmalı (karakterizasyon testleri ile teyit)
- Öneri 2'de ilk `embed()` çağrısı ~100-200ms daha yavaş (modül yükleme) — kabul edilebilir
- Öneri 3'de LSP protokol uyumluluğu — `didClose` sonrası diagnostic temizliği protokolle uyumlu

## Referanslar

- `provider/provider.ts:977-1009` — `fromModelsDevProvider`
- `provider/provider.ts:1025-1031` — `database = mapValues(modelsDev, fromModelsDevProvider)`
- `provider/models.ts:136-140` — `loadSnapshot` (zaten dynamic import)
- `search/embedding.ts:8,13-14` — eager ONNX import'ları
- `tool/registry.ts:57-61` — eager `EmbeddingService` import
- `lsp/client.ts:160-164,301` — diagnostic maps ve `files` record
- `lsp/client.ts:683-694` — `shutdown()` cleanup (zaten var)
- `lsp/lsp.ts:212-219` — InstanceState finalizer'ı `shutdown()` çağırıyor
