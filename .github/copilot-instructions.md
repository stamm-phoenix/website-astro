# Stamm Phoenix Website - GitHub Copilot Instructions

**ALWAYS follow these instructions first and fallback to additional search and context gathering only if the information here is incomplete or found to be in error.**

Modern website for the DPSG Stamm Phoenix built with Astro 5, styled with Tailwind CSS 4, and deployed on Netlify. Features a headless CMS (Decap) and TypeScript components.

## Working Effectively

### Bootstrap and Setup

Run these commands in exact order to set up the development environment:

```bash
# Verify Node.js 18+ is installed
node --version  # Should be 18+ (tested with v20.19.5)

# Install pnpm if not available
npm install -g pnpm

# Install dependencies - NEVER CANCEL: Takes ~40 seconds
pnpm install  # Timeout: 300+ seconds

# Build the project - NEVER CANCEL: Takes ~6 seconds
pnpm build    # Timeout: 300+ seconds
```

**CRITICAL TIMING NOTES:**

- `pnpm install`: Takes 30-40 seconds. Set timeout to 300+ seconds. NEVER CANCEL.
- `pnpm build`: Takes 5-8 seconds. Very fast build process.
- Development server startup: Takes 2-3 seconds.

### Development Workflow

```bash
# Start development server (runs on http://localhost:4321)
pnpm dev

# Build for production
pnpm build  # Outputs to dist/ directory

# Preview command does NOT work (Netlify adapter limitation)
# DO NOT use: pnpm preview  # This will fail
```

## Validation Requirements

### ALWAYS Test These User Scenarios After Changes

After making any code changes, MUST validate these core user workflows:

1. **Homepage Navigation**
   - Visit http://localhost:4321/
   - Verify main navigation links work (Start, Gruppenstunden, Aktionen, Blog, Kontakt)
   - Test "Jetzt mitmachen" and "Gruppenstunden" hero buttons

2. **Blog Functionality**
   - Navigate to /blog
   - Verify blog post listing displays
   - Click through to individual blog post (/blog/2025-09-06-willkommen)

3. **Basic Page Loads**
   - Test /mitmachen page loads
   - Test /gruppenstunden page loads
   - Verify navigation consistency across pages

### Known Development Limitations

- `/aktionen` calendar page: **WILL FAIL** in local development due to external ICS URL (https://kalender.stamm-phoenix.de/aktionen.ics) being inaccessible
- `/admin` CMS page: **LIMITED FUNCTIONALITY** in local development due to external CDN restrictions
- `pnpm preview` command: **DOES NOT WORK** with Netlify adapter - this is expected behavior

## Project Structure and Key Locations

### Critical Files to Know

```
src/pages/               # Route-based pages (/, /blog, /aktionen, /gruppenstunden, /mitmachen)
├── index.astro         # Homepage
├── blog/               # Blog routes
├── aktionen/           # Calendar/events (external dependency)
├── gruppenstunden.astro # Group sessions page
├── mitmachen.astro     # Join us page
└── admin.html          # CMS entry point

src/components/         # Shared UI components
├── Header.astro       # Main navigation and auth logic
└── Footer.astro       # Site footer

src/layouts/           # Page layouts
└── BaseLayout.astro   # Main layout wrapper

src/styles/
└── global.css         # Tailwind v4 setup and design tokens

src/content/blog/      # Markdown blog posts
public/admin/          # CMS configuration
```

### Content Management

- **Blog posts**: Stored in `src/content/blog/*.md`
- **CMS Admin**: Accessible at `/admin` (Decap CMS)
- **Media uploads**: Go to `public/images/uploads/` (served from `/images/uploads`)

## Common Commands Reference

### Available npm Scripts

```bash
pnpm dev      # Start development server
pnpm build    # Build for production
pnpm astro    # Run Astro CLI commands
```

### No Linting/Testing Infrastructure

- **No ESLint**: No linting configuration exists
- **No Prettier**: No code formatting setup
- **No Tests**: No testing framework configured
- **No CI Linting**: GitHub Actions only handles deployment

## Technology Stack Details

### Core Technologies

- **Astro 5**: Static site generator with server-side rendering
- **Tailwind CSS 4**: Utility-first CSS with design tokens in `src/styles/global.css`
- **TypeScript**: Astro components and content types
- **Netlify**: Hosting, builds, and serverless functions
- **Decap CMS**: Headless CMS for content management

### Key Dependencies

- `@astrojs/netlify`: Deployment adapter
- `@tailwindcss/vite`: Tailwind v4 integration
- `@auth0/auth0-spa-js`: Authentication (Auth0)
- `decap-cms-app`: Content management system

## Build and Deployment

### Local Development

```bash
# Always start with a clean build to verify changes
pnpm build && pnpm dev
```

### Production Build

The build process:

1. Generates static assets to `dist/`
2. Creates Netlify serverless functions
3. Sets up redirects for client-side routing
4. Optimizes images and CSS

### Expected Build Output

```
dist/
├── _astro/              # Generated assets
├── _redirects           # Netlify redirects
├── index.html          # Homepage
└── [other pages]       # Generated routes
```

## Authentication Integration

### Auth0 Setup

- Uses Auth0 for user authentication
- Configuration in `utils/client-auth.ts` and `utils/server-auth.ts`
- Login/logout functionality in Header component
- Test button available in development mode

## Troubleshooting

### Common Issues and Solutions

**Problem**: `pnpm install` fails

- **Solution**: Ensure Node.js 18+ is installed, retry with `npm install -g pnpm`

**Problem**: Calendar page (/aktionen) shows 500 error

- **Expected**: This is normal in local development due to external ICS dependency

**Problem**: CMS admin page (/admin) is blank

- **Expected**: External CDN access limited in development environment

**Problem**: Build fails with Tailwind errors

- **Solution**: Check `src/styles/global.css` for syntax errors in @theme block

**Problem**: Development server won't start

- **Solution**: Kill any existing processes on port 4321, then restart

## Important Development Notes

### Always Remember

- **Never cancel builds**: Even though builds are fast (~6s), always let them complete
- **External dependencies fail locally**: Calendar and CMS depend on external services
- **Netlify-specific features**: Some functionality only works in Netlify environment
- **Design tokens**: Prefer CSS variables in `global.css` over Tailwind config for colors

### When Making Changes

1. Always test the build process: `pnpm build`
2. Start dev server: `pnpm dev`
3. Manually test core user scenarios (homepage, blog, navigation)
4. Verify responsive design works on different screen sizes
5. Check browser console for JavaScript errors
