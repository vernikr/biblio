> **Снимок на конец волны 1 (2026-10-08), не текущий backlog.** Статусы «открыто» ниже относятся к тому моменту.
> Актуальное состояние — [`docs/STATE.md`](../../STATE.md) и [`AGENTS.md`](../../AGENTS.md);
> план PR 1–4 — [`plan.md`](../2026.10.09-biblio-mcp-review/plan.md).

# Аудит `vernikr/biblio-mcp` — баги, скорость, DX/AX, рефакторинг

Ревизия исходного аудита: `f6c4e42` (main, 2026-10-07). Обновлено 2026-10-08 после фаз 0–5.
Рабочая копия плана сохранена в `docs/worklog/archive/`; обоснование LOC — в
[`docs/decisions.md`](../decisions.md).

> **Текущий статус.** Фазы 0–5 завершены. Фаза 0 — `f181085`; фаза 1 — `f16de8e`, `a9bc3a4`,
> `557deda`; фаза 2 — `ea277f2`; фаза 3 — `1bf3826` и релиз `5537fee`.
> В фазе 4 выполнены D2 (`bb01bc6`), D3 (`faae672`), D4 (`480226f`), D5 (`90877e7`), D6
> (`6b72678`), затем D9 и D7 (`2fdec09`); D1 — последний отдельный коммит фазы 4 (`9682746`).
> D8, D10 и D11 закрыты в фазе 2 (`ea277f2`), D12 — в фазе 0. В фазе 5 выполнены C6, C7, C9 и
> C10; **A16** (Sci-Hub ALTCHA-страница вместо статьи) остаётся открытой.

**Финальная проверка D1 (2026-10-08):** `PATH=/tmp/biblio-bin:$PATH pnpm run verify` прошёл:
строгая проверка типов, сборка, **137/137 офлайн-тестов**, `selfcheck passed`; `git diff --check`
чистый. В selfcheck доступны 3/3 зеркала Anna's, 3/7 Libgen, 5/6 Sci-Hub, 0/4 Z-Library;
экспортируется 7 MCP-инструментов. Живые результаты зеркал изменчивы и приведены только как
снимок этого запуска.

**Финальная проверка фазы 5 (2026-10-08):** `PATH=/tmp/biblio-bin:$PATH pnpm run verify` прошёл:
строгая проверка типов, сборка, **140/140 офлайн-тестов**, live `selfcheck passed`, 7 MCP-инструментов.
Сетевой snapshot: 3/3 зеркала Anna's Archive, 3/7 Libgen, 5/6 Sci-Hub и 0/4 Z-Library.

**Измерения кода.** В сопоставимом наборе `.ts`/`.mjs` в `src/`, `scripts/`, `test/` перед D1 было
7127 строк и 1124 comment-only строк; после D1 — **6500 строк** и **499 comment-only строк**.
Комментарии сокращены на 625 строк, общий LOC — на 627. Все тесты и HTML-фикстуры сохранены.
Исторический baseline `f6c4e42` для того же набора `.ts`/`.mjs` — 5487 строк; первоначальный
аудит отдельно фиксировал 5513 строк при своём способе подсчёта.

**Как это проверялось в исходном аудите.** Ниже сохранены первичные доказательства и выводы; для
актуального статуса задач см. сводку выше и таблицу фазы 4.

---

## Вердикт после фаз 0–5

Первичная ревизия действительно выявила отсутствие офлайн-покрытия парсеров, зависание на пустой
группе зеркал и таймаут, который не покрывал чтение тела. Эти случаи закрыты регрессионными
тестами; после Phase 5 офлайн-набор содержит 140 тестов (на момент завершения фазы 4 было 137).
Фаза 2 также закрыла A5–A14 и C8; фаза 3 добавила кэши и оптимизации горячих путей; фазы 4 и 5
закрыли рефакторинг и C6/C7/C9/C10. По changelog один живой замер выполнил warm-цели поиска/деталей,
но цель `pnpm test < 5 с` по-прежнему не выполнена (последний офлайн-прогон — около 10 с).

**Остаётся открытым:** A16 — Sci-Hub может вернуть ALTCHA-страницу со статусом 200; текущий
provider fetch не передаёт identity validator в `fetchFromMirrors`. Фаза 5 закрыла C6 (maintainer
и contributor guide), C7 (opt-in `resolvePdfs`, не более трёх DOI и только прямой `pdfUrl`), C9
(Quick Start перенесён наверх README) и C10 (`private: true` защищает имя upstream-пакета).
A16 остаётся отдельной открытой задачей. Исходный LOC ceiling 4700 пересмотрен после D1; rationale
и точный подсчёт приведены в `docs/decisions.md` и ниже.

---

## A. Скрытые баги

> Далее сохранены исходные описания находок; заголовки `✅ ФАЗА 1/2` означают, что фикс и регрессионная проверка уже есть.

### A1 · CRITICAL · ✅ ФАЗА 1 — `search_papers` возвращает название журнала вместо названия статьи

**Где:** `src/providers/libgen.ts:80-110` (`splitTitleCell`), строка `104`: `title ??= a.text`.

`splitTitleCell` берёт **первый** якорь с текстом длиннее 2 символов. В раскладке scimag ячейка 0
устроена так (реальный HTML с `libgen.li`, 2026-10-08):

```html
<td><b><a href="series.php?id=54500">The CRISPR Journal</a>
       <a href="edition.php?id=88019784"><i> 2020-apr 01 vol. 3 iss. 2</i></a> pp.109—122</b><br>
    <a href="edition.php?id=88019784">New Additions to the CRISPR Toolbox: …</a><br>
    <a href="edition.php?id=88019784"><i><font color="green">DOI: 10.1089/crispr.2019.0062</font></i></a>
</td>
```

Первый якорь — это **журнал**, настоящее название статьи — третий. Для книг та же функция работает
правильно (там первый `edition.php`-якорь и есть заголовок), поэтому `search_books` цел, а
`search_papers` сломан.

**Доказательство** (живой вызов `libgen.searchPapers`):

```
searchPapers("CRISPR gene editing")     -> title: "The CRISPR Journal"        (×2), "Current Gene Therapy"
searchPapers("attention is all you need")-> title: "Proceedings of the AAAI Conference on Artificial Intelligence"
searchPapers("10.1038/nature12373")     -> title: "Nanometre-scale thermometry in a living cell"  ✓
                                           journal: "Kucsko, G.; Maurer, P. C.; …"  ← список авторов
                                           author:  "Nature 2013-jul 31 vol. 500 iss. 7460 pp.54—58…"
```

Побочно: `journal` маппится на колонку `Publisher` (`cols.publisher` = 2), а в scimag она **пуста**,
поэтому журнал теряется; для DOI-раскладки колонки съезжают и `journal`/`author` меняются местами.

**Фикс (~15 строк):** в `splitTitleCell` возвращать `{ title, venue }` — `venue` = текст `<b>` /
якоря на `series.php`, `title` = первый якорь **вне** `<b>`, не DOI и не ISBN. В `searchPapers`
брать `journal` из `venue`, а не из колонки Publisher. + фикстура `test/fixtures/libgen-scimag.html`
и 4 теста.

---

### A2 · CRITICAL · ✅ ФАЗА 1 — member fast-download ссылку выбрасывает собственный фильтр

**Где:** `src/providers/index.ts:194` (пушим `fastDownload`) → `:220`
`links.filter((l) => isUsefulLink(l.url, hash))` → `src/parse.ts:243-254`.

`isUsefulLink` требует, чтобы URL **содержал md5** (исключение только для путей `/ipfs/…`).
`annas.fastDownload()` возвращает `download_url` из JSON-API — это signed-URL CDN или токен-ссылка,
md5 в ней нет.

**Доказательство** (прямой вызов `dist/parse.js`):

```
DROPPED https://cdn3.zlibrary-asia.se/dl/9f2a1c7e/book.epub
DROPPED https://annas-archive.gs/dyn/ll/abcdef123456
kept    https://ipfs.io/ipfs/bafybeigdyrzt…
```

**Итог:** `BIBLIO_ANNAS_API_KEY` — фича, ради которой, судя по CHANGELOG и README, писался
`fastDownload`, — не доходит ни до `get_download_links`, ни до `download_book`
(`server.ts:295` берёт `links` уже после фильтра). Единственный случай, когда она работает, —
когда Anna's вернула IPFS-шлюз.

**Фикс (~10 строк):** фильтр «ссылка про эту книгу» должен применяться к *скрапленным* ссылкам, а не
к ссылкам, полученным из API по конкретному md5. Добавить в `DownloadLink` поле `verified: true`
(или `via: "api"`), выставлять его в `fastDownload`, и в `resolveDownloads` пропускать такие ссылки
мимо `isUsefulLink`. + тест с подменённым `fastDownload`.

---

### A3 · HIGH · ✅ ФАЗА 1 — пустой список зеркал вешает tool call навсегда

**Где:** `src/http.ts:216-217`. `let remaining = ordered.length` → 0, `forEach` не выполняется,
Promise не резолвится и не реджектится.

**Доказательство:**

```
BIBLIO_ZLIB_MIRRORS=" "  -> ZLIBRARY_MIRRORS = []          (fromEnv: split→trim→filter(Boolean))
BIBLIO_ZLIB_MIRRORS=""   -> 4 entries (fallback — очистить нельзя, mirrors.ts:17-18)
>>> fetchFromMirrors("zlib-empty", [], …) STILL PENDING after 3s
```

Реальный триггер: `BIBLIO_ZLIB_MIRRORS=" "` (или `","`, или любое значение, которое после
`trim`/`filter(Boolean)` схлопывается в пустоту) + `search_books {sources:["zlibrary"]}`. Промис не
завершается, а в MCP-сервере stdio-транспорт держит event loop живым, поэтому tool call висит вечно:
на стороне сервера таймаута на запрос нет, и агент видит зависший инструмент без сообщения об
ошибке. (Проверено: `rc=124` через 5 с, ответ так и не пришёл — команда в приложении.)

**Фикс (3 строки):** в начале `fetchFromMirrors` — `if (ordered.length === 0) throw new Error(...)`;
заодно решить асимметрию `fromEnv`: пустая строка должна означать «пусто», как это уже сделано для
`BIBLIO_DISABLE_SOURCES` (`providers/index.ts:39` проверяет `raw === undefined`).

---

### A4 · HIGH · ✅ ФАЗА 1 — `BIBLIO_TIMEOUT_MS` не покрывает чтение тела ответа

**Где:** `src/http.ts:159-168` — `clearTimeout(timer)` в `finally` срабатывает сразу после получения
**заголовков**; `src/http.ts:237` `await res.text()` выполняется уже без таймера.

**Доказательство** (локальный сервер отдаёт заголовки и первый байт, тело не завершает):

```
BIBLIO_TIMEOUT_MS=500 -> запрос ВСЁ ЕЩЁ ждёт тело через 4000 мс
```

То есть фактически это «таймаут до заголовков». Зеркало, которое быстро отвечает `200` и тянет тело,
держит весь tool call неограниченно. У `downloadToFile` stall-watchdog есть (`http.ts:411-419`, и комментарий на 411-412 прямо называет причину: «the request timer above only covers the headers») — тот же вывод не перенесён на HTML-путь,
у HTML-пути — нет.

**Фикс (~8 строк):** не очищать таймер до чтения тела — перенести `clearTimeout` после
`await res.text()` (или обернуть чтение в `Promise.race` с тем же контроллером).

---

### A5 · MEDIUM · ✅ ФАЗА 2 — Anna's Archive в дефолте, но не работает совсем; каждый запрос его оплачивает

**Доказательство** (2026-10-08, из этой машины):

```
annas-archive.gd/            -> 200, 174497 B, is-annas      (корень отвечает)
annas-archive.gd/search?q=…  -> 403, 902 B, NOT-annas        (DDoS-Guard)
  …и с «браузерными» заголовками (Sec-Fetch-*, sec-ch-ua, Upgrade-Insecure-Requests) — те же 403
annas.search("dune") -> "All 3 annas mirror(s) failed: … HTTP 403 …"   за 2688 мс
```

Цена сегодня:

* `search_books` — **+2.7 с** в никуда и постоянный `errors:[{source:"annas",…}]`, с которым агент
  ничего не может сделать;
* `book_details` — `providers/index.ts:149` **последовательно** ждёт провала Anna's и только потом
  идёт в Libgen (замер: 1527 мс целиком);
* `resolveDownloads` — `providers/index.ts:196` параллельно тянет `annas.details` впустую.

**Фикс:** (а) в `bookDetails` гнать Anna's и Libgen **параллельно** (`Promise.any` по «первый
осмысленный ответ»), а не последовательно; (б) `annas.details` в `resolveDownloads` — только если
Anna's не в negative cache на все зеркала; (в) добавить провайдер-level circuit breaker: N
подряд полных провалов источника → источник выключается до конца процесса, а в ответ уходит одна
короткая строка `annas: unavailable (DDoS-Guard challenge)`, а не 3 строки на зеркало.

---

### A6 · MEDIUM · ✅ ФАЗА 2 — `healthcheck` сбрасывает прилипание к рабочему зеркалу

`src/server.ts:429` вызывает `resetMirrorCache()`, который чистит и `deadUntil`, **и**
`preferredMirror` (`http.ts:97-100`). Диагностический вызов обнуляет накопленную стики-информацию,
и следующий боевой запрос снова платит stagger по всем зеркалам. Нужно два метода:
`resetDeadCache()` (для healthcheck) и `resetMirrorCache()` (для selfcheck).

---

### A7 · MEDIUM · ✅ ФАЗА 2 — проверка «отвечает, но это не тот сайт» включена только для Anna's

`src/mirrors.ts:126-136`: маркер `expect` задан только группе `annas`. Libgen, Sci-Hub и Z-Library
проверяются одним статус-кодом — ровно тот сценарий («a status code is not evidence of identity»),
который README выносит в заголовок как решённый. `sci-hub.st` в моём прогоне дал 200, через
несколько минут — 403; перехваченный домен дал бы «ok».

**Фикс:** `expect` для каждой группы (`/Library Genesis/`, `/Sci-Hub/`, `/Z-Library|z-library/`) +
тест.

---

### A8 · LOW/MED · ✅ ФАЗА 2 — `download_book`: `finally` удаляет staging даже после успеха

`src/server.ts:330` (`await rename(staging, path)`) и `:358` (`finally { await unlink(staging) }`).
Обычно безвредно (ENOENT глушится), но если агент передаст `filename: "<md5>.downloading"`, то
`path === staging`, `rename` — no-op, и `finally` **удаляет скачанный файл**, а инструмент возвращает
`saved: true, path: …`. Плюс `md5MatchesRequest: false` (`:346`) не мешает сохранить файл под именем
запрошенного md5 — агент, не прочитавший флаг, получит битый файл с «правильным» именем.

**Фикс:** `unlink` перенести в `catch`; при `!md5MatchesRequest` либо переименовывать в
`<реальный md5>.<ext>`, либо возвращать явное `warning`.

---

### A9 · LOW · ✅ ФАЗА 2 — `parseSize`: множитель KB→TB ошибочен

`src/parse.ts:55`: `unit === "KB" ? 1 / 1048576` — это KB→**GB**; KB→TB это `1 / 1073741824`.
Проверка правдоподобия для KB завышена в 1024 раза. На практике не проявляется (регулярка
ограничивает число 4 цифрами), но это ровно тот класс «тихой арифметики», из-за которого модуль
и переписывали.

---

### A10 · LOW · ✅ ФАЗА 2 — `zlibrary.ts` не использует валидаторы из `parse.ts`

`src/providers/zlibrary.ts:58,60,61` — те самые loose-регулярки
(`(\d+(?:\.\d+)?\s?(?:KB|MB|GB))`, `\b(1[5-9]\d{2}|20\d{2})\b`), ради устранения которых
`parse.ts` написан (см. его шапку, строки 8-16). `parseSize` / `parseYear` / `parseFormat` лежат
в соседнем модуле.

---

### A11 · LOW · ✅ ФАЗА 2 — `install.mjs`: флаг `--live` не реализован, логика инвертирована

`scripts/install.mjs:43` читает только `--skip-network`. Строки 181-183:

```js
if (!SKIP_NETWORK) { note("skipping the live mirror check (pass --live to run `--selfcheck`)"); }
```

— «пропускаю» печатается, когда пропускать **не** просили, а `--live` нигде не читается.
Там же `:132` мёртвый тернар `pm.name === "pnpm" ? ["install"] : ["install"]`.

---

### A12 · LOW · ✅ ФАЗА 2 — док ведёт в сломанную установку

`src/index.ts:6`: «or through a client such as `npx biblio-mcp`». При этом `README.md:100`
(«Why not `npm install biblio-mcp`?») и `scripts/install.mjs:4-8` объясняют, что пакет в npm — это
**апстрим** с той самой парой sdk 1.12.1 + zod 4, из-за которой форк и создан. Комментарий в
entry point противоречит собственному README.

---

### A13 · LATENT · ✅ ФАЗА 2 — прогресс-нотификации летят без `.catch()`

`src/server.ts:92-117` (`makeProgressReporter`) возвращает `async`-функцию, а `src/http.ts:424`
вызывает `opts.onProgress?.({bytes,total})` без `await` и без `.catch()`. Отказ
`sendNotification` теоретически даёт unhandled rejection.

**Честно: воспроизвести не удалось.** Я собрал офлайн-репро (локальное зеркало + локальный
`get.php`, реальный `download_book` через `InMemoryTransport`) и рвал соединение клиента на второй
нотификации — SDK абортирует запрос через `extra.signal` раньше, чем успевает уйти третья:

```
(client received 2 progress notifications, now disconnecting)
call threw: MCP error -32000: Connection closed
>>> no unhandled rejection observed
```

Всё равно стоит `void send(…).catch(() => {})` — цена ноль.

---

### A14 · LOW · ✅ ФАЗА 2 — `search_books` с пустым или дублирующимся `sources`

```
searchBooks(q, sources=[], 5)  -> {"query":"dune","results":[],"errors":[]}
```

Ни результатов, ни ошибки — агент делает вывод «книги нет». Дубликаты в `sources` не
дедуплицируются (`libgen` отрабатывает дважды). `providers/index.ts:89`
`sources.filter(s => s in bookSearchers)` молча проглатывает и то, и другое.

---

### A15 · HIGH · ✅ ФАЗА 1 — инсталлятор молча откатывается на npm и ломает дерево

**Где:** `scripts/install.mjs:67-73` (`findPackageManager`): `for (const pm of ["pnpm", "npm"])`.

Репозиторий стандартизован на pnpm: `packageManager: "pnpm@12.10.1"`, `pnpm-lock.yaml`, раздел
«Why pnpm and not npm?» в README, и отдельный шаг CI с комментарием про то, что npm однажды
разрезолвил sdk 1.12.1 против zod 4. Но если pnpm в PATH нет, инсталлятор без предупреждения
берёт npm и выполняет `npm install` поверх pnpm-дерева.

**Доказательство** (найдено, когда `test/install.test.mjs` внезапно покраснел):

```
[4] installing dependencies
  $ npm install
  FAIL npm install failed
npm error Cannot read properties of null (reading 'matches')
  at PlaceDep.pruneDedupable (…/@npmcli/arborist/lib/place-dep.js:426)
```

npm падает внутри собственного резолвера, разбирая `node_modules/.pnpm`. На чистой машине он
вместо этого построит **другое** дерево зависимостей — ровно то, ради предотвращения чего
инсталлятор написан. То есть единственный сценарий, где инсталлятор обязан остановиться и
сказать «поставьте pnpm», он проходит молча.

**Фикс (~10 строк):** если есть `pnpm-lock.yaml`, а pnpm не найден — `bad()` с командой
`npm install -g pnpm` и выход, без отката на npm. Откат допустим только когда lock-файла pnpm нет.

---

### A16 · MEDIUM · ✅ ЗАКРЫТА (волна 2) — Sci-Hub отдаёт страницу ALTCHA-проверки вместо статьи

Фикс: страница проверки (`altcha-widget`, `/captcha/solution/`) отклоняется валидатором провайдера, поэтому берётся следующее зеркало. Если все зеркала отвечают проверкой, `get_paper` сообщает об этом. Страница без PDF («статьи нет в базе», HTTP 200) тоже больше не возвращается как статья. Сервер проверку не решает. Фикстуры `scihub-altcha.html` и `scihub-no-pdf.html` снятые живьём; тесты `test/scihub-challenge.test.mjs`.

**Где:** `src/providers/scihub.ts` — парсер ищет `embed#pdf` / `iframe#pdf` / `#article embed`.

`sci-hub.ru` на запрос `/10.1038/nature12373` ответил **HTTP 200** и страницей
«Sci-Hub: проверка на робота» с `altcha.min.js` (7.4 kB) — не статьёй. Статус-код при этом
«успешный», поэтому `fetchFromMirrors` считает зеркало живым и даже помечает его preferred,
а `scihub.resolve` возвращает `Paper` с `title = "Sci-Hub: проверка на робота"` и без `pdfUrl`.
Ни ошибки, ни признака деградации. Через несколько минут `sci-hub.ren` отдал настоящую страницу —
то есть это плавающее состояние, а не смерть источника.

Это тот же класс, что и A7 («статус-код — не доказательство идентичности»), но уже не
гипотетический: он воспроизведён.

**Фикс:** передать `validate` в `fetchFromMirrors` для группы `scihub`
(маркер — `#article` или `citation_title`, анти-маркер — `altcha|проверка на робота`) и добавить
`expect` группе `scihub` в `MIRROR_GROUPS`. Инфраструктура для этого уже есть и уже работает —
см. `expect` у группы `annas`.

---

## B. Скорость

| # | Что | Замер | Фикс |
|---|---|---|---|
| B1 | `annas.search` парсит страницу **дважды**: `annas.ts:65` `$` мёртв (подтверждено `tsc --noUnusedLocals`), работает только `$$` от `:73`. Плюс `replace(/<!--/g)` по 174 kB. | `cheerio.load` реальной 242 kB страницы Libgen = **196 мс**; синтетическая 173 kB = 32 мс. На Anna's это 200-300 мс впустую на каждый поиск. | удалить `$` и вторую загрузку; комментарий вырезать точечно |
| B2 | `res=100` зашит жёстко: `libgen.ts:132,188,191` | для `limit:5` качаем **242 kB / 108 строк** и парсим их все | `res=` = `clamp(limit*3, 25, 100)` |
| B3 | `bookDetails` — Anna's, **потом** Libgen (`providers/index.ts:149,163`) | 1527 мс, почти всё — ожидание провала Anna's | `Promise.any`, оба источника параллельно |
| B4 | `resolveDownloads` всегда тянет `annas.details` (`:196`) | лишний полный HTML-запрос, сегодня гарантированно 403 | пропускать, если группа `annas` целиком в negative cache |
| B5 | Фолбэк-цепочка `.catch(() => fetchFromMirrors(…))` (`libgen.ts:131-135, 187-192`) | после 1-го прогона все зеркала в кулдауне → `orderMirrors` отдаёт полный список → **ещё до 8 с** | один `fetchFromMirrors` со списком `buildPath`-вариантов, а не два последовательных |
| B6 | Нет кэша результатов в рамках процесса | типичный агентский цикл search→details→links→download платит 4 сетевых раунда | TTL-кэш 30-60 с на `(source, query, limit)` и на `(md5 → ads.php HTML)` |
| B7 | `useReadableValidationErrors` парсит аргументы дважды (свой `safeParseAsync` + `original`) | микросекунды | читать issues из ошибки `original`, а не парсить заново |
| B8 | `probeMirror` без `expect` не читает тело (`http.ts:490`) | проверил: сокеты **не** текут (delta 1 на 8 хостов) — это про A7, не про скорость | `await res.body?.cancel()` |
| B9 | `pnpm test` = 21.4 с, из них **11.0 с** — `test/agent.test.mjs` (healthcheck по 20 зеркалам + `example.com`) | сетевые тесты в юнит-прогоне | вынести в `pnpm test:live`, в CI гонять отдельным необязательным job'ом |

Замеры «до» для целевых метрик: `search_books` cold **2420 мс** / warm **1369 мс**;
`bookDetails` **1527 мс**; `resolveDownloads` **1109 мс**; `searchPapers` **2692 мс**.
Реалистичная цель после B1-B6: `search_books` ≤ 800 мс, `book_details` ≤ 700 мс.

---

## C. Developer / Agent experience

**C1 · ✅ ФАЗА 0 — Сетевые тесты в основном прогоне.** `test/agent.test.mjs` ходит в `example.com` и по 20
зеркалам. CI сейчас зелёный (проверил последние 8 прогонов через Actions API: 6×success после
2×failure на настройке), но это зелёный по везению — раннер GitHub, у которого нет доступа к
sci-hub, уронит main. Плюс тест ничего не проверяет там, где заявлено (см. C5).

**C2 · Нулевое покрытие парсеров провайдеров.** 0 ссылок в `test/`:
`searchPapers`, `scihub.resolve`, `zlibrary.search`, `annas.search`, `annas.details`,
`annas.fastDownload`, `libgen.downloadLinks`, `searchBooks`. Это корневая причина A1 и A2.
Для сравнения: `fetchFromMirrors` — 16 ссылок, `sniffExt` — 18, `parseBibtex` — 12.

**C3 · ✅ ФАЗА 0 — `tsconfig.json` без `noUnusedLocals`/`noUnusedParameters`.** Три мёртвых объявления живут
в main: `annas.ts:65` (`$`), `server.ts:13` (`McpError, ErrorCode`), `server.ts:27` (`annas`).

**C4 · ✅ ФАЗА 0 — `scripts/` исключён из tsconfig** (`tsconfig.json:17`), поэтому `scripts/smoke.ts`
не проверяется типами вообще — и при этом дублирует `selfcheck --live` (44 строки).

**C5 · ✅ ФАЗА 0 — Тест, который не проверяет заявленное.** `test/agent.test.mjs:221`:
`assert.ok(!probe.ok || probe.impostor === undefined)` — для `example.com` с заведомо
неподходящим маркером `!probe.ok` истинно всегда, ветка `impostor` не проверяется никогда.
Название теста обещает ровно то, что не покрыто.

*Разрешено в фазе 0 удалением:* офлайн-покрытие этого сценария уже есть и оно сильнее —
`test/http.test.mjs`, «probeMirror flags an answering host that is not the expected site»,
гоняет `probeMirror` против двух локальных серверов и проверяет `impostor === true`,
`ok === false`, `status === 200`. Сетевой дубликат убран, на его месте в `agent.test.mjs`
оставлен комментарий-указатель, чтобы его не восстановили.

**C6 · Нет «входа для агента» в репозиторий.** Ни `AGENTS.md`, ни `CONTRIBUTING.md` с рецептом
«как добавить провайдер» (а это самая частая правка в таком проекте: зеркала умирают). Нет
линтера/форматтера/`.editorconfig`.

**C7 · `search_papers` не отдаёт `pdfUrl`**, хотя md5 scimag-записи уже известен
(`libgen.ts:176`). Агенту нужен лишний прыжок через `get_paper`/`get_download_links`.

**C8 · Ошибки на зеркало, а не на источник.** `errors: ["annas:All 3 annas mirror(s) failed:
https://annas-archive.gl -> HTTP 403; https://…"]` — 300 символов, из которых агенту полезен ноль.
Нужно: `annas: unavailable — DDoS-Guard challenge on all 3 mirrors; retry later or set
BIBLIO_ANNAS_API_KEY`.

**C9 · README: 481 строка, первые 57 — эссе.** «Быстрый старт» (3 команды) buried под таблицей
«до/после» на 15 строк. Для человека, который просто хочет поставить, это дорого.

**C10 · `package.json` настроен на публикацию** (`bin`, `files`, `prepublishOnly`), но форк не
публикуется, а имя в npm занято апстримом. Либо `"private": true` + смена имени
(`@vernikr/biblio-mcp`), либо честная публикация — текущее состояние порождает A12.

---

## D. Рефакторинг / сокращение объёма кода

Исходная оценка **−800…−1000 строк** была ориентиром, а не основанием удалять проверенное поведение или тесты; после D1 LOC-критерий пересмотрен (см. итог фазы 4).

| # | Что | Строк сейчас | Оценка |
|---|---|---|---|
| D1 | ✅ **Завершён последним отдельным коммитом.** Эссе-комментарии сжаты; все полезные тесты и фикстуры сохранены; rationale вынесен в [`docs/decisions.md`](../decisions.md). | 7127 → 6500 `.ts`/`.mjs`; comment-only: 1124 → 499 | −627 LOC; исходный потолок 4700 снят с обоснованием ниже |
| D2 | ✅ `bb01bc6` — `fetchFromMirrors` переведён на `Promise.any` с отменой проигравших запросов; A3 остаётся покрыт тестом. | 68 | −40 (оценка плана) |
| D3 | ✅ `faae672` — общий `withInMemoryClient(fn)` вместо трёх копий транспорта. | ~75 | −45 (оценка плана) |
| D4 | ✅ `480226f` — общий `probeGroup()` для healthcheck/selfcheck. | ~90 | −40 (оценка плана) |
| D5 | ✅ `90877e7` — URL-сборка унифицирована через `new URL(href, base).href`. | ~20 | −15 (оценка плана) |
| D6 | ✅ `6b72678` — `TOOL_META` хранит примеры; required/optional выводятся из Zod-схемы. | 108 | −40 (оценка плана) |
| D7 | ✅ `2fdec09` — удалены `scripts/smoke.ts` и команда; `typecheck` теперь запускает `tsc --noEmit`. | 44 | −44 |
| D8 | ✅ Уже исправлен в фазе 2 (`ea277f2`, A11): `--live` реализован, dead ternary и инвертированная ветка устранены. | 278 | −15 (оценка плана) |
| D9 | ✅ `2fdec09` — дубли импортов объединены; неиспользуемые импорты убраны ранее. | — | −4 |
| D10 | ✅ Уже исправлен в фазе 2 (`ea277f2`, A10): Z-Library использует общие `parseSize`/`parseYear`/`parseFormat`. | 75 | −5 (оценка плана) |
| D11 | ✅ Уже исправлен в фазе 2 (`ea277f2`, A14): `sources` валидируются, дедуплицируются; пустой список даёт явную ошибку. | — | +5 (оценка плана) |
| D12 | ✅ Две `cheerio.load` в `annas.search` убраны в фазе 0 (`f181085`). | — | −2 |

После D2–D7 и D9 `src/` использует общий mirror race, lifecycle helper и `probeGroup`; URL-резолвинг
и argument hints больше не дублируют данные. `server.ts` по-прежнему регистрирует инструменты и
координирует локальное сохранение файла; это не входило в согласованный объём фазы 4.

---

## E. План работ

### Фаза 0 — охрана ✅ ВЫПОЛНЕНА (коммит `f181085`, v1.5.2)

**Что сделано и чем проверено.** Каждая строка ниже — результат реально запущенной команды.

| Пункт плана | Сделано | Проверка |
|---|---|---|
| `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess` | `tsconfig.json` | `tsc --noEmit` → **0 ошибок**; до этого — 3 мёртвых объявления |
| Включить `scripts/*.ts` в проверку типов | новый `tsconfig.scripts.json` (`noEmit`, `rootDir: "."`), скрипт `pnpm typecheck` | `tsc -p tsconfig.scripts.json` → **0 ошибок** |
| Разделить тесты на офлайн и живые | `pnpm test` / `pnpm test:live` / `pnpm test:all`; `test/live/*.live.test.mjs` | офлайн **92/92**, живые **2/2** |
| CI: живые тесты отдельным job'ом | job `live` с `continue-on-error: true` | YAML парсится, jobs = `[build, live]` |
| Фикстуры, снятые живьём | 4 из 7: `libgen-books`, `libgen-scimag`, `libgen-ads`, `scihub-doi` + `scripts/capture-fixtures.mjs` | `test/fixtures.test.mjs` **7/7** |

**Замеры:**

| Метрика | До | После |
|---|---|---|
| `pnpm test` (офлайн) | 21.4 с, 87 тестов | **6.7 с** (11.2 с вместе со сборкой), **92 теста** |
| `test/agent.test.mjs` | 10 979 мс (20 живых зеркал + `example.com`) | **477 мс**, сеть не трогает |
| `test/install.test.mjs` | 5 145 мс (настоящий `npm install` + `tsc` внутри) | **1 948 мс**, только `--dry-run` |
| Сетевые запросы в офлайн-наборе | healthcheck по 20 хостам + `example.com` | **0** |
| Покрытие фикстурами парсеров | 1 фикстура, написанная от руки | 4 снятых + охрана целостности |

Прогнано полностью, как это делает CI: `typecheck` ✓ · `build` ✓ · `test` 92/92 ✓ ·
`test:live` 2/2 ✓ · `selfcheck` «selfcheck passed» ✓ · stdio smoke-check из `ci.yml` ✓ ·
`install.mjs --dry-run` «install complete» ✓.

**Расхождения с планом — три, все осознанные.**

1. **Критерий «< 5 с» не выполнен: 6.7 с.** Оценка в плане была написана до замеров. Оказалось, что
   в наборе ~1.7 с намеренных таймеров (тест half-open кэша ждёт TTL, тест stall-watchdog ждёт
   обрыва на 700 мс) и ~1.9 с на 13 запусков дочерних `node`. `--test-concurrency=4` даёт 3.2 с
   (проверено: 6 прогонов из 6 зелёных), но флаг требует Node ≥ 18.9 при `engines: ">=18"` и
   добавляет разброс планировщика в набор с тайминговыми ассертами. **Решил не включать** —
   21.4 → 6.7 с это уже 3.2×, а цена за остаток несоразмерна.

2. **Фикстур 4 из 7, а не 6.** `annas-search.html` и `annas-md5.html` снять нельзя: Anna's Archive
   отвечает **HTTP 403** на `/search` и `/md5/…` и с текущими, и с «браузерными» заголовками.
   `zlibrary-search.html` — все домены недоступны. **Подменять их рукописной разметкой не стал**:
   это ровно то угадывание, против которого написан `src/parse.ts`. Скрипт честно печатает их как
   промахи при каждом запуске.

3. **`scihub-doi.html` снят с `sci-hub.ren`, а не с `sci-hub.ru`.** `sci-hub.ru` отдал страницу
   ALTCHA-проверки при статусе **200** — её не пустил маркер `expect` в скрипте захвата (это и есть
   находка A16). Поэтому у таргета теперь список зеркал с перебором.

**Побочно, из того, что фаза 0 вскрыла:** `test/install.test.mjs:113` гонял настоящий
`npm install` + `tsc` внутри «юнит-тестов», и его результат зависел от того, какой пакетный
менеджер оказался в PATH. Так нашлась A15.

**Гарантия отсутствия регрессий.** Поведение рантайма не менялось: все 11 правок под
`noUncheckedIndexedAccess` — недостижимые ветки, удаление мёртвого `$` в `annas.search` убирает
лишний парсинг, но не меняет результат (работал только `$$`). Подтверждение — 92/92 офлайн и 2/2
живых, включая все четыре drift-охраны (`BIBLIO_*` в `--help`/README, команды из README в
`package.json`, `scripts/install.mjs` в тарболе, ссылки в CHANGELOG).

---

### Фаза 1 — критические баги ✅ ВЫПОЛНЕНА (v1.6.0)

Коммиты: `f16de8e` (A1–A4), `a9bc3a4` (A15), `557deda` (документация и версия).
Порядок работы для каждого пункта: **сначала регрессионный тест, который падает**, потом правка.
Ниже — то, что реально вернули тесты до правки и после.

| Находка | До правки (тест падал так) | После правки |
|---|---|---|
| **A1** `search_papers` | `actual: 'The CRISPR Journal'` при ожидаемом названии статьи; `journal` пустой; у части строк `title` = `"Gene"` | `title: "CRISPR Gene Editing Meets the Art World"`, `journal: "The CRISPR Journal"`, `doi: 10.1089/crispr.2018.0035`, `author: "Medina, Miguel Ángel"`, `year: "2018"` |
| **A2** fast-download | `fast-download link was filtered out; got: ["…/get.php?md5=…&key=…"]` | ссылка из API первой в списке, `direct: true`; «голый» корень по-прежнему отброшен |
| **A3** пустой список зеркал | `promise never settled — fetchFromMirrors hung on []` (сторожок на 2000 мс) | реджектится за **0.83 мс** с текстом `No empty-group mirror configured: … Set the matching BIBLIO_*_MIRRORS …` |
| **A4** таймаут тела | `getText`, `fetchFromMirrors`, `downloadToFile` — все три «hung» | **504.8 / 502.5 / 505.0 мс** при `BIBLIO_TIMEOUT_MS=500` |
| **A15** инсталлятор | выходил с кодом **0**, найдя npm (настоящий `npm install` падает в arborist через ~40 с) | `FAIL no package manager found — install pnpm: npm install -g pnpm`, тест занимает **116 мс** |

**Как устроены новые тесты.** Ни один не подменяет разметку догадкой:

- `test/parsers.test.mjs` — `searchPapers` на **снятой** фикстуре `libgen-scimag.html` и `search`
  на `libgen-books.html`, с локального сервера. Ожидаемые значения вычитаны из фикстур, а не из
  того, что возвращает парсер. Там же регрессионная охрана книжной раскладки: у книг все значимые
  якоря **вне** `<b>`, у scimag журнал — **внутри**, и именно это различие делает правку безопасной.
- `test/downloads.test.mjs` — `resolveDownloads` против локального фейкового зеркала Anna's,
  отдающего `/dyn/api/fast_download.json`. Проверяет **обе** стороны: верифицированная ссылка
  проходит, «голый» домен по-прежнему отбрасывается (фильтр не удалён, ему дали исключение).
- `test/http-timeout.test.mjs` — сервер, который шлёт заголовки и зависает на теле, плюс сторожок
  с ограничением по времени: зависший вызов **проваливает тест**, а не висит вместе с ним.
- `test/install.test.mjs` — PATH, в котором есть node/npm/git, но нет pnpm: ровно форма стоковой
  Linux-машины, на которой откат и срабатывал.

**Замеры набора:** офлайн **92 → 105** тестов, `pnpm test` **9.1 с** вместе со сборкой;
живые **2/2** за 15.6 с. Прогнано полностью, как это делает CI: `typecheck` ✓ · `build` ✓ ·
`test` 105/105 ✓ · `test:live` 2/2 ✓ · stdio smoke-check из `ci.yml` ✓ (`biblio-mcp v1.6.0 ready
on stdio`) · `install.mjs --dry-run` rc=0, «install complete» ✓ · `selfcheck` «selfcheck passed» ✓.

**Живая проверка A1 через настоящий MCP-клиент** (не прямым вызовом провайдера):
`search_papers({query:"CRISPR gene editing", limit:3})` вернул три строки с настоящими названиями
статей, журналами и DOI — `top-level keys: query, total, results`.

**Расхождения с планом — четыре, все осознанные.**

1. **A15 сделана в фазе 1, а по списку фаз она в фазе 2.** Она стоит в строке **P0** сводки и
   правится десятью строками, поэтому тащить её отдельной фазой смысла нет. Вынесена в
   **собственный коммит** `a9bc3a4`, чтобы откатывалась независимо от A1–A4.

2. **`fromEnv` я не менял.** План предлагал «опционально» считать значение из пробелов
   незаданным. Не стал: пустой список зеркал — законный способ выключить источник, и теперь вызов
   честно падает сразу, называя переменную. Менять семантику, чтобы замаскировать симптом, хуже.

3. **`probeMirror` не трогал.** Он уже корректен: таймер чистится во внешнем `finally`, то есть
   покрывает и чтение тела. Проверено чтением кода, а не по памяти.

4. **Первая живая проверка A1 дала HTTP 404 со всех семи зеркал Libgen.** Это троттлинг после
   серии запросов, а не регрессия: тот же вызов через 45 с прошёл. Записываю, чтобы следующий
   прогон не принял 404 за поломку парсера.

**Что осталось из P0-соседей:** **A9** (`parseSize`, множитель KB→TB `1/1048576` вместо
`1/1073741824`) — по-прежнему на месте, это фаза 2.

**Гарантия отсутствия регрессий.** Поле `DownloadLink.verified` — опциональное и аддитивное,
формат ответов инструментов не сломан. Книжный парсинг не изменился: правка отбрасывает только
якоря **внутри** `<b>`, а в снятой книжной фикстуре таких нет. Подтверждение — 105/105 офлайн
(включая все четыре drift-охраны) и 2/2 живых.

### Фаза 2 — остальные баги и честность отчётов ✅ ВЫПОЛНЕНА (`ea277f2`)

Закрыты A5–A14 (circuit breaker, mirror health state, download cleanup/hash reporting, shared
validators, installer `--live`, source validation/deduplication и короткие source errors), а также
C5 и C8. D8, D10 и D11 из таблицы выше уже были исправлены здесь, поэтому в фазе 4 не повторялись.
A15 закрыта отдельным коммитом `a9bc3a4` в фазе 1; A16 при этом осталась открытой.

### Фаза 3 — скорость ✅ ВЫПОЛНЕНА (`1bf3826`, релиз `5537fee`, v1.8.0)

Выполнены кэши и оптимизации B1–B8; benchmark и результаты внесены в CHANGELOG. В одном живом
замере warm `search_books` и `book_details` достигли целей ≤800/≤700 мс. Цель `pnpm test < 5 с`
не достигнута: текущий changelog фиксирует около 10.9 с на 132 теста после адаптивного concurrency.

### Фаза 4 — рефакторинг и сокращение ✅ ВЫПОЛНЕНА (2026-10-08)

В порядке отдельных рефакторингов завершены D2 (`bb01bc6`) → D3 (`faae672`) → D4 (`480226f`) →
D5 (`90877e7`) → D6 (`6b72678`) → D9 и D7 (`2fdec09`). D8/D10/D11 уже были закрыты в фазе 2;
D12 — в фазе 0. D1 выполнен последним отдельным коммитом, включающим этот worklog.

**Итог и пересмотр LOC-критерия.** `PATH=/tmp/biblio-bin:$PATH pnpm run verify` зелёный;
137/137 тестов и selfcheck passed (условие ≥87 выполнено). Для сопоставимого набора `.ts`/`.mjs`
`f6c4e42` уже содержал 5487 строк — больше исходного лимита 4700; до D1 рабочее дерево выросло до
7127, а после D1 имеет 6500. То есть старый лимит требовал бы удалить 2427 строк до D1 и всё ещё
остаётся на 1800 строк ниже текущего результата. Его нельзя считать актуальной мерой рефакторинга:
это создало бы стимул удалять regression tests и captured fixtures. Ничего из тестов/фикстур не
удалялось; rationale, область подсчёта и измерения записаны в `docs/decisions.md`.

### Фаза 5 — DX/AX и документация — ✅ ЗАВЕРШЕНА (2026-10-08)

- **C6:** добавлен `AGENTS.md` с процессом обновления mirrors/providers, безопасного захвата
  настоящих HTML-фикстур и разделением offline/live verification.
- **C7:** `search_papers` принимает `resolvePdfs` (по умолчанию `false`). При включении делает
  последовательные best-effort Sci-Hub lookup максимум для трёх DOI; `pdfUrl` прикрепляется
  только из прямого PDF embed URL, а сбой enrichment не ломает успешный поиск Libgen. Тесты
  проверяют default-off, cap в 3 lookup и отсутствие `pdfUrl` для article landing page.
- **C9:** компактный Quick Start теперь сразу после badges; длинное fork-объяснение перенесено ниже.
  Roadmap и таблица инструмента синхронизированы с оставшимся A16 и новым параметром.
- **C10:** `package.json` выставляет `"private": true`; regression test защищает от случайной
  публикации под npm-именем, принадлежащим upstream. Source install и `npm pack`-проверки сохранены.
- Проверка: `pnpm run verify` прошла: строгая проверка типов, сборка, **140/140 офлайн-тестов**
  и live `selfcheck passed`; MCP surface — 7 инструментов. `git diff --check` чистый. На момент
  проверки доступны 3/3 зеркала Anna's Archive, 3/7 Libgen, 5/6 Sci-Hub и 0/4 Z-Library
  (изменчивый сетевой snapshot).

---

## Приложение · как воспроизвести находки

```bash
git clone https://github.com/vernikr/biblio-mcp.git && cd biblio-mcp
pnpm install --frozen-lockfile && pnpm run build

# A3 — пустой список зеркал: промис не завершается никогда.
# setInterval нужен, чтобы процесс не вышел сам по пустому event loop —
# в MCP-сервере эту роль играет stdio-транспорт, поэтому там tool call висит вечно.
BIBLIO_ZLIB_MIRRORS=" " timeout 5 node -e 'setInterval(()=>{},1e9);
  import("./dist/providers/index.js")
    .then(m => m.searchBooks("dune", ["zlibrary"], 5))
    .then(r => console.log("never gets here", r.results.length));'
echo "rc=$?   # 124 = так и не завершился"

# A1 — search_papers отдаёт журнал
node -e 'import("./dist/providers/index.js").then(async m =>
  console.log(await m.libgen.searchPapers("CRISPR gene editing", 3)));'

# A2 — фильтр выбрасывает fast-download URL
node -e 'import("./dist/parse.js").then(m => console.log(
  m.isUsefulLink("https://cdn.example/dl/9f2a/book.epub", "5".repeat(32))));'   # false

# C3 — мёртвый код
./node_modules/.bin/tsc --noEmit --noUnusedLocals --noUnusedParameters

# B9 — где утекают 21 секунды
for f in test/*.test.mjs; do echo "$f"; node --test "$f" >/dev/null; done
```

---

### Сводка по приоритету

| Приоритет | Находки | Эффект |
|---|---|---|
| **P0** | ~~A1, A2, A3, A4, A15~~ **все закрыты в фазе 1** | два инструмента начали работать; вечный hang исчез; таймаут стал настоящим |
| **P1** | A5, B1-B5, C1, C2 | поиск в ~3 раза быстрее, CI перестаёт зависеть от sci-hub, парсеры покрыты |
| **P2** | A6-A14, B6-B9, C3-C8 | честные отчёты, меньше мусора в ответах агента |
| **P3** | D1-D12, C9, C10 | −20…−25% кода, читаемая структура, понятный README |
