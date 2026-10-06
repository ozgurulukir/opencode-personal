# OpenCode Kişisel Fork

OpenCode, terminalinizde ve tarayıcınızda çalışan açık kaynaklı bir yapay zekâ kodlama ajanıdır. Bu depo, [OpenCode](https://github.com/anomalyco/opencode) projesinin, kaynak projeden bağımsız olarak sürdürülen kişisel bir fork'udur. Resmî bir OpenCode sürümü değildir ve kaynak projenin ekibiyle bağlantılı değildir.

Bu fork, temel OpenCode deneyimini korurken bu depoda sürdürülen değişiklikleri içerir. Özellikler, uyumluluk, destek ve sürüm takvimi kaynak projeden farklı olabilir. Resmî proje için [opencode.ai](https://opencode.ai) adresini veya [kaynak depoyu](https://github.com/anomalyco/opencode) ziyaret edin.

## Neler yapabilir?

- Desteklenen barındırılan ve yerel model sağlayıcılarına bağlanabilir.
- Yerleşik araçlar, yapılandırılabilir izinler ve `AGENTS.md` gibi proje talimatlarıyla bir projeyi inceleyebilir ve değiştirebilir.
- Uzmanlaşmış ajanlar oluşturabilir; eklentiler, beceriler ve MCP sunucularıyla ajanı genişletebilir.
- Çalışma alanını indeksleyebilir ve tam metin aramasının yanında anlamsal kod araması yapabilir.
- Otomatik bağlam sıkıştırma ve araç çıktısı budama ile uzun oturumları yönetebilir.
- Terminal arayüzü, tarayıcı uygulaması ve desteklenen editör entegrasyonları üzerinden çalışmayı sürdürebilir.

Kullanım, yapılandırma, sağlayıcılar ve entegrasyonlar için [fork dokümantasyonuna](https://ozgurulukir.github.io/opencode-personal/) bakın. Üretilen [yapılandırma şeması](https://ozgurulukir.github.io/opencode-personal/config.json) ve [TUI yapılandırma şeması](https://ozgurulukir.github.io/opencode-personal/tui.json) da burada yayımlanır.

## Bu fork neler ekliyor?

Bu fork, OpenCode 1.14.48 kaynak sürümünü temel alır. Aşağıdaki maddeler bu depoda sürdürülen değişiklik ve entegrasyonları listeler; upstream ile eksiksiz bir karşılaştırma değildir:

- `/usage` içinde sağlayıcı kullanımı ve kotalar: Anthropic (Claude), ChatGPT OAuth, ZAI ve ClinePass; her sağlayıcının sunduğu limitler, bakiyeler ve plan ayrıntıları dâhil.
- Düşünme modu yapılandırması ve sağlayıcıya özgü mesaj işleme dâhil Qwen3 uyumluluğu.
- V2 oturum mimarisi ve SDK yüzeyiyle birlikte V1 uyumluluğu.
- İsteğe bağlı otomatik beceri eşleştirmesiyle yerel anlamsal çalışma alanı araması (zvec).
- Hibrit bir fark katmanı (`packages/diff-wasm`): Rust/WASM destekli fark üretimi; JavaScript uyumlu patch biçimlendirme, ayrıştırma, uygulama ve fallback’ler.
- ACP (Agent Client Protocol) terminal arka ucu desteği (ör. Zed).
- TUI iyileştirmeleri: soluk metin olarak gösterilen sonraki istem önerileri, kabuk `!` çıktısının görüntülenmesi ve ortak bir yükleme göstergesi.
- İzin sistemi iyileştirmeleri: MCP araç anahtarları, izin isteklerinde ret önceliği, kalıcı "her zaman izin ver" ve geliştirilmiş alt ajan izin yönetimi.
- Güvenlik sertleştirmeleri arasında webfetch aracında SSRF koruması, sıkı CORS kaynak doğrulaması, sembolik bağlantıları çözen yol sınırları, kabuk komutlarında ayrıştırma ve izin kontrolleri, okuma aracında sembolik bağlantıyla izin verilen dizinin dışına çıkmanın önlenmesi, TUI çıktı sızıntısının önlenmesi ve kriptografik tohumlu diyalog/istek kimlikleri bulunur.
- İstem/oturum motoru yeniden düzenlemeleri: istem orkestrasyonunun odaklı modüllere ayrılması ve sağlayıcı mesaj dönüşümlerinin sorumluluklarına göre bölünmesi.
- Otomatik bağlam sıkıştırma iyileştirmeleri: `context_limit` yapılandırması, özet bütçesi ve meta verilerin korunması.
- Performans odaklı değişiklikler arasında hedefli oturum özeti sorguları, olay döngüsü/backpressure yönetimi, toplu veritabanı yazımları ve gömülü arayüz önbelleği bulunur.
- Monorepo/derleme/CI bakımı: takip edilen paketlerin sadeleştirilmesi, tip denetimi iş akışı ve daha sıkı bağımlılık güncelleme kontrolleri.
- Araçlar: birden fazla beceri yükleme, uyarılarla beceri doğrulama ve yapılacak işlerin otomatik kapatılmasıyla entegre değişiklik bloğu farkları.

## Kurulum

Hazır ikili dosyalar, bu fork'un [GitHub sürümlerinde](https://github.com/ozgurulukir/opencode-personal/releases) Linux (x64/arm64, glibc ve musl), macOS (x64/arm64) ve Windows (x64/arm64) için yayımlanır.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/ozgurulukir/opencode-personal/main/install.ps1 | iex
```

Her iki betik de **`opencode-personal`** komutunu kurar ve PATH değişkeninize yalnızca kendi dizinini ekler: macOS/Linux üzerinde `~/.opencode-personal/bin`, Windows üzerinde `%USERPROFILE%\.opencode-personal\bin`. Fork, mevcut bir kaynak proje `opencode` kurulumuyla birlikte çalışacak şekilde tasarlanmıştır: `~/.opencode`, `~/.local/bin/opencode` veya mevcut PATH girdilerine dokunmaz; derleme sırasında belirlenen `personal` kanalı üzerinden oturumları kendi veritabanında (`opencode-personal.db`) saklar. Yapılandırma (`opencode.json`, kimlik doğrulama bilgileri) kaynak projeyle bilinçli olarak paylaşılır. Dikkat: `OPENCODE_DISABLE_CHANNEL_DB` veya `OPENCODE_DB` ortam değişkenlerini ayarlarsanız veritabanlarının ayrılmasını sizin yönetmeniz gerekir.

Belirli bir sürümü kurmak için `--version <v>` (bash) veya `-Version <v>` (PowerShell) kullanın (fork sürümleri takvim tabanlıdır, ör. `2026.9.29`). Yerel bir derlemeyi kurmak için `--binary <path>` / `-Binary <path>` kullanın (bu durumda paketle gelen `libopentui.*` / `opentui.dll` dosyasını da ikili dosyanın yanına kopyalayın). PATH düzenlemesini atlamak için `--no-modify-path` (bash) kullanın. Not: `install.ps1` betiğinde **PATH düzenlemesini atlayan bir seçenek yoktur**; kurulum dizinini her zaman kullanıcı PATH değişkenine ekler. İstemiyorsanız bu girdiyi elle kaldırın. Windows ikili dosyaları imzasızdır; SmartScreen uyarı gösterebilir. "Daha fazla bilgi" → "Yine de çalıştır" seçeneğini kullanın. Fork sürümleri takvim tabanlıdır (`YYYY.M.D`, ör. `2026.9.29`): aynı gün yeniden yayımlamak aynı sürümü ve etiketi kullanır, sürüm dosyalarının üzerine yazar; daha sonraki bir gün yayımlamak yeni bir sürüm oluşturur.

Kaldırma: `~/.opencode-personal` dizinini (Windows: `%USERPROFILE%\.opencode-personal`) silin ve kabuğunuzun rc dosyasından `# opencode-personal` PATH satırını kaldırın (Windows: dizini kullanıcı PATH değişkeninizden kaldırın).

### Elle indirme

[Sürümler sayfasından](https://github.com/ozgurulukir/opencode-personal/releases) bir arşiv indirin, açın, `opencode` ikili dosyasını `opencode-personal` olarak yeniden adlandırın (paketle gelen yerel kütüphaneyi, `libopentui.*` / `opentui.dll`, aynı dizinde tutun) ve bu dizini PATH değişkeninize ekleyin.

### Kaynaktan çalıştırma

[Bun](https://bun.sh/) kurun (depo Bun 1.4.2 sürümünü hedefler), ardından depoyu klonlayıp çalışma alanının bağımlılıklarını yükleyin:

```bash
git clone https://github.com/ozgurulukir/opencode-personal.git
cd opencode-personal
bun install
bun dev
```

Terminal arayüzünde `/connect` ile bir model sağlayıcısına bağlanın veya `opencode.json` içinde bir sağlayıcı yapılandırın. Seçtiğiniz sağlayıcının kimlik doğrulama bilgilerine ihtiyacınız olacaktır.

## Geliştirme

Bu depo bir Bun çalışma alanı monorepo'sudur. Depo kökünden çalıştırılan yaygın komutlar:

| Komut | Amaç |
| --- | --- |
| `bun dev` | OpenCode'u kaynaktan çalıştırır. |
| `bun run dev:web` | Tarayıcı uygulamasını başlatır. |
| `bun run --cwd packages/web dev` | Astro/Starlight dokümantasyon sitesini başlatır. |
| `bun run dev:storybook` | Arayüz Storybook'unu başlatır. |
| `bun run lint` | Çalışma alanının lint denetimini yapar. |
| `bun run typecheck` | Çalışma alanındaki paketlerin tip denetimini yapar. |
| `bun run --cwd packages/web build` | Statik dokümantasyon sitesini derler. |

## Depo yapısı

| Paket | İçerik |
| --- | --- |
| `packages/opencode` | CLI, terminal arayüzü, sunucu, araçlar, sağlayıcılar ve ajan çalışma zamanı. |
| `packages/app` | Tarayıcı uygulaması. |
| `packages/ui` | Paylaşılan arayüz bileşenleri. |
| `packages/core` | Paylaşılan çalışma zamanı yardımcıları ve temel yapıları. |
| `packages/sdk/js` | JavaScript/TypeScript SDK. |
| `packages/web` | İngilizce ve Türkçe dokümantasyon sitesi. |

## Lisans

Bu proje MIT Lisansı altında dağıtılır. Gerekli telif hakkı ve izin bildirimi için [LICENSE](./LICENSE) dosyasına bakın. Kaynak projenin telif hakkı atfı bu dosyada korunmuştur.
