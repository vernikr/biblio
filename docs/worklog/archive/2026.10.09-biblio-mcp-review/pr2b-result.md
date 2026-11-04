# PR 2b — готовые артефакты и обновление зависимостей

**Выполнено, запушено прямо в GitHub `main`, без force.**

- HEAD: [`4625ba4`](https://github.com/vernikr/biblio-mcp/commit/4625ba452b5272393d22a1b60012fedc87936a25).
- [Изменения этапа](https://github.com/vernikr/biblio-mcp/compare/e07743a61f18a85d2a07edd1d798a794da94206e...4625ba452b5272393d22a1b60012fedc87936a25).
- [GitHub Actions](https://github.com/vernikr/biblio-mcp/actions/runs/37856503504): **7/7 jobs зелёные**, включая consumer acceptance на **Linux, macOS и Windows**.
- Пользователь подтвердил **Node 22+** и отдельное имя **`@vernikr/biblio-mcp`**.
- Версия подготовленного пакета — **2.0.0**: повышение major явно отражает прекращение поддержки Node 18/20.

## Готовые файлы

- [MCPB — 5,34 MiB](release-artifacts/vernikr-biblio-mcp-2.0.0.mcpb): готовый runtime с production dependencies, без pnpm/TypeScript/build для пользователя. Desktop-host должен предоставлять Node 22+.
- [npm tarball — около 48 KiB](release-artifacts/vernikr-biblio-mcp-2.0.0.tgz): устанавливается обычным npm, production dependencies подтягиваются из registry.
- [SHA256SUMS](release-artifacts/SHA256SUMS).

**В npm ещё не опубликовано.** Имя подтверждено, но права npm scope и registry authentication/trusted publishing не предоставлялись. GitHub PAT не является npm-токеном. Публичные pinned registry launcher examples в README явно помечены как доступные **после публикации**, а не обещаны работающими сегодня. GitHub Release/tag также не создавался; CI artifacts и файлы выше уже доступны.

## Мнение по обновлению зависимостей — и что поднято

Обновлять стоит: SDK имел security advisory, а инструменты разработки заметно устарели. Но «всё на максимальный номер» — плохой критерий: типы нужно согласовывать с поддерживаемым runtime, а свежие инструменты тоже могут иметь известные проблемы.

| Зависимость | Было | Стало |
|---|---|---|
| `@modelcontextprotocol/sdk` | 1.29.0 | **1.32.1** |
| `zod` | 4.4.3 | **4.6.5** |
| `cheerio` | 1.0.0 | **1.2.0** |
| `typescript` | 5.5.3 | **7.0.2** |
| `tsx` | 4.16.2 | **4.23.15** |
| `@types/node` | 20.14.9 | **22.20.5** |
| pnpm | 12.10.1 | Без изменения — уже актуален |

Типы взяты из ветки Node 22, не Node 26: это согласовано с минимальным поддерживаемым runtime. Все direct versions закреплены, lockfile обновлён. GitHub Actions также подняты до текущих стабильных Node-24-compatible releases: checkout 7.0.1, setup-node 7.1.0, upload-artifact 7.0.2, pnpm/action-setup 6.1.0.

### Совместимость и безопасность

- Новый SDK поменял diagnostic format. Первое обновление сделало старые проверки читаемых ошибок красными; адаптер исправлен **без второго schema parse и без ослабления тестов**. Отдельные red/green логи сохранены.
- TypeScript 7 прошёл typecheck/build и реальные installer fixtures. Удалена устаревшая compiler option; native tooling остаётся только в development.
- Runtime floor 22+ согласован в engines/installer/preflight/docs/CI; старые test-runner compatibility branches удалены. Точный 22.0.0 проверен отдельно.
- Production audit: **0 уязвимостей** вместо исходного high advisory SDK [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h). Он относится к OAuth-части, не используемой нашим локальным stdio.
- Для build tool MCPB используется `@anthropic-ai/mcpb@2.1.2`; patched `tmp@0.2.7` закреплён для его prompt dependency. В полном audit остаётся **один dev-only high advisory** `node-forge` [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv), без опубликованного исправления. Это RSA signature verification; signing/verification команды не используются. Наш MCPB **unsigned**, библиотека не поставляется в runtime. Ограничение документировано, не скрыто исключением audit.

## Один runtime — две поставки

- npm содержит `dist`, plain-JS preflight, README и LICENSE. Checkout installer не нужен пользователю и не входит в tarball.
- MCPB использует **те же runtime bytes** и locked production dependencies через `pnpm deploy --prod --node-linker=hoisted`.
- Первый symlink-based ZIP был непереносим: Node терял transitive dependency resolution. Hoisted deployment это исправил и уменьшил MCPB примерно с 19 MiB до 5,34 MiB.
- Manifest проходит официальную schema validation. В settings UI — optional sensitive member key и default excluded sources; остальные настройки доступны через обычный runtime environment.
- Preflight умеет scoped npm package и standalone MCPB, не требует checkout lockfile и не угадывает место зависимостей по фиксированным двум родительским директориям.
- Consumer Quick start отделён от Development. README сокращён на **43 строки** относительно базы этапа.

## Приёмка

`pnpm run package:verify` запускает обычный offline gate, затем строит и проверяет артефакты вне checkout. Ни один consumer не компилирует TypeScript.

Для **npm-install, npx с pinned version, cold pnpm dlx, warm offline pnpm dlx и распакованного MCPB** проверены:

1. Реальный SDK stdio initialize и версия 2.0.0.
2. Все семь tools.
3. Ожидаемый invalid-MD5 validation result.
4. Настоящий download из локального HTTP-стенда; полное содержимое PDF совпадает.
5. Файл сохраняется в отдельном пользовательском каталоге, **не в install/cache**.
6. Нет protocol errors/загрязнения stdout, нет TypeScript/tsx/MCPB build tool у consumer.
7. npm/MCPB compiled runtime совпадает побайтно; SHA-256 артефактов проверяется.

Пока версия не опубликована, tarball заменяет только registry address в dlx-тесте; pinned npx запускает эту же уже установленную версию. Публикация не симулируется.

Первый CI обнаружил неверное предположение об уже прогретом tarball cache свежего runner. Тест теперь делает настоящий cold registry bootstrap, затем повторный offline launch; Node bootstrapping ограничен временем. Повторный CI зелёный на всех трёх ОС.

| Проверка | Результат |
|---|---|
| Полный offline suite на Node 22/24 | **203/203**, 0 fail/skipped/todo |
| Точный минимум Node 22.0.0 | **28/28** offline/stdio/schema/preflight |
| Финальный `verify` с запретом внешних Node fetch/TCP | **203/203**, 0 внешних попыток, 1 top-level build |
| Реальные архивы и пять launcher recipes | Успех локально и CI на Linux/macOS/Windows |
| CI source builds 22/24, minimum runtime, optional live | Успех |
| Manifest, YAML, pinned lockfile, `git diff --check`, credential scan | Успех |

Claude Desktop GUI installation лично не выполнялась: CI проверяет manifest и реальный локальный runtime, не интерфейс приложения. Автоматические обновления/marketplace listing не обещаются.

## Коммиты и следующий шаг

- `14cf5f9` — stable dependencies + Node 22 support.
- `9065bd9` — scoped distribution, tarball/MCPB и consumer acceptance.
- `4625ba4` — cold/warm launcher CI и современные Actions.

Новое delivery/acceptance infrastructure — около 187 строк scripts; runtime вырос лишь на **11 строк**, в основном для SDK compatibility. Новых runtime dependency names нет. Genuine captures, сохранность файлов/конфига, caches/circuits и member-host protection сохранены.

По roadmap следующий кодовый этап — **PR 3: provider/download outcomes и сокращение parsing/HTTP payload**. Registry publication готовых артефактов остаётся отдельным шагом с npm scope access.
