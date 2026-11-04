# biblio-mcp: аудит сокращения кода и DX/AX

## Основание и границы проверки

Проверена ветка `main` репозитория [`vernikr/biblio-mcp`](https://github.com/vernikr/biblio-mcp), зафиксированная на коммите [`e9b30ca60de1f954e91f69fcd66735f526f18b30`](https://github.com/vernikr/biblio-mcp/commit/e9b30ca60de1f954e91f69fcd66735f526f18b30), версия пакета `1.8.0`. Дата проверки — 8 октября 2026 года.

Исходники, скрипты, CI, документация и тесты прочитаны; существенные подозрения проверены отдельными локальными сценариями. В ходе исходного аудита исправления не вносились; статус последующего исполнения приведён в разделе 5. Для исходного аудита GitHub использовался только для чтения; последующий push выполнен по прямому указанию пользователя. Переданный ключ в файлы и отчёт не включён.

Проверки на Node `20.20.2`, pnpm `12.10.1`:

- `pnpm install --frozen-lockfile` — успешно;
- `pnpm run typecheck` — успешно;
- `pnpm run test` — **167/167**, без skipped/todo, около **10,8 с на тестовый runner**; сборка занимает дополнительное время;
- `node scripts/preflight.mjs --require-build` — успешно;
- реальный stdio initialize/list/call — отвечает;
- запросы к живым библиотекам, live selfcheck и live benchmark **не запускались**. Выводов о текущей доступности зеркал здесь нет.

Сопоставимый объём `.ts`/`.mjs`, включая пустые строки:

| Область | Файлов | Строк | Comment-only строк¹ |
|---|---:|---:|---:|
| `src/` | 17 | 3 182 | 305 |
| `scripts/` | 7 | 733 | 54 |
| `test/` | 30 | 3 814 | 238 |
| **Всего** | **54** | **7 729** | **597** |

¹ Приблизительный подсчёт строк, начинающихся после пробелов с `//`, `/*`, `*`, `*/`. HTML-фикстуры и Markdown не входят. Отдельно: README — 534 строки, AGENTS — 92, STATE — 42, decisions — 60, исторический worklog — 656.

## Главный вывод

**Нужен точечный второй проход, а не новая архитектура.** Основные большие рефакторинги старого аудита уже выполнены: `Promise.any`, общий `probeGroup`, кэш, единая MD5-схема, реестр настроек и `TOOL_META` уже существуют. Предлагать их заново было бы неактуально.

Основной безопасный резерв сокращения — MCP-boilerplate и повторные проверки в тестах, повторный разбор одной страницы Libgen, невостребованные поля HTTP-ошибки и повторение исторических объяснений в документации. Крупного доказанно мёртвого runtime-подмодуля не обнаружено: `noUnusedLocals`/`noUnusedParameters` уже включены для `src/`.

Важнее сначала закрыть несколько дыр в реальном install/download-пути. Зелёные 167 тестов их не обнаруживают: часть тестов проверяет описание или подготовленный checkout вместо заявленного поведения.

**Приоритеты:** P1 — установка и сохранность файлов; P2 — диагностика, корректность, безопасные сокращения и готовые релизные артефакты; P3 — необязательные изменения контрактов/поддерживаемых платформ.

### Согласованное уточнение: готовый продукт вместо обязательного checkout

В последующем обсуждении пользователь принял рекомендацию распространять **один локальный stdio runtime двумя каналами: готовый npm-пакет и MCPB**. Для пакетного варианта рассматривается pnpm-first workflow. Готовые npm/MCPB-релизы пока не выпущены, публикация не выполнялась, npm scope/имя ещё предстоит подтвердить. Исправления первого этапа запушены в GitHub `main`; статус — в разделе 5.

- **Разработка и сборка:** pnpm, фиксированная версия инструмента, frozen lockfile; CI выпускает уже собранный JavaScript.
- **Пакетный запуск:** `pnpm dlx` для пользователей pnpm; `npx` остаётся совместимым альтернативным launcher. Это один артефакт из npm registry, а не два разных пакета. В релизной инструкции закреплять конкретную проверенную версию.
- **Десктопная установка:** `.mcpb` из той же сборки для поддерживающих клиентов. Не переписывать providers/tools и не делать отдельный runtime.
- **Исходники:** clone/install/build остаются developer-путём, а не основным consumer Quick start. Пользователь не должен вручную хранить checkout; пакет/расширение хранится и запускается установочными инструментами.
- **README:** один раздел установки с выбором «готовый пакет / десктопное расширение»; pnpm/npx — короткие варианты одной пакетной инструкции. Development вынести отдельно, не повторять clone/cd в нескольких местах.
- **Remote hosting, Docker и отдельные platform-specific binaries:** не первая очередь; сохранить локальное сохранение книг без облачной инфраструктуры.

Это уточняет прежний условный R7: пакетные `bin/files` и installed-package поддержку нужно не удалять, а довести до рабочего состояния. Решение удалить legacy installer целиком пока не принято; F1/F2 остаются актуальными для сохраняемого source-пути. Не добавлять автоопределяющий pnpm/npm shell-wrapper или новый installer framework.

**Новый этап между PR 2 и PR 3 — релизная упаковка:** проверить scope/name-sensitive определение версии, убрать из проверки готового пакета/бандла требования к checkout/lockfile, включить необходимые файлы selfcheck. Проверять реальную `.tgz` после установки вне репозитория и реальный MCPB, а не только `dist` в рабочей копии. Оба пакетных launcher должны проходить настоящий stdio initialize/list/call, без build/TS/dev tools и интерактивных подтверждений. Книги сохраняются в пользовательский каталог, не в кэш программы. Политики безопасности pnpm не отключать глобально; учитывать их в инструкции и тестировании первого запуска. MCPB tooling допустим как build-time инструмент, без новых runtime dependencies.

Официальная документация pnpm: [`pnpm dlx` / `pnx`](https://pnpm.io/cli/pnx).

## 1. Подтверждённые проблемы, влияющие на DX/AX

### F1 · P1 · Первый запуск инсталлятора не устанавливает зависимости

**Где:** [install.mjs:106–127][install-order], [preflight.mjs:163–185][preflight-deps].

Инсталлятор запускает блокирующий preflight **до** `pnpm install`. На чистом checkout preflight закономерно возвращает `dependencies: missing` и `zod is not installed`; до установки выполнение не доходит.

**Проверено:** копия исходников без `node_modules`/`dist`, с pnpm на PATH → exit 1, `node_modules` не создан. Это противоречит главному quick start. Текущий end-to-end тест запускает installer из уже подготовленного checkout и потому не ловит проблему.

**Минимальное исправление:** существующие проверки Node/pnpm оставить до установки; затем `pnpm install --frozen-lockfile` → dependency preflight → build → offline tool check → config. Не добавлять отдельную сложную систему pre-install режимов.

**Приёмка:** новый тест реально начинает без зависимостей/сборки; отдельно сохраняется отказ на несовместимой паре SDK/Zod после установки. Для регулярного офлайн-прогона допустима заранее подготовленная локальная package-store, но не заранее установленный checkout.

### F2 · P1 · Installer сообщает успех, но не добавляет сервер в конфиг

**Где:** [install.mjs:243–258][config-write].

`mcpServers: []` проходит проверку `typeof === "object"`. Присваивание `array.biblio = entry` не попадает в `JSON.stringify`.

**Проверено реальным installer:** вход `{"mcpServers":[]}` → exit 0, `install complete`, backup создан, но итоговый `mcpServers` остаётся `[]`, записи `biblio` нет.

**Исправление:** различать отсутствующий `mcpServers` и некорректный существующий; отвергать массив/null/скаляр, не заменять молча чужие данные. Проверять форму до backup/write. Нужны несколько простых проверок, не полноценная библиотека конфигураций.

**Приёмка:** неправильная форма → ненулевой exit и неизменный конфиг; правильная форма → новая запись и сохранение чужих серверов.

### F3 · P1 · Обещание «filename никогда не перезаписывается» не атомарно

**Где:** [server.ts:311–339][download-commit].

Между `access()` и финальным `rename()` файл может создать другой процесс или второй tool call. `rename()` затем заменит его. Уникальный staging решает конфликт временных файлов, но не конфликт конечного имени.

**Проверено:** локальный download endpoint создаёт `mine.pdf` после precheck, до окончания скачивания → `saved: true`, пользовательский файл заменён. Существующий тест проверяет только файл, созданный **до** вызова.

**Исправление:** для явно заданного имени использовать атомарную публикацию без замены. Например, `link(staging, destination)` с обработкой `EEXIST`, затем удалить staging; он уже находится в том же каталоге. Ошибку публикации не трактовать как повод скачивать тот же файл с другого зеркала. Если hard links не поддерживаются выбранной файловой системой — явно отказать, а не возвращаться к небезопасному `rename`.

**Приёмка:** файл, появившийся во время скачивания, сохранён; при двух конкурентных загрузках в одно custom-имя ровно одна публикует результат; временные файлы убраны. Политику замены автоматически выбранного `<md5>.<ext>` обсуждать отдельно.

### F4 · P2 · Разные части проекта обещают разные download-timeout semantics

**Где:** [http.ts:358–456][download-http], [config.ts:45–49][config-download], [STATE.md:18–19][state-timeout].

Фактически `BIBLIO_DOWNLOAD_TIMEOUT_MS` ограничивает получение заголовков; после них request timer снимается. Для файла остаётся только idle watchdog. Комментарий `opts.timeoutMs` это признаёт, но help говорит «Timeout for fetching a file», а STATE обосновывает отдельный путь таймером на весь body.

**Проверено:** бюджет 150 мс, данные приходят каждые 60 мс, stall budget 1 с → файл успешно записан через 636 мс. Это доказательство текущей семантики, а не утверждение, что длительное скачивание само по себе ошибочно.

**Рекомендация:** выбрать единый контракт. Если timeout — общий deadline загрузки, держать один timer до завершения pipeline, оставив отдельный idle watchdog. Если нужен только header timeout — исправить help/README/STATE и название внутренней переменной. Не менять контракт молча.

**Приёмка:** раздельные тесты «нет заголовков», «body завис», «body поступает, но общий бюджет исчерпан» либо явно документированный header-only вариант; успешная медленная загрузка в пределах выбранного бюджета.

### F5 · P2 · Недоступность источников неотличима от отсутствия download links

**Где:** [providers/index.ts:225–260][resolve-downloads], [server.ts:265–267][links-tool].

`resolveDownloads` отбрасывает rejected-результаты `allSettled`; `fastDownload` дополнительно сворачивает все свои неудачи в `null`. `get_download_links` возвращает успешный пустой список без причин.

**Проверено:** все источники отвечают 503 и все отвечают 404 → одинаковые `{md5,count:0,links:[]}`, `isError: false`.

**Исправление:** возвращать из резолвера небольшой `{links, errors}` и передавать диагностические причины в оба download-инструмента. Частичный успех сохранять; not-found не считать source outage; отсутствие необязательного member key не считать ошибкой. Для полного провала доступных источников выставлять `isError`.

Сначала достаточно существующего `SourceError` + `summarizeSourceFailure`, без нового сложного error protocol. Отдельно убрать `resolvedVia: "libgen"` из полного провала `bookDetails`: [сейчас][failed-details] этот маркер стоит даже без успешного результата.

**Приёмка:** три различных случая: ссылки найдены частично; запись отсутствует; источники недоступны. Ошибки короткие и не раскрывают API keys/signed URL query strings.

### F6 · P2 · Первый Sci-Hub HTTP 200 без PDF блокирует рабочее зеркало

**Где:** [scihub.ts:11–14, 23–64][scihub-resolve], [http.ts:298–304][mirror-winner].

Challenge проверяется до выбора победителя, а наличие PDF — после. Первый ответ без PDF выигрывает HTTP race; остальные отменяются, и resolver выдаёт not-found, даже если другое зеркало содержит статью.

**Проверено:** первое локальное зеркало — обычный HTTP 200 без PDF, второе — страница с PDF → `ResourceNotFoundError`, второе зеркало не было запрошено.

**Исправление:** завершать попытку зеркала только после определения полезного результата. Семантический record miss должен позволять попробовать другое зеркало, но не охлаждать здоровый host/открывать source circuit. Не дублировать весь PDF-парсер в validator: нужен один небольшой путь извлечения результата внутри попытки.

**Приёмка:** mixed no-PDF/PDF → PDF; все no-PDF → not-found; все challenge → unavailable; отмена проигравшего запроса не становится source failure.

### F7 · P2 · Маленькие настройки с большим эффектом на отладку

**Где:** [config.ts:12–25][number-settings], [http.ts:29–31, 221–226][mirror-settings].

- `BIBLIO_MIRROR_STAGGER_MS=0` читается как fallback **120**. Комментарий обещает нулевую задержку; многие тесты выставляют `0`, считая race одновременным.
- Для пустого `zlibrary` `fetchFromMirrors` советует **`BIBLIO_ZLIBRARY_MIRRORS`**, хотя реальная настройка — **`BIBLIO_ZLIB_MIRRORS`**. Литераловый doc-drift тест динамически построенное имя не обнаруживает.

**Оба случая воспроизведены.** Разрешить ноль только у stagger, сохранив положительные timeout/TTL. Не выводить имя настройки из SourceId без учёта исключения; использовать существующие имена настроек. Проверять поведение и текст исправления, не только наличие имени в README.

### F8 · P2 · Smoke check и несколько тестов дают ложное чувство покрытия

**Где:** [ci.yml:57–86][ci-smoke], [install.test.mjs:52–78][startup-tests], [agent.test.mjs:167–185][path-test].

- CI ищет `search_books` и `md5` во всём stdout. Оба присутствуют в `tools/list`; ответ именно на `tools/call` не проверяется.
- **Проверено:** из настоящего stdout удалён ответ с `id:3` → все нынешние grep-проверки всё ещё проходят.
- Тест «entry point refuses…broken» на деле вызывает `--version` и обходит startup guard.
- Тест «startup check can be bypassed…» проверяет healthy selftest; `parsed.ok || parsed.fix` после `parsed.ok === true` — тавтология.
- Тест «reports resolved directory» читает описание схемы, а не результат сохранения файла.

**Исправление:** один нормальный stdio integration test через SDK Client/StdioClientTransport с проверкой call result; выполнить его обычным runner, убрать shell-grep дубликат из CI. Неправильно названные тесты переименовать либо заменить настоящими отрицательными/поведенческими сценариями. В `selfcheck` и startup переиспользовать одну проверку tool surface, которая подтверждает именно ожидаемую ошибку валидации.

Существующий CI-тест с **реально несовместимыми SDK/Zod** не удалять: он действительно проверяет исторический сбой и не равен этим слабым unit tests.

### F9 · P2 · Пустая строка запускает сетевой поиск

**Где:** [server.ts:209, 387, 412–414][query-schemas].

`query`/`identifier` — просто `z.string()`. **Проверено:** `search_books({query:"   ",sources:["libgen"]})` делает provider request и возвращает обычный успешный ответ.

**Исправление:** переиспользуемая `z.string().trim().min(1)` с контекстными `.describe()` для двух поисков и identifier. Это почти не увеличивает код и прекращает бесполезный agent retry loop до сети.

**Приёмка:** пустые/пробельные значения → читаемая argument error, ноль provider requests; обычные DOI/URL/query сохранены.

## 2. Где сокращать код без удаления полезного поведения

| Изменение | Конкретные места | Предлагаемый небольшой рефакторинг |
|---|---|---|
| **R1. MCP lifecycle в тестах** | `agent:11–22`, `server:19–30`, `tool-meta:12–23`, `safe-output:44–54`, `download-filename:43–53`, `download-races:45–57`, inline-копии в `providers`/`circuit`/`details` | Один `test/helpers/mcp.mjs`. Принимать factory сервера, чтобы helper не импортировал provider graph до env overrides. Оставить настройку конкретного теста в callback. `src/selfcheck` уже имеет lifecycle helper — не записывать это как новый runtime-рефакторинг. |
| **R2. Повторные metadata-проверки и ручной JSON Schema validator** | `agent.test:41–84`; `tool-meta.test:48–72`; `details.test:77–112` | Убрать действительно перекрывающиеся assertions после усиления основных. Ручную проверку части JSON Schema заменить `AjvJsonSchemaValidator` из **уже установленного SDK**: меньше кода и полная проверка boolean/enum/integer/arrays и т. д. Чистые `isUsefulLink` тесты перенести к `parse`, без дочерних процессов и загрузки всего provider graph. |
| **R3. Двойной parse Libgen** | [libgen.ts:261–323][libgen-details] | `details()` делает `cheerio.load`, затем `downloadLinks(md5,{html,base})` делает второй `cheerio.load`. Вынести короткий чистый `extractDownloadLinks($,base)` и вызывать с готовым DOM. После адаптации теста `url-resolution:48` можно убрать public `reuse`-параметр. Это экономит работу, а не только строки. |
| **R4. Невостребованный payload HTML-ошибки** | [http.ts:317–339, 395–409][html-error] | `status/contentType/bytes/snippet` у `HtmlInsteadOfFileError` не читаются ни одним потребителем проекта; используется класс и message. При явно HTML Content-Type отменять body и сразу выдавать короткую typed error вместо чтения всей страницы ради snippet. Сохраняется запрет записывать HTML, исчезают лишний body timer и диагностический payload. При non-2xx также освобождать unread body. |
| **R5. Узкий single source of truth и мелкие остатки** | `types.ts:4`, `providers/index:26,47–54`, `server:211`; `annas:13`; `parse:100,130–131`; `libgen:141–142`; `server:462`, `providers/index:263–268` | Использовать существующий список book sources как readonly tuple для типа/schema/регистрации, без нового plugin registry. В Anna's validator использовать уже имеющийся `ANNAS_IDENTITY`, а не повторять regex. Удалить невозможную проверку `parts.length===0` после `split`; неверный комментарий про порядок колонок; orphan scimag JSDoc у `forEachRow`; лишний `toLowerCase()` перед `/i`-regex. Убрать неподтреблённые forwarding exports, обновив тестовые импорты. |
| **R6. HTTP-test boilerplate** | `details:56–67`, `http:27–46,249–271`, `speed:75–96`, `annas-key:40–55`, `scihub-challenge:26–43` | Использовать уже имеющиеся `listenLocal`/`closeServer`. Не унифицировать сами route fixtures в сложный DSL. Удалить двойной `closeAllConnections()` в `http.test:269–270`. |

Для R2 проверено на текущем SDK: все семь настоящих примеров проходят его validator; `resolvePdfs:"yes"` корректно отвергается. Сейчас ручная проверка в `tool-meta.test` boolean не проверяет.

**Не считать мёртвым автоматически:** `mirrorCacheSnapshot` используется тестами; fallback `AbortSignal.any` связан с объявленной поддержкой Node; installed-package ветка preflight и packaging-поля намеренно сохранены предыдущими решениями. Простой поиск «нет production callers» здесь недостаточен.

**Условное дополнительное сокращение R7 · P3:** installer поддерживает clone/`--repo`/`--dir`/`--force-clone` и npm fallback, хотя основной документированный путь — запуск из source checkout с pnpm. Если эти альтернативные пути больше не нужны, source-only installer заметно проще. Но это сокращение поддерживаемой функциональности, не доказанно мёртвый код; сначала подтвердить решение. Аналогично не выкидывать `bin/files`/installed-package поддержку только из-за `private:true`.

## 3. Улучшения developer/agent experience с небольшим бюджетом кода

### X1 · P2 · Один предсказуемый offline gate и одна сборка

[Сейчас][package-scripts] `verify` делает build, затем `test` делает build ещё раз; CI повторяет это. `verify` также запускает live mirror selfcheck, поэтому не является детерминированным gate для изолированного агента.

Предлагаемая схема:

- `test` по-прежнему самостоятельно строит проект и запускает offline suite;
- `verify` → typecheck + **один** build/test + offline tool-surface selfcheck;
- `verify:live` либо отдельная документированная последовательность → offline gate + live selfcheck;
- добавить небольшой `--selfcheck --offline`, сохранив существующую семантику обычного `selfcheck` и `--live`;
- объединить дублирующиеся tool-surface части `runToolsStage`/`runStartupSelftest`;
- после этого installer может вызвать готовый offline CLI check вместо встраивания программы `node -e`, JSON parsing и отдельного формата ошибок.

Не нужен новый task runner: достаточно package scripts и небольшого изменения существующего selfcheck. Приёмка — offline gate работает без доступа к зеркалам, сборка одна, installer/startup по-прежнему проверяют tools/call.

### X2 · P2 · Команды обслуживания должны работать с первого раза

- `sync-env-docs.mjs` импортирует **dist/config.js**, а инструкция предлагает запускать его сразу после изменения **src/config.ts**. Он может переписать README по старой сборке. Добавить `docs:env` = build + существующий sync script, и ссылаться на эту команду из AGENTS/STATE/error hint. Не создавать ещё один генератор.
- Объявленный минимум Node `>=18` шире требования установленного `cheerio@1.0.0` — **`>=18.17`**. Уточнить поддерживаемый минимум одновременно в engines, installer, preflight, документации и проверках. Переход на только современные LTS — отдельное решение, не скрытая часть «сокращения».
- Если поддерживается Windows, динамические imports в installer/sync script строить через `pathToFileURL`, а не абсолютный filesystem path. Это точечная правка; Windows запуск в этом аудите не проверялся.
- `.editorconfig` с UTF-8/LF/2 spaces достаточно для начала. Большой ESLint/Prettier стек ради косметики сейчас не окупается.

### X3 · P2/P3 · Более короткий и честный MCP-контракт

- Сократить `TOOL_META` до назначения, важных входов/ограничений и следующего шага. Подробности вроде BibTeX и peak memory не нужны агенту в каждой tool description.
- Исправить обещание обязательного MD5: `Book.md5` optional, Z-Library его не возвращает. Явно говорить «используйте md5, если он есть».
- Добавить небольшие MCP annotations там, где семантика действительно известна: сетевые lookups и локальное сохранение файла различаются. Не помечать member-link resolution как безусловно read-only/idempotent, не разобравшись с расходом квоты.
- Используемый `server.tool` помечен deprecated в текущем SDK. При изменении annotations можно перейти на плоский `registerTool`, но не вводить собственный framework регистрации семи инструментов.
- `structuredContent`/полные output schemas оставить вторым шагом, если они реально нужны клиентам: JSON-text сейчас совместим, а дублирование payload и большие выходные схемы не соответствуют цели сокращения.
- Приватный SDK validation override пока не переписывать ради чистоты: он уже сохраняет single-parse и читаемые ошибки. Оставить pinned SDK и негативные контрактные проверки.

## 4. Документация и комментарии: что именно исправить/удалить

### Доказанная неактуальность

| Где | Что не совпадает с текущим проектом | Минимальная правка |
|---|---|---|
| [README:156–158][readme-cli] | Installer якобы печатает `claude mcp add` line; реально печатает JSON snippet | Исправить текст, не добавлять ещё одну output-ветку ради старого обещания |
| [README:414–416][readme-scihub] | При полном Sci-Hub failure якобы возвращаются fallback URLs | Описать реальную ошибку; поле `mirrors` существует в успешном результате, не в этом failure path |
| [README:410–413][readme-zlib] | Один override `BIBLIO_ZLIB_MIRRORS` якобы включает Z-Library | Разделить выбор источника и список его зеркал; указать explicit `sources` либо изменение disable list |
| README:225; `TOOL_META.search_books` | Каждый результат якобы содержит md5 | Уточнить optional MD5 |
| README:405–409 | Исключение для непрозрачных verified member URLs потеряно, хотя оно есть в таблице tools | Свести правило ссылок к одной краткой формулировке с обеими exceptions |
| README:208–212 | Образец argument error — старый формат «It needs…» и сокращённый невалидный hash | Удалить длинную копию сообщения или заменить актуальным коротким примером |
| AGENTS:3,46–48 | «private source fork» неоднозначно; tool descriptions направляют в server.ts, хотя они в toolmeta.ts | Отличать private package от public repo; поправить путь для нового провайдера |
| STATE:18–19 | Причина отдельного download fetch описана через whole-body timer, которого сейчас нет | Синхронизировать после решения F4 |
| [worklog:7–12,44–48,602–605][old-worklog] | «Текущий статус» говорит, что A16 открыт, и описывает последовательное enrichment; нынешний код уже другой | Пометить как snapshot **конца волны 1**, убрать претензию на current backlog; текущие ссылки вести в STATE |
| [dependabot.yml:28–40][dependabot] | Комментарий обещает major update внутри grouped PR; `ignore` исключает эти обновления вообще | «Major upgrades выполняются вручную»; сократить историю прежнего SDK/Zod сбоя |
| CI:42–43; tsconfig | «Typecheck source and scripts», но `tsc --noEmit` проверяет только src | Переименовать step; расширение JS typecheck делать только отдельным осмысленным решением |
| src/parse.ts:130–131; src/providers/libgen.ts:141–142 | Комментарий о порядке Title неверен; JSDoc scimag прикреплён к row iterator | Удалить/переставить, не раздувать объяснение |

### Дубли и излишняя длина

1. **README: оставить один install recipe и одну причину существования fork.** Сейчас Quick start, One command и Manual install повторяют clone/cd; «Why this fork», «What is…», «About this fork», сравнительная таблица и FAQ повторяют те же преимущества.
2. **«Known limitations» оставить про текущие ограничения.** Истории неправильного author, рекламы на домене, двух lockfiles и старых эвристик — в worklog/CHANGELOG, не в нескольких сегодняшних разделах.
3. **decisions: убрать повтор второй волны.** Пункты про credentials, circuits, mirrors, tool metadata уже есть выше; дополнить исходный пункт вместо дублирующего append. Исторические LOC-расчёты перенести в worklog, оставив принцип «не удалять coverage ради LOC».
4. **STATE не должен повторять весь command guide AGENTS.** Оставить текущие открытые действия и ограничения плюс ссылки. «Deliberately not done» отделить от настоящего backlog.
5. **Комментарии CI/Dependabot сжать до инвариантов.** История `_parse is not a function` уже описана в нескольких документах. Сохранить короткое объяснение, почему нужен tools/call и почему live job non-blocking.
6. **Не править исторические releases в CHANGELOG под сегодняшние цифры.** Worklog и captures сохранить; архивировать статус, а не переписывать доказательства задним числом.

Ориентир: README **300–350 строк вместо 534**, без потери install/config/tools/limitations/legal. Это цель читаемости, не жёсткий LOC gate.

## 5. План исполнения

### Статус на 9 октября 2026 года

**Постоянное указание пользователя:** здесь и далее все завершённые изменения репозитория пушить прямо в `vernikr/biblio-mcp:main`, без отдельного PR. Перед push проверять актуальную `main`, сохранять чужие коммиты, проверять итоговый код; force-push не использовать. Credentials передавать временно, не помещать в URL, историю Git, отчёты или файлы. Публикация npm/MCPB — отдельный релизный шаг.

**PR 1 выполнен и запушен в GitHub `main`:** F1/F2/F3, три отдельных коммита `bed58a2` → `a9b5c55` → [`40c5630`](https://github.com/vernikr/biblio-mcp/commit/40c563032fdad138e7af2ce0ff235234b6602f9b). GitHub HEAD проверен после обычного fast-forward push, без force. Typecheck, strict preflight и **179/179 offline tests** зелёные; реальный stdio initialize/list/invalid-call проверен, гонка заданного имени повторена 8 раз. Новых runtime dependencies нет. Live mirrors/Windows/macOS не проверялись.

Результат и границы: [pr1-result.md](pr1-result.md). Готовые файлы: [pr1.patch](pr1.patch), [pr1-source.zip](pr1-source.zip); отдельные mail patches — в `pr1-commits/`.

**PR 2 выполнен и запушен в `main`:** F7/F8/F9, X1 и `docs:env`/Node policy; коммиты `37a1483` → `f23e816` → [`e07743a`](https://github.com/vernikr/biblio-mcp/commit/e07743a61f18a85d2a07edd1d798a794da94206e). **203/203** на Node 20 и Node 18.19; **28/28** runtime smoke на Node 18.17.0. `verify` прошёл с заблокированной внешней сетью, без внешних попыток и с одной top-level сборкой. Мутация, удаляющая tools/call response, делает новый stdio test красным. [GitHub CI](https://github.com/vernikr/biblio-mcp/actions/runs/37847481797): все 5 jobs успешны. Результат и важное различие runtime floor/full-suite floor: [pr2-result.md](pr2-result.md).

**PR 2b выполнен и запушен в `main`:** пользователь подтвердил Node 22+ и npm identity `@vernikr/biblio-mcp`. Подготовлены `.tgz`/`.mcpb` версии 2.0.0, один compiled runtime; deps обновлены и закреплены. **203/203** на Node 22/24; точный Node 22.0 — **28/28**; пять consumer launcher recipes проверены с настоящим скачиванием вне checkout. [CI](https://github.com/vernikr/biblio-mcp/actions/runs/37856503504) — **7/7 jobs успешны**, включая Linux/macOS/Windows. HEAD [`4625ba4`](https://github.com/vernikr/biblio-mcp/commit/4625ba452b5272393d22a1b60012fedc87936a25). [Результат, dependency table, артефакты и dev-only advisory](pr2b-result.md).

npm publication **закрыта**: `@vernikr/biblio-mcp@2.0.0` public/latest, registry tarball integrity и холодные registry launchers проверены. Текущие артефакты — `published-artifacts/`, прежние `release-artifacts/` сохранены как исторические. GitHub Release `v2.0.0` опубликован с проверенными public downloads; checkpoint CI — 7/7. Активная передача — [HANDOFF.md](HANDOFF.md). Desktop GUI installation не выдаётся за проверенную.

**PR 3 выполнен и запушен в `main`:** F4 (контракт: заголовки + idle watchdog, решение в `docs/decisions.md`), F5 (`errors`/`notFound` в `get_download_links` и `download_book`), F6 (no-PDF — промах записи, не отказ зеркала), R3 (один DOM Libgen), R4 (HTML-интерстициал без чтения тела). **215/215** offline tests; 12 новых тестов падали на прежнем коде (F5, F6); F4-тесты фиксируют выбранный контракт.

**PR 4 выполнен:** общий MCP-клиент в тестах, HTTP-хелперы, R5-остатки, устаревшие утверждения README/AGENTS/dependabot исправлены; аудит-worklog помечен как снимок. **215/215** offline tests без skips. Позже доделано: R2 (примеры проверяются AJV-валидатором SDK, пересекающиеся проверки убраны, чистые тесты `isUsefulLink` перенесены в `parse.test.mjs`) и X3-аннотации инструментов. Не сделано: сокращение README до 300–350 строк (ориентир, не цель).

Каждый поведенческий фикс лучше отдельным коммитом с тестом, который падает на `e9b30ca`. Группы ниже — порядок небольших PR, а не предложение собрать всё в один большой diff.

| Очередь | Состав | Критерий готовности |
|---|---|---|
| **PR 1 — install и сохранность данных, P1 · запушен в main** | F1, F2, F3; необходимые поправки README/decisions | Чистый install проходит; malformed config не получает ложный успех; атомарный no-overwrite; green offline suite |
| **PR 2 — дешёвые DX-фиксы и настоящий gate, P2 · запушен в main** | F7, F8, F9; X1; свежий `docs:env`; уточнение Node floor | Ноль реально отключает stagger; правильная env-подсказка; пустой ввод без сети; реальный stdio call checked; verify offline, build один раз |
| **PR 2b — готовые релизные артефакты, P2 · готово в main, npm 2.0.0 public** | Один runtime: npm package с pnpm/npx launcher + MCPB; scope/name/preflight/selfcheck layout; consumer Quick start отдельно от Development | Реальные установленные артефакты проходят stdio initialize/list/call вне checkout, без TS/build/dev tools и интерактивных подтверждений; версия закреплена; публикация только под подтверждённым собственным именем |
| **PR 3 — честность provider/download outcomes, P2 · запушен в main** | F5, F6; выбранный контракт F4; R3/R4 | Outage отличается от not-found; mixed Sci-Hub mirrors работают; таймауты однозначны; повторный DOM parse и ненужное чтение HTML исчезли |
| **PR 4 — тестовый boilerplate и документация, P2 · выполнен** | R1/R2/R5/R6; сокращение README/AGENTS/STATE/decisions/CI comments | Уникальные сценарии сохранены; helper не ломает env isolation; полноценная schema validation; архив не выглядит текущим планом |
| **Позже, только при подтверждённой пользе, P3** | R7; MCP annotations/`registerTool`; Windows check; более высокий Node floor | Поддерживаемые install/platform/client contracts явно согласованы; нет новой архитектуры/зависимостей ради косметики |

Документацию нового поведения обновлять в том же PR; PR 4 — массовое сокращение повторов, а не отсрочка исправления ложных обещаний.

### Общая приёмка

- Проверка типов и офлайн-тесты зелёные; все прежние **уникальные** regression scenarios сохранены. Число test declarations не использовать как KPI: удаление дублей может уменьшить его без потери проверки.
- Добавлены реальные negative cases F1–F9, а не проверки строк исходника/описаний вместо поведения.
- Stdio stdout остаётся JSON-RPC; diagnostics — stderr.
- Сохраняются bounded caches, MD5 hashing, HTML rejection, отмена проигравших запросов и защита member key от заведомо неправильных зеркал.
- Live checks запускаются отдельно; недоступность внешнего сайта не делает offline gate красным.
- Новых runtime dependencies для этого плана не требуется.
- Считать дельту отдельно для runtime, scripts, tests и Markdown. Чистые рефакторинговые коммиты должны уменьшать boilerplate; багфиксы вправе добавить необходимые assertions.

## 6. Что не делать

- Не вводить provider plugin framework, универсальный scraping DSL, новый test framework или task runner для такого размера проекта.
- Не сливать mirror cooldown, source circuit и result TTL-cache в один механизм: они защищают от разных проблем.
- Не кэшировать Anna's HTML details только ради DRY: это конфликтует с уже реализованной отменой проигравшего запроса.
- Не кэшировать member URLs, не проверив срок/одноразовость ссылок и квоту; отменённый HTTP request не обязательно означает нерасходование квоты.
- Не удалять реальные HTML captures, compatibility guard и единственный настоящий installer end-to-end test ради красивого LOC/тайминга.
- Не удалять nativeAny fallback/packaging paths, пока соответствующая поддержка не снята явно.
- Не «сокращать» код удалением сообщений об ошибках, безопасности записи или полезных границ типов.

**Ожидаемый эффект:** заметное уменьшение тестового/диагностического boilerplate и примерно 180–250 строк активной документации; runtime-сокращение умеренное. Регрессионные тесты и fixes частично компенсируют удалённые строки. Обещать ещё −20–25% всего кода без потери поведения оснований нет.

## Локальные доказательства

В рабочей папке аудита сохранены baseline logs, `metrics.json`, metadata снимка и `reproductions/`. В `reproductions/checks.mjs` — локальные probes для settings, download-timeout, no-overwrite, links-outage, scihub-miss, empty-input. Запускать после install/build в соседнем `repo/`, например:

```bash
node reproductions/checks.mjs no-overwrite
node reproductions/checks.mjs links-outage
```

Дополнительно сохранены `fresh-install.log`, `config-array.json/log`, `ci-smoke.json` и stdio output. Воспроизведения не скачивают чужие книги/статьи: используют собственные тестовые байты и loopback-серверы.

[install-order]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/scripts/install.mjs#L106-L127
[preflight-deps]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/scripts/preflight.mjs#L163-L185
[config-write]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/scripts/install.mjs#L243-L258
[download-commit]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/server.ts#L311-L339
[download-http]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/http.ts#L358-L456
[config-download]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/config.ts#L45-L49
[state-timeout]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/docs/STATE.md#L18-L19
[resolve-downloads]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/providers/index.ts#L225-L260
[links-tool]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/server.ts#L265-L267
[failed-details]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/providers/index.ts#L209-L221
[scihub-resolve]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/providers/scihub.ts#L11-L64
[mirror-winner]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/http.ts#L298-L304
[number-settings]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/config.ts#L12-L25
[mirror-settings]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/http.ts#L221-L226
[ci-smoke]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/.github/workflows/ci.yml#L57-L86
[startup-tests]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/test/install.test.mjs#L52-L78
[path-test]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/test/agent.test.mjs#L167-L185
[query-schemas]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/server.ts#L202-L227
[libgen-details]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/providers/libgen.ts#L261-L323
[html-error]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/src/http.ts#L317-L339
[package-scripts]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/package.json#L29-L48
[readme-cli]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/README.md#L150-L158
[readme-scihub]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/README.md#L414-L416
[readme-zlib]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/README.md#L410-L413
[old-worklog]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/docs/worklog/biblio-mcp-audit.md#L7-L48
[dependabot]: https://github.com/vernikr/biblio-mcp/blob/e9b30ca60de1f954e91f69fcd66735f526f18b30/.github/dependabot.yml#L28-L40
