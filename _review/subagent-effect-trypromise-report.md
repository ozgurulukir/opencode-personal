# write/edit Tool'ları Effect.tryPromise Hatası — Genel Sorun

**Tarih:** 2026-08-11
**Durum:** Araştırma/Tespit
**Önem:** Kritik — `write` ve `edit` tool'ları tamamen çalışmıyor

---

## 1. Sorun Tanımı

### Belirtiler
- **Etkilenen:** `write` ve `edit` tool'ları — tüm agent'lar (parent + subagent)
- **Hata:** `An error occurred in Effect.tryPromise`
- **Sonuç:** Hiçbir agent dosya yazamıyor veya düzenleyemiyor
- **Teşhis:** Bu raporu yazarken `write` tool'u da aynı hatayı verdi; rapor `bash` tool ile yazıldı

### Yanılgı
İlk başta sorunun subagent'lara özgü olduğu düşünülüyordu (planner subagent dosya yazamıyordu). Ancak `write` tool'unun parent agent'tan da çağrıldığında aynı hatayı verdiği doğrulandı. **Sorun subagent context aktarımında değil, `write`/`edit` tool'larının kendisinde.**

### Konfigürasyon
`~/.config/opencode/opencode.jsonc`:
```jsonc
"permission": {
  "edit": "allow",   // ← İzin var, ama tool yine başarısız
  "bash": "allow",
  ...
}
```

---

## 2. Kök Neden Analizi

### 2.1 Hata Noktası: `createTwoFilesPatch`

`write.ts:60` ve `edit.ts:100,139,166` — her iki tool da `Effect.tryPromise` ile WASM tabanlı diff fonksiyonunu çağırır:

```typescript
// packages/opencode/src/tool/write.ts:60
const diff = trimDiff(
  (yield* Effect.tryPromise(() => createTwoFilesPatch(filepath, filepath, contentOld, contentNew))) as string,
)
```

`Effect.tryPromise` hatası → `createTwoFilesPatch` (WASM fonksiyonu) throw ediyor.

### 2.2 `createTwoFilesPatch` ve WASM Başlatma

`packages/diff-wasm/src/index.ts:10-69`:

```typescript
let wasmReady: Promise<void> | null = null
let create_two_files_patch_rs: typeof import("../pkg/opencode_diff_rs.js").create_two_files_patch_rs

function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      return mod.init()
    }).then(() => {})
  }
  return wasmReady!
}

export async function createTwoFilesPatch(...): Promise<string> {
  await ensureWasm()  // ← Burada throw olabilir
  return create_two_files_patch_rs(...)  // ← veya burada (undefined ise)
}
```

**İki olası başarısızlık modu:**
1. `ensureWasm()` rejected promise döndürür (WASM yüklemesi başarısız)
2. `create_two_files_patch_rs` `undefined` (modül değişkenleri set edilmedi)

### 2.3 WASM JS Glue Dosya Yolu

`packages/diff-wasm/src/index.ts:3`:
```typescript
const WASM_JS_PATH = (globalThis as any).OPENCODE_DIFF_WASM_JS_PATH ?? "./pkg/opencode_diff_rs.js"
```

**Dev modu:** `OPENCODE_DIFF_WASM_JS_PATH` set edilmedi → `WASM_JS_PATH = "./pkg/opencode_diff_rs.js"`
**Compile modu:** `script/build.ts:325` → `OPENCODE_DIFF_WASM_JS_PATH = bunfsRoot + "diff-wasm/opencode_diff_rs.js"`

Eğer `./pkg/opencode_diff_rs.js` dosyası mevcut değilse veya WASM build edilmemişse:
- `import(WASM_JS_PATH)` → `ModuleNotFoundError`
- `wasmReady` → rejected promise
- `createTwoFilesPatch` → throw
- `Effect.tryPromise` → "An error occurred in Effect.tryPromise"

### 2.4 `Effect.orDie` ve Hata Maskelenmesi

`write.ts:111` ve `edit.ts:173,215`:
```typescript
}).pipe(Effect.orDie),
```

`Effect.orDie` typed error'ları defect'e çevirir. Defect'ler Effect'in default error handler'ına düşer ve **generic mesaj** gösterilir. Gerçek hata (ModuleNotFoundError, TypeError, vs.) maskelenir.

### 2.5 `Effect.tryPromise` ve Hata Sarmalanması

`write.ts:60`:
```typescript
(yield* Effect.tryPromise(() => createTwoFilesPatch(...))) as string
```

`Effect.tryPromise`'a `catch` callback'i verilmediği için, Promise rejection generic bir Error'a sarmalanır:
```
Error: An error occurred in Effect.tryPromise
```

Gerçek hata (örn. "Cannot find module ./pkg/opencode_diff_rs.js") `cause` içinde olabilir ama surface'e çıkmaz.

---

## 3. Tespit Edilen Olası Sorunlar

### Sorun A: `diff-wasm` WASM Modülü Build Edilmemiş (En Olası)

`packages/diff-wasm/pkg/` dizini Rust→WASM compile çıktısı içerir. Eğer `build:wasm` çalıştırılmadıysa:
- `./pkg/opencode_diff_rs.js` dosyası mevcut değil
- `import()` → `ModuleNotFoundError`
- Tüm `write`/`edit` çağrıları başarısız

**Kontrol:**
```bash
ls packages/diff-wasm/pkg/
# opencode_diff_rs.js, opencode_diff_rs_bg.wasm olmalı
```

### Sorun B: WASM Başlatma Race Condition

`packages/diff-wasm/src/index.ts:10-20`:

```typescript
function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      return mod.init()
    }).then(() => {})
  }
  return wasmReady!
}
```

**Race condition:**
- `wasmReady === null` iken iki eşzamanlı çağrı → ikisi de `import()` başlatır
- `mod.init()` eşzamanlı çağrılırsa WASM module bozulabilir
- `wasmReady` rejected promise'a dönüşür → sonraki tüm çağrılar başarısız
- **Hata kalıcı:** `wasmReady` null'a sıfırlanmaz, retry mümkün değil

### Sorun C: `Effect.tryPromise` Hata Mesajı Maskelenmesi

`write.ts:60` ve `edit.ts:100,139,166`:
```typescript
yield* Effect.tryPromise(() => createTwoFilesPatch(...))
```

`catch` callback'i olmadığı için gerçek hata generic mesajla değiştirilir. Bu, debugging'i zorlaştırır.

---

## 4. Olası Çözümler

### Çözüm 1: WASM Modülünü Build Et (Hızlı Fix)

```bash
cd packages/diff-wasm
bun run build:wasm
# veya
wasm-pack build --target nodejs --out-dir pkg
```

**Etki:** `pkg/opencode_diff_rs.js` ve `pkg/opencode_diff_rs_bg.wasm` oluşturur.
**Risk:** Yok — build adımı.

### Çözüm 2: `diff-wasm` WASM Başlatma Race'ini Gider

**Dosya:** `packages/diff-wasm/src/index.ts:10-20`

```typescript
// Mevcut:
function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      diff_lines_rs = mod.diff_lines_rs
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      structured_patch_rs = mod.structured_patch_rs
      return mod.init()
    }).then(() => {})
  }
  return wasmReady!
}

// Önerilen:
function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      diff_lines_rs = mod.diff_lines_rs
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      structured_patch_rs = mod.structured_patch_rs
      return mod.init()
    }).then(() => {}).catch((err) => {
      wasmReady = null  // ← Retry'a izin ver
      throw err
    })
  }
  return wasmReady!
}
```

**Etki:** WASM başlatma başarısız olursa retry mümkün olur.
**Risk:** Düşük — sadece hata durumunda retry sağlar.

### Çözüm 3: `write`/`edit` Tool'larına Hata Mesajını İyileştir

**Dosya:** `packages/opencode/src/tool/write.ts:60` ve `edit.ts:100,139,166`

```typescript
// Mevcut:
const diff = trimDiff(
  (yield* Effect.tryPromise(() => createTwoFilesPatch(filepath, filepath, contentOld, contentNew))) as string,
)

// Önerilen:
const diff = trimDiff(
  (yield* Effect.tryPromise({
    try: () => createTwoFilesPatch(filepath, filepath, contentOld, contentNew),
    catch: (error) => new Error(
      `createTwoFilesPatch failed for ${filepath}: ${error instanceof Error ? error.message : String(error)}`,
    ),
  })) as string,
)
```

**Etki:** Gerçek hata mesajı görünür hale gelir; "An error occurred in Effect.tryPromise" yerine.
**Risk:** Düşük — sadece hata mesajını iyileştirir.

### Çözüm 4: `apply_patch.ts`'e de Aynı İyileştirmeyi Uygula

**Dosya:** `packages/opencode/src/tool/apply_patch.ts:107,162,216`

Aynı `Effect.tryPromise(() => createTwoFilesPatch(...))` pattern'i `apply_patch.ts`'de de var. Çözüm 3'teki gibi `catch` callback eklenmeli.

### Çözüm 5: WASM Modülü Mevcut Değilse JS Fallback Sağla

**Dosya:** `packages/diff-wasm/src/index.ts`

```typescript
// Önerilen: WASM yüklemesi başarısız olursa JS tabanlı diff'e fallback
function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      diff_lines_rs = mod.diff_lines_rs
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      structured_patch_rs = mod.structured_patch_rs
      return mod.init()
    }).then(() => {}).catch((err) => {
      console.warn("[diff-wasm] WASM module failed to load, falling back to JS diff", err)
      wasmReady = null  // Retry'a izin ver
      throw err
    })
  }
  return wasmReady!
}

// JS fallback:
import { createTwoFilesPatch as jsCreateTwoFilesPatch } from "diff"

export async function createTwoFilesPatch(...): Promise<string> {
  try {
    await ensureWasm()
    return create_two_files_patch_rs(...)
  } catch {
    // WASM başarısız — JS fallback kullan
    return jsCreateTwoFilesPatch(oldFileName, newFileName, oldStr, newStr, oldHeader, newHeader, options)
  }
}
```

**Etki:** WASM modülü bozuk/eksik olsa bile `write`/`edit` çalışır.
**Risk:** Orta — JS diff daha yavaş ama doğru çalışır.

---

## 5. Önerilen Uygulama Sırası

| Öncelik | Çözüm | Dosya | Efor | Etki |
|---------|-------|-------|------|------|
| 1 | Çözüm 1 (WASM build) | `packages/diff-wasm/` | 5 dk | Hızlı fix |
| 2 | Çözüm 3 (Hata mesajı) | `write.ts`, `edit.ts` | 15 dk | Gerçek hatayı gör |
| 3 | Çözüm 4 (apply_patch) | `apply_patch.ts` | 10 dk | Tüm diff tool'ları |
| 4 | Çözüm 2 (WASM retry) | `diff-wasm/src/index.ts` | 10 dk | Race condition fix |
| 5 | Çözüm 5 (JS fallback) | `diff-wasm/src/index.ts` | 30 dk | Kalıcı güvenlik |

**Toplam tahmini efor:** ~1 saat

---

## 6. Doğrulama Adımları

### 6.1 WASM Modülü Mevcut mu?
```bash
# diff-wasm pkg dizinini kontrol et
ls -la packages/diff-wasm/pkg/
# Beklenen: opencode_diff_rs.js, opencode_diff_rs_bg.wasm

# Eğer yoksa:
cd packages/diff-wasm
bun run build:wasm
```

### 6.2 WASM Modülü Yükleniyor mu?
```typescript
// packages/diff-wasm/src/index.ts'e debug log ekle (geçici):
function ensureWasm(): Promise<void> {
  if (wasmReady === null) {
    console.log("[DEBUG] ensureWasm: initializing WASM, path:", WASM_JS_PATH)
    wasmReady = import(WASM_JS_PATH).then((mod) => {
      console.log("[DEBUG] ensureWasm: module loaded", !!mod.create_two_files_patch_rs)
      create_two_files_patch_rs = mod.create_two_files_patch_rs
      return mod.init()
    }).then(() => {
      console.log("[DEBUG] ensureWasm: init complete")
    }).catch((err) => {
      console.error("[DEBUG] ensureWasm: FAILED", err)
      throw err
    })
  }
  return wasmReady!
}
```

### 6.3 `write` Tool'unu Test Et
```bash
# TUI'de write tool'unu çağır
# Hata mesajını kontrol et — Çözüm 3 sonrası gerçek hata görünmeli
```

### 6.4 Trace ile Doğrula
```bash
# TUI'yi trace modunda çalıştır
OPENCODE_TRACE=1 bun run dev

# write/edit çağrısı yap
# Trace dosyasında "tool.execute" ve hata kayıtlarını kontrol et
```

### 6.5 Test
```bash
# diff-wasm test'leri
cd packages/diff-wasm
bun test

# opencode tool test'leri
cd packages/opencode
bun test test/tool/
bun typecheck
```

---

## 7. Etkilenen Dosyalar

| Dosya | Satır | Açıklama |
|-------|-------|----------|
| `packages/opencode/src/tool/write.ts` | 60 | `Effect.tryPromise(() => createTwoFilesPatch(...))` |
| `packages/opencode/src/tool/edit.ts` | 100, 139, 166 | `Effect.tryPromise(() => createTwoFilesPatch(...))` |
| `packages/opencode/src/tool/edit.ts` | 178 | `Effect.tryPromise(() => diffLines(...))` |
| `packages/opencode/src/tool/apply_patch.ts` | 107, 112, 162, 167, 216 | `Effect.tryPromise(() => createTwoFilesPatch(...))` + `diffLines` |
| `packages/diff-wasm/src/index.ts` | 3 | `WASM_JS_PATH` tanımı |
| `packages/diff-wasm/src/index.ts` | 10-20 | `ensureWasm()` — race condition |
| `packages/diff-wasm/src/index.ts` | 57-69 | `createTwoFilesPatch` — WASM çağrısı |
| `packages/diff-wasm/src/index.ts` | 51-55 | `diffLines` — WASM çağrısı |
| `packages/diff-wasm/src/index.ts` | 71-84 | `structuredPatch` — WASM çağrısı |
| `packages/opencode/script/build.ts` | 97, 316-325 | WASM build + embed (compile modu) |

---

## 8. Ek Notlar

### 8.1 `Effect.orDie` ve Hata Maskelenmesi
`write.ts:111` ve `edit.ts:173,215` — tool'lar `.pipe(Effect.orDie)` ile sarılı:
```typescript
}).pipe(Effect.orDie),
```
`Effect.orDie` typed error'ları defect'e çevirir. Defect'ler Effect'in default error handler'ına düşer ve generic mesaj gösterilir. Bu nedenle gerçek hata mesajı maskelenmiş olabilir.

### 8.2 `Tool.define` ve `Effect.orDie`
`tool/tool.ts:141`:
```typescript
}).pipe(Effect.orDie, Effect.withSpan("Tool.execute", { attributes: attrs }))
```
`Tool.define` zaten `Effect.orDie` ile sarıyor. Tool implementasyonlarındaki ek `Effect.orDie` (`write.ts:111`, `edit.ts:173`) **redundant** ama hata maskelenmesini pekiştiriyor.

### 8.3 `diff-wasm` Paket Yapısı
```
packages/diff-wasm/
├── src/
│   └── index.ts          ← TS wrapper (ensureWasm, createTwoFilesPatch, vs.)
├── pkg/                  ← Rust→WASM compile çıktısı (build:wasm ile üretilir)
│   ├── opencode_diff_rs.js
│   └── opencode_diff_rs_bg.wasm
├── Cargo.toml            ← Rust proje tanımı
├── src/ (Rust)
│   └── lib.rs            ← Rust diff implementasyonu
└── package.json
```

Eğer `pkg/` dizini boş veya eksikse, `import("./pkg/opencode_diff_rs.js")` başarısız olur.

### 8.4 Compile Modunda WASM
`packages/opencode/script/build.ts:316-325`:
```typescript
"diff-wasm/opencode_diff_rs.js": diffWasmJs,
"diff-wasm/opencode_diff_rs_bg.wasm": new Uint8Array(diffWasmWasm),
// ...
OPENCODE_DIFF_WASM_JS_PATH: bunfsRoot + "diff-wasm/opencode_diff_rs.js",
```

Compile modunda WASM dosyaları bunfs virtual filesystem'e enjekte edilir. Dev modunda ise `./pkg/opencode_diff_rs.js` relative path'i kullanılır.

### 8.5 `diff` Paketi (JS Fallback)
`packages/diff-wasm/src/index.ts:1`:
```typescript
import { formatPatch as jsFormatPatch, parsePatch as jsParsePatch, applyPatch as jsApplyPatch } from "diff"
```

`diff` npm paketi zaten import edilmiş (JS tabanlı diff). `formatPatch`, `parsePatch`, `applyPatch` JS implementasyonu kullanıyor. Sadece `createTwoFilesPatch`, `diffLines`, `structuredPatch` WASM kullanıyor. JS fallback mümkün — `diff` paketinde `createTwoFilesPatch` fonksiyonu mevcut.

---

## 9. Sonuç

**Ana kök neden:** `diff-wasm` WASM modülünün düzgün başlatılmaması. `write` ve `edit` tool'ları `createTwoFilesPatch` çağırdığında, WASM modülü yüklenemiyor ve `Effect.tryPromise` içinde hata fırlatıyor.

**Sorun subagent'a özgü DEĞİL** — tüm agent'lar (parent + subagent) etkileniyor. İlk başta subagent'a özgü olduğu düşünülüyordu çünkü planner subagent'ı dosya yazamıyordu, ancak `write` tool'unun parent agent'tan da çağrıldığında aynı hatayı verdiği doğrulandı.

**Hızlı fix:** Çözüm 1 (WASM build) — `cd packages/diff-wasm && bun run build:wasm`

**Kalıcı fix:**
- Çözüm 3 (hata mesajı iyileştirme) — gerçek hatayı görmek için
- Çözüm 2 (WASM retry) — race condition gidermek için
- Çözüm 5 (JS fallback) — WASM bozuk olsa bile çalışmak için

**Önemli:** Bu rapor `bash` tool ile yazıldı çünkü `write` tool'u çalışmıyor.
