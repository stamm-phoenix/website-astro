# Stamm Phoenix Website [![Netlify Status](https://api.netlify.com/api/v1/badges/7641b158-13fe-415b-863d-2af05a1d7fc9/deploy-status)](https://app.netlify.com/projects/stamm-phoenix-astro/deploys)
Modern website for the DPSG Stamm Phoenix built with Astro, styled with Tailwind CSS, and deployed on Netlify.

Current development: [dev.stamm-phoenix.de](https://dev.stamm-phoenix.de)

## Tech stack
- Astro 5
- Tailwind CSS 4 (tokens in src/styles/global.css)
- Netlify (builds, preview, deploy)
- Sveltia CMS (headless CMS) via /admin
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
- src/pages/admin.html: CMS entry point (loads Sveltia)

## Content management (Sveltia CMS)
- Admin UI at /admin (requires Auth0 authentication)
- GitHub backend for data persistence
- Blog collection stored in src/content/blog/*.md
- Gruppenstunden collection stored in src/content/gruppenstunden/*.json
- Media uploaded to public/images/uploads (served from /images/uploads)
- Auth0 integration protects CMS access

## Notes
- Tailwind: prefers tokens in global.css; additional config exists in tailwind.config.cjs for legacy paths.
- Blog routing: list at /blog, detail at /blog/[slug]
- Events calendar: /aktionen with detail pages at /aktionen/[uid]
- Accessibility: skip link and semantic headings on homepage

## Links
- Astro: https://astro.build
- Tailwind CSS: https://tailwindcss.com
- Decap CMS: https://decapcms.org
- Sveltia CMS: https://github.com/sveltia/sveltia-cms
- Netlify project: https://app.netlify.com/projects/stamm-phoenix-astro/deploys
