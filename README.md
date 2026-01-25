# Stamm Phoenix Website
Modern website for the DPSG Stamm Phoenix built with Astro, styled with Tailwind CSS, and deployed on Azure Static Web Apps.

Current development: [dev.stamm-phoenix.de](https://dev.stamm-phoenix.de)

## Tech stack
- Astro 5
- Tailwind CSS 4 (tokens in src/styles/global.css)
- Azure Static Web Apps (builds, preview, deploy)
- TypeScript (Astro components and content types)

## Getting started
- Node 18+ recommended (enable Corepack: corepack enable)
- Install: pnpm install
- Develop: pnpm dev (http://localhost:4321)
- Build: pnpm build → outputs to dist
- Preview build: pnpm preview

## Project structure
- src/pages: route-based pages (/, /blog, /aktionen, /gruppenstunden, /mitmachen)
- src/layouts: Base layout and legacy Layout
- src/components: shared UI (Header, Footer, etc.)
- src/styles/global.css: Tailwind v4 setup and design tokens
- src/content/blog: Markdown posts (frontmatter: title, date, author, description)
- src/content/gruppenstunden: JSON data for group session times and details
- src/content.config.ts: Content collection schemas (blog, gruppenstunden)
- public/admin: CMS config (config.yml) and assets

## Notes
- Tailwind: prefers tokens in global.css; additional config exists in tailwind.config.cjs for legacy paths.
- Blog routing: list at /blog, detail at /blog/[slug]
- Events calendar: /aktionen with detail pages at /aktionen/[uid]
- Accessibility: skip link and semantic headings on homepage

## Links
- Astro: https://astro.build
- Tailwind CSS: https://tailwindcss.com
- Decap CMS: https://decapcms.org
- Azure Static Web Apps: https://github.com/stamm-phoenix/website-astro/actions
