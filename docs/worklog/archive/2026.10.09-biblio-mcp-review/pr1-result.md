# PR 1 — установка и сохранность данных

**Выполнено и запушено в GitHub `main`.** Исправлены F1, F2 и F3 из плана. Три отдельных коммита отправлены обычным fast-forward push без force; GitHub API подтвердил HEAD [`40c5630`](https://github.com/vernikr/biblio-mcp/commit/40c563032fdad138e7af2ce0ff235234b6602f9b). Pull request не открывался. Публикация npm/MCPB не выполнялась.

- База: `vernikr/biblio-mcp`, `main@e9b30ca60de1f954e91f69fcd66735f526f18b30`.
- Рабочая копия: `biblio-mcp-review/repo/`.
- Рабочая и опубликованная ветка: `main`; исходная локальная ветка `fix/pr1-install-data-safety` сохранена.
- HEAD: `40c563032fdad138e7af2ce0ff235234b6602f9b`.
- Проверено на Linux, Node `20.20.2`, pnpm `12.10.1`.

## Что изменено

### F1. Чистая установка

В `scripts/install.mjs` порядок теперь такой: Node/package manager → получение исходников → установка зависимостей → dependency preflight → build → проверка настоящего tool call → конфигурация. Для pnpm-locked checkout используется `--frozen-lockfile`; неподдерживаемый Node останавливает работу до получения исходников. Проверка несовместимой пары SDK/Zod не отключена и остаётся перед сборкой.

Существующий end-to-end тест усилен: он начинает с отдельной копии без `node_modules` и `dist`, действительно устанавливает зависимости из подготовленного pnpm-store в offline-режиме, собирает проект, проверяет tools и записывает конфиг. Проверяются неизменность lockfile, отсутствие npm lockfile и сохранение чужого сервера/поля конфигурации. Отдельный тест моделирует некорректную установку и запускает реальный preflight до попытки сборки.

### F2. Конфигурация не получает ложный успех

Корневой JSON и существующий `mcpServers` должны быть объектами, не массивами/null/скалярами. Отсутствующий `mcpServers` по-прежнему разрешён. Проверки выполняются до backup/write. При некорректной структуре installer возвращает exit 1 и не изменяет конфиг, предыдущий `.bak` или `.tmp`.

Пять неправильных типов проверены через CLI даже в dry-run; массив дополнительно проверен полным реальным installer. Положительный merge сохраняет чужие серверы и поля.

### F3. Атомарная защита заданного имени

В `src/server.ts` для явно заданного `filename` используется атомарный hard link из уникального staging в том же каталоге. Проверка существования до скачивания сохранена как быстрый отказ, но безопасность больше не зависит от неё.

- Файл, созданный между precheck и завершением загрузки, не заменяется.
- Из двух одновременно начавшихся загрузок в одно заданное имя ровно одна публикует результат.
- Ошибка публикации возвращается сразу: скачивание не повторяется с другого URL.
- Без hard-link поддержки операция завершается ошибкой, без небезопасного fallback на `rename`.
- Обычные staging/`.part` файлы убираются; тесты проверяют содержимое каталога после отказа и успешной гонки.
- **Default MD5-based имена сохраняют прежнее поведение замены.** Этот контракт не менялся.

Обновлены README cover, описание `filename` в MCP schema, ограничения и decisions. Повтор инструкции clone/install в README → One command заменён ссылкой на Quick start. AGENTS объясняет подготовку pnpm-store для offline install-тестов.

## Проверки

| Проверка | Результат |
|---|---|
| `pnpm run typecheck` | Успешно |
| `pnpm run test` — сборка + полный offline suite | **179/179**, 0 fail/skipped/todo; runner около **14,5 с**, сборка отдельно |
| `node scripts/preflight.mjs --require-build` | Успешно |
| Реальный stdio subprocess через SDK | Initialize, все 7 tools, invalid call с `isError: true`; ошибок протокола нет, ready-диагностика в stderr |
| Гонка двух загрузок в одно заданное имя | **8/8 независимых запусков**, ровно один победитель |
| Regression red → green | F1: 3 падения до фикса; F2: 6; F3: 3. Логи сохранены отдельно |
| `git diff --check` | Успешно |
| Патч на исходном чистом снимке / reverse-check на изменённом дереве | Оба успешны |

Новые и усиленные негативные сценарии сначала проверены на предшествующей реализации; после соответствующего исправления — зелёные. Baseline был 167 тестов: добавлено 12, один прежний merge-тест усилен до настоящей чистой установки. Уникальные сценарии и genuine fixtures не удалялись.

**Границы:** live mirror checks и `pnpm run verify` (он пока включает live selfcheck) не запускались. Поиск/скачивание проверялись на локальных HTTP-стендах с тестовыми байтами. Отказ без hard-link поддержки смоделирован через filesystem API; Windows/macOS и отдельные unsupported filesystems физически не проверялись. Node floor, CI-grep assertions и остальные F4–F9 оставлены следующим этапам.

## Коммиты и объём

| Коммит | Изменение |
|---|---|
| `bed58a2` | install locked dependencies before preflight |
| `a9b5c55` | validate MCP config before touching backups |
| `40c5630` | publish caller filenames without clobbering |

Изменены **7 файлов**: `scripts/install.mjs`, `src/server.ts`, два тестовых файла, README, AGENTS, decisions. Дельта строк: runtime **+15**, scripts **+12**, tests **+201**, Markdown **+2**. Основной рост — регрессионная проверка; production-код вырос всего на 27 строк. Новых runtime dependencies нет; `package.json`, lockfile и captures не менялись.

## Готовые файлы

- [`pr1.patch`](pr1.patch) — единый патч от зафиксированной базы. На чистом checkout подходящей версии: `git apply --check /path/pr1.patch`, затем `git apply /path/pr1.patch`.
- [`pr1-source.zip`](pr1-source.zip) — все исходники с исправлениями, без зависимостей и generated build.
- `pr1-commits/` — три отдельных mail patches для `git am /path/pr1-commits/*.patch`, если нужно сохранить разделение коммитов.
- `pr1-typecheck.log`, `pr1-tests.log`, `pr1-preflight.log`, `pr1-stdio.json`, `pr1-race-stress.log`, `pr1-f{1,2,3}-{red,green}.log` — результаты проверок. SDK stdio smoke можно повторить командой `node reproductions/pr1-stdio.mjs` после установки/сборки.

**Далее по порядку: PR 2** — F7/F8/F9, X1, docs:env и согласование Node floor. Релизная упаковка pnpm/npx + MCPB остаётся отдельным согласованным этапом между PR 2 и PR 3.
