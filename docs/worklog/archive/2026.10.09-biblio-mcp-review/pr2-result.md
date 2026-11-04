# PR 2 — офлайн-gate и реальные DX-проверки

**Выполнено и запушено прямо в GitHub `main`, без force.**

- База: `40c563032fdad138e7af2ce0ff235234b6602f9b`.
- HEAD: [`e07743a`](https://github.com/vernikr/biblio-mcp/commit/e07743a61f18a85d2a07edd1d798a794da94206e).
- [Все изменения этапа](https://github.com/vernikr/biblio-mcp/compare/40c563032fdad138e7af2ce0ff235234b6602f9b...e07743a61f18a85d2a07edd1d798a794da94206e).
- [GitHub Actions](https://github.com/vernikr/biblio-mcp/actions/runs/37847481797): **успех всех пяти jobs**, включая build на Node 18.19/20/22, точный runtime floor и optional live.
- Push подтверждён через Git remote и GitHub API; локальная `main` синхронизирована с `origin/main`.

## Что сделано

### F7 — настройки и подсказки

- `BIBLIO_MIRROR_STAGGER_MS=0` действительно отключает staggering.
- Ноль разрешён только для stagger; timeout/TTL сохраняют положительные значения, а неправильный/пустой ввод — fallback.
- Пустой Z-Library mirror list рекомендует реальную настройку `BIBLIO_ZLIB_MIRRORS`. Старый HTTP-тест, закреплявший неправильное имя, исправлен; сценарий немедленного отказа сохранён.

### F9 — входная граница MCP

Один `z.string().trim().min(1)` используется для двух поисков и `get_paper.identifier`. Пустые/пробельные строки отклоняются с читаемой ошибкой **до provider requests**. Непустые query/DOI/URL сохраняются после удаления краевого whitespace.

### F8/X1 — проверяется результат, а не видимость работы

- Новый обычный offline-тест запускает настоящий subprocess через SDK `StdioClientTransport`: initialize → все 7 tools → invalid `book_details` call → ожидаемый MD5 validation result. Протокольные ошибки stdout отслеживаются отдельно.
- Shell-grep smoke step из CI удалён: теперь CI запускает тот же `verify`, что разработчик.
- Startup и tools stage используют одну проверку: наличие tools и **именно ожидаемая ошибка валидации**. Произвольный `isError` больше не считается здоровым ответом; refusal/bypass проверены через настоящий entry point.
- Слабый «resolved directory» тест честно переименован в schema test; результат реального скачивания в HOME-relative directory проверяется отдельно.
- **Исторический CI-тест с реально несовместимыми SDK 1.12.1/Zod 4 сохранён.**

### Один offline gate и свежие docs

- `pnpm run verify`: typecheck → test со своей **одной сборкой** → `selfcheck:offline`.
- `--selfcheck --offline`: preflight + required tools + настоящий invalid call, без mirrors/live queries.
- Обычный selfcheck и `--live` сохранили сетевые стадии; `verify:live` запускает их явно. Несовместимые флаги отклоняются до запросов.
- Installer использует этот CLI вместо встроенного `node -e`/JSON parsing и отдельной реализации проверки.
- `pnpm run docs:env` строит свежий `dist` перед существующим генератором. Тест меняет source в отдельной копии и проверяет новый README, а не старую сборку. Import в генераторе переведён на file URL.
- README/AGENTS/STATE/decisions и command hints синхронизированы. В STATE исправлено ложное объяснение существующего download timer; контракт F4 ещё не менялся.

## Node: важное уточнение по результатам реального запуска

Runtime floor **18.17** согласован в engines/installer/preflight/docs и проверяется отдельным CI job на **18.17.0**. Но старый Node 18 test runner имеет отличия root after-hooks и не поддерживает `--test-concurrency`; полный HTTP fixture suite на 18.17 может не завершиться.

Поэтому **для полного suite требуется Node 18.19+**: скрипт выдаёт понятный ранний отказ на более старом Node 18, CI проверяет 18.19/20/22, а точный runtime 18.17 — отдельным offline/stdio набором. Это не повышение runtime floor до нового major. Один тест использует существующие HTTP start/close helpers вместо незакрытых keep-alive соединений.

## Проверки и отрицательное доказательство

| Проверка | Результат |
|---|---|
| Полный `pnpm run verify`, Node 20.20.2 | **203/203**, 0 fail/skipped/todo; offline selfcheck успешен |
| Полный suite, реальный Node 18.19.0 | **203/203**, без пропусков |
| Точный runtime Node 18.17.0 | **28/28** offline/stdio/schema/preflight smoke tests |
| `verify` с запретом внешнего fetch/TCP | Успех; **0 внешних попыток**, **1 top-level build** |
| Удалён ответ на invalid tools/call, но initialize/list сохранены | Новый stdio-тест падает по request timeout, как и должен |
| Новые/усиленные regressions до исправления | Настройки: 2 красных; входная граница: 8; offline/startup/maintenance: 9 |
| `docs:env`, strict preflight, typecheck, YAML syntax, `git diff --check` | Успешно |
| GitHub CI | **Все 5 jobs зелёные** |

Локальные проверки использовали только HTTP-стенды/тестовые байты и блокирование внешней сети. Локальный `verify:live` не запускался; optional live job прошёл в GitHub CI. Windows/macOS не проверялись.

## Коммиты и объём

1. `37a1483` — zero stagger / реальный Z-Library override.
2. `f23e816` — пустой поиск отклоняется до сети.
3. `e07743a` — single-build offline gate, фактический MCP response, docs:env и Node policy.

25 изменённых файлов. Дельта: **runtime −26 строк**, **scripts −20**, **tests +268**, **Markdown +15**, **CI −24**, `package.json +3`. Production-код сокращён на **46 строк**; рост общего объёма — регрессионные проверки. Новых зависимостей нет; lockfile и genuine captures не менялись. `private: true`, версия 1.8.0 и upstream npm name сохранены — npm/MCPB ещё не опубликованы.

Результаты сохранены в `pr2-verify.log`, `pr2-verify-offline.log`, `pr2-node18-suite.log`, `pr2-node18-smoke.log`, `pr2-stdio-mutation.log`, `pr2-ci-jobs.json`, `pr2-push.json`. Диагностические timeout попытки на старом test runner не выдаются за успешный полный прогон; соответствующие процессы остановлены.

**Следующий этап по согласованному порядку — PR 2b:** один готовый runtime, пакет с pnpm/npx и MCPB; consumer installation отдельно от Development.
