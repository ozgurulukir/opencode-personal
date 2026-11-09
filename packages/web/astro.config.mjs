// @ts-check
import { defineConfig } from "astro/config"
import starlight from "@astrojs/starlight"
import solidJs from "@astrojs/solid-js"
import config from "./config.mjs"
import { rehypeHeadingIds, unified } from "@astrojs/markdown-remark"
import rehypeAutolinkHeadings from "rehype-autolink-headings"

// https://astro.build/config
export default defineConfig({
  site: config.url,
  base: config.base,
  output: "static",
  devToolbar: {
    enabled: false,
  },
  server: {
    host: "0.0.0.0",
  },
  markdown: {
    processor: unified({
      rehypePlugins: [rehypeHeadingIds, [rehypeAutolinkHeadings, { behavior: "wrap" }]],
    }),
  },
  build: {},
  integrations: [
    solidJs(),
    starlight({
      title: "OpenCode Personal",
      defaultLocale: "root",
      locales: {
        root: {
          label: "English",
          lang: "en",
          dir: "ltr",
        },
        tr: {
          label: "T\u00fcrk\u00e7e",
          lang: "tr-TR",
          dir: "ltr",
        },
      },
      favicon: "/favicon-v3.svg",
      head: [
        {
          tag: "link",
          attrs: {
            rel: "icon",
            href: `${config.base}/favicon-v3.ico`,
            sizes: "32x32",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "icon",
            type: "image/png",
            href: `${config.base}/favicon-96x96-v3.png`,
            sizes: "96x96",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: `${config.base}/apple-touch-icon-v3.png`,
            sizes: "180x180",
          },
        },
      ],
      lastUpdated: true,
      expressiveCode: { themes: ["github-light", "github-dark"] },
      social: [{ icon: "github", label: "GitHub", href: config.github }],
      editLink: { baseUrl: `${config.github}/edit/main/packages/web/src/content/docs/` },
      markdown: {
        headingLinks: false,
      },
      customCss: ["./src/styles/custom.css"],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        alt: "OpenCode Personal",
        replacesTitle: true,
      },
      sidebar: [
        "",
        "config",
        "providers",
        "network",
        "troubleshooting",
        {
          label: "Windows",
          translations: {
            en: "Windows",
            "tr-TR": "Windows",
          },
          link: "windows-wsl",
        },
        {
          label: "Usage",
          translations: {
            en: "Usage",
            "tr-TR": "Kullanım",
          },
          items: ["tui", "cli", "web", "ide", "github", "gitlab", "share"],
        },

        {
          label: "Configure",
          translations: {
            en: "Configure",
            "tr-TR": "Yapılandırma",
          },
          items: [
            "tools",
            "rules",
            "agents",
            "models",
            "themes",
            "keybinds",
            "commands",
            "formatters",
            "permissions",
            "lsp",
            "mcp-servers",
            "acp",
            "skills",
            "custom-tools",
          ],
        },

        {
          label: "Develop",
          translations: {
            en: "Develop",
            "tr-TR": "Geliştirme",
          },
          items: ["sdk", "server", "plugins", "ecosystem"],
        },
      ],
      components: {
        Head: "./src/components/Head.astro",
        Hero: "./src/components/Hero.astro",
        Header: "./src/components/Header.astro",
        Footer: "./src/components/Footer.astro",
        SiteTitle: "./src/components/SiteTitle.astro",
      },
    }),
  ],
})
