> **Архив (2026-10-10).** Это снимок состояния на дату этапа, а не текущая инструкция.
> Текущая точка входа для агента — [`AGENTS.md`](../../../AGENTS.md); текущее состояние —
> [`docs/STATE.md`](../../../STATE.md).
>
# HANDOFF — Biblio MCP 2.0.0

**Дата: 9 октября 2026. Это активная точка входа для следующего агента.** Старые отчёты и
снимки рядом — доказательства состояния на дату этапа, не текущие инструкции.

## Текущий статус

- Репозиторий: [`vernikr/biblio-mcp`](https://github.com/vernikr/biblio-mcp), рабочая ветка **main**.
- npm **опубликован**: [`@vernikr/biblio-mcp@2.0.0`](https://www.npmjs.com/package/@vernikr/biblio-mcp), public/latest.
  Registry tarball скачан и совпадает с проверенным файлом; см. [`npm-publication.json`](npm-publication.json).
- GitHub release **[v2.0.0 опубликован](https://github.com/vernikr/biblio-mcp/releases/tag/v2.0.0)**:
  `.tgz`, `.mcpb`, `SHA256SUMS`. Публичные downloads совпадают по SHA-256; см. [`github-release.json`](github-release.json).
  Tag указывает на проверенный release checkpoint `f407884`; последующие main commits — только закрытие handoff receipts.
- Runtime: **Node 22+**, CI проверяет LTS 22/24 и точный минимум 22.0.0.
- Артефакты, совпадающие с npm: [`published-artifacts/`](published-artifacts/). `release-artifacts/` —
  более ранний, подготовленный вариант до публикации; не публикуйте его повторно под 2.0.0.
- Материалы ревью полностью перенесены в `docs/worklog/biblio-mcp-review/`. В sandbox checkout —
  `/home/user/biblio-mcp`; переносимый ориентир для другого агента — **корень Git checkout**.

## Что завершено

1. **PR1 (F1/F2/F3)** — locked install до dependency preflight, config validation до backup,
   атомарный no-clobber для явных filenames. Default MD5 filenames сохраняют replacement contract.
2. **PR2 (F7/F8/F9, X1/X2)** — stagger=0, правильное имя Z-Library override, пустой ввод до сети,
   SDK stdio result вместо CI grep, single-build offline `verify`, свежий `docs:env`.
3. **PR2b + deps** — собственный npm scope, один compiled runtime для npm/MCPB, hoisted locked
   production deployment, consumer Quick start отдельно от development. SDK 1.32.1, Zod 4.6.5,
   Cheerio 1.2.0, TS 7.0.2, tsx 4.23.15, Node types 22.20.5; pnpm 12.10.1.
4. Истинные npm registry launches: **cold npx** (отдельный cache/prefix) и **pnpm dlx** без локального
   tarball substitute проверены после публикации — initialize/list/invalid-call/полное скачивание.
   См. [`published-registry-launchers.log`](published-registry-launchers.log).

## Быстрый старт агента

Из корня checkout, Node 22 или 24 LTS и pnpm 12.10.1:

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run package:verify
# Только для УЖЕ опубликованной текущей версии:
node scripts/check-artifacts.mjs --registry
```

`verify` — offline, **одна top-level сборка**, локальные HTTP fixtures; dependency-install fixtures
работают offline из прогретого pnpm store. Нужен pnpm на PATH, иначе некоторые installer tests
будут skipped: для приёмки нужен полный прогон без skips. `package:verify` и cold launchers могут
использовать **npm registry**, но не живые shadow-library mirrors. Live: `pnpm run verify:live`
отдельно. Generated `artifacts/`, `dist/`, `node_modules` не коммитить.

Проверки до передачи: **216/216** offline tests на Node 22/24 (PR3: 203 прежних + 12 новых; R2/X3: +1), **28/28** на 22.0.0; acceptance
npm/npx/pnpm/MCPB с настоящими сохранёнными байтами. Последний зелёный distribution CI:
[7/7 jobs](https://github.com/vernikr/biblio-mcp/actions/runs/37856503504), включая Linux/macOS/Windows.
Release checkpoint: **[7/7 jobs зелёные](https://github.com/vernikr/biblio-mcp/actions/runs/37863870454)**;
[`handoff-ci-checkpoint.json`](handoff-ci-checkpoint.json). Последний main CI виден в badge/workflows;
этот receipt закрепляет проверку commit, на который указывает release tag.

## Следующая работа — P3 (опционально), PR3 и PR4 выполнены

См. [план исполнения](plan.md#5-план-исполнения) и исторический baseline в `snapshot.json`.

**PR3 сделан (в main):** F4 — контракт выбран: `BIBLIO_DOWNLOAD_TIMEOUT_MS` = заголовки ответа,
тело защищено idle watchdog (`BIBLIO_DOWNLOAD_STALL_MS`), общий deadline отвергнут; F5 — outage
отделён от not-found (`get_download_links`/`download_book` возвращают `errors`/`notFound`);
F6 — no-PDF на одном зеркале не блокирует зеркало с PDF; R3 — DOM Libgen парсится один раз;
R4 — HTML-интерстициал отклоняется без чтения тела. Решения — `docs/decisions.md`.

**PR4 сделан:** общий MCP-клиент для тестов (`test/helpers/mcp.mjs`), общие HTTP-хелперы, мелкие
остатки в libgen/parse, устаревшие утверждения README/AGENTS/dependabot исправлены, аудит-worklog
помечен как снимок. Уникальные сценарии и provider captures сохранены (215/215 тестов).
Позже доделаны R2 (AJV-валидатор SDK в тестах) и MCP annotations. Оставшееся — решения и среда, не код: R7 (сокращение source-installer), повышение Node floor, Windows-проверка, `registerTool` (не обязателен).

## Инварианты и ограничения

- Прямое указание пользователя: завершённые изменения **пушить в main**, не отдельный PR.
  Fetch → сохранять чужие commits → проверить итоговый код → normal push. **Никакого force-push.**
- **2.0.0 уже immutable в npm.** При новых runtime changes нужна новая версия и новая проверенная
  публикация; не пытаться перепубликовать другой tarball под 2.0.0.
- SDK pinned. Readable argument errors переводят SDK diagnostic **без второго schema parse**;
  приватный validation hook не переписывать без negative tests. `_parse` compatibility regression в CI сохранён.
- Сохранить atomic filename protection, config/backup safety, bounded caches, circuits, loser cancellation,
  MD5/HTML checks и member-key restriction на verified hosts.
- Не решать human-verification/ALTCHA; не обещать доступность зеркал, marketplace/автообновления MCPB.
- Desktop GUI installation не проверялась: проверены manifest и actual runtime на трёх OS.
- Production audit: **0**. В MCPB build CLI остаётся dev-only unpatched node-forge RSA-verification
  advisory GHSA-86w9-cpqp-85rv. CLI signing/verification не используется, MCPB unsigned; библиотека
  отсутствует в runtime. Patched `tmp` pinned. Не подавлять warning и не делать вид, что full audit чистый.
- Credentials **не лежат в репозитории**. Не добавлять PAT/npm/member keys в документы или commit.
  Запрашивать доступ через безопасный environment/temporary auth при необходимости, не вставлять
  секреты в URL или постоянный `.npmrc`. npm authentication и GitHub PAT — разные права.

## Навигация по доказательствам

- [README архива](README.md), [`archive-manifest.json`](archive-manifest.json) — сохранённые материалы и hashes.
- [`pr1-result.md`](pr1-result.md), [`pr2-result.md`](pr2-result.md), [`pr2b-result.md`](pr2b-result.md) —
  исторические checkpoints с scope/проверками; pending publication в старом PR2b отчёте уже закрыта.
- [`npm-publish-eotp.log`](npm-publish-eotp.log) — первая попытка была заблокирована 2FA; новый token
  разрешил публикацию. [`npm-publish.log`](npm-publish.log) — успешная операция, без credential values.
- `published-artifacts/SHA256SUMS` — единственные hashes текущих published tarball/MCPB.
- Исторические reproductions сохраняют старые абсолютные пути/Node versions. Не запускать их
  автоматически; текущие gate/consumer scripts находятся в корневом `scripts/`.
