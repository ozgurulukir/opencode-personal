# Web package guide

This package follows the root [AGENTS.md](../../AGENTS.md) for general repo rules.

## Typecheck

`bun run typecheck` (= `astro check`) is wired into turbo, pre-push, and CI.

## Share viewer — removed

The web share viewer tree (`Share.tsx`, `share/`, `icons/`) was deleted
(#374): its pages were removed earlier and share viewing is external
(opncd.ai, per `content/docs/share.mdx`). Do not re-add SolidJS to this
package — `@astrojs/solid-js` was removed from `astro.config.mjs` and the
solid/shiki/marked/luxon/lang-map dependency tail was pruned from
`package.json`. Sharing stays external; the external share API producer
(`share-next`) lives server-side, not here.

## Translated docs (English + Turkish only)

Docs ship in English (root) and Turkish (`content/docs/tr/`); only `root` + `tr` locales are configured (`astro.config.mjs`). `content/docs/tr/skills.mdx` keeps code blocks byte-identical to the English source; only prose is translated. When editing shared code lines, apply the identical change to the English page and its `tr/` mirror; prose changes must be translated.
