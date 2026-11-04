> **Архив (2026-10-10).** Это снимок состояния на дату этапа, а не текущая инструкция.
> Текущая точка входа для агента — [`AGENTS.md`](../../../AGENTS.md); текущее состояние —
> [`docs/STATE.md`](../../../STATE.md).
>
# Biblio MCP review archive

Все материалы `biblio-mcp-review` перенесены сюда: план, результаты этапов, red/green логи,
CI receipts, dependency audits, snapshots, patches, release artifacts и reproductions.

**Начинайте с [HANDOFF.md](HANDOFF.md)** — там текущий статус и следующий шаг. Старые отчёты
фиксируют состояние на дату своего этапа, а не сегодняшнее состояние registry/release.

Рабочий checkout не вложен внутрь собственного архива: это корень репозитория. В sandbox он
перенесён из `/home/user/biblio-mcp-review/repo` в `/home/user/biblio-mcp`. Старый внешний путь
`/home/user/biblio-mcp-review` оставлен как локальный alias к этому архиву, не как второй checkout.

Исторические логи намеренно сохраняют старые абсолютные пути. Reproductions и `tooling/`
помечены как исторические материалы: не запускайте их автоматически. Для повторной проверки
используйте актуальные команды из корня проекта и `scripts/check-artifacts.mjs`.

**Тяжёлые артефакты удалены из git (2026-10-10).** Две копии `.mcpb` (~11 МБ), две копии
`.tgz`, `source-snapshot.zip` и `pr1-source.zip` занимали ~11.7 МБ из 15 МБ репозитория — ровно
те же байты лежат в [GitHub release v2.0.0](https://github.com/vernikr/biblio-mcp/releases/tag/v2.0.0).
Их SHA-256 сохранены выше и в `published-artifacts/SHA256SUMS`. Копия исходников
`reproductions/fresh-checkout/` удалена: это снимок состояния, которое есть в истории git.

Все обычные материалы сохранены. `.git`, установленные `node_modules`, generated `dist`, caches
и credential files не публикуются; они не являются частью доказательств или переносимого исходника.
`archive-manifest.json` фиксирует содержимое и SHA-256 материалов перед финализацией.
