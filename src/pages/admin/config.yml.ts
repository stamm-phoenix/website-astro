import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const baseUrl = import.meta.env.SVELTIA_CMS_BASE_URL || 'https://sveltia-cms-auth.netlify.app';
  const authUrl = import.meta.env.SVELTIA_CMS_AUTH_URL || 'https://sveltia-cms-auth.netlify.app/auth';

  const config = `backend:
  name: github
  repo: stamm-phoenix/website-astro
  branch: main
  base_url: ${baseUrl}
  auth_url: ${authUrl}

media_folder: 'public/images/uploads'
public_folder: '/images/uploads'

collections:
  - name: 'blog'
    label: 'Blog'
    folder: 'src/content/blog'
    create: true
    slug: '{{year}}-{{month}}-{{day}}-{{slug}}'
    fields:
      - {label: 'Title', name: 'title', widget: 'string'}
      - {label: 'Date', name: 'date', widget: 'string'}
      - {label: 'Description', name: 'description', widget: 'text', required: false}
      - {label: 'Tags', name: 'tags', widget: 'list', required: false}
      - {label: 'Author', name: 'author', widget: 'string', default: 'Stamm Phoenix'}
      - {label: 'Body', name: 'body', widget: 'markdown'}
  
  - name: 'gruppenstunden'
    label: 'Gruppenstunden'
    folder: 'src/content/gruppenstunden'
    extension: 'json'
    format: 'json'
    create: true
    slug: '{{name}}'
    fields:
      - {label: 'Name', name: 'name', widget: 'string'}
      - {label: 'Alter', name: 'age', widget: 'string'}
      - {label: 'Uhrzeit', name: 'time', widget: 'string'}
      - {label: 'Wochentag', name: 'day', widget: 'select', options: ['Montags', 'Dienstags', 'Mittwochs', 'Donnerstags', 'Freitags', 'Samstags', 'Sonntags']}
      - {label: 'Beschreibung', name: 'description', widget: 'text', required: false}
      - {label: 'Reihenfolge', name: 'order', widget: 'number', min: 1, max: 10, default: 1}

  - name: 'homepage'
    label: 'Startseite'
    files:
      - label: 'Startseite Inhalte'
        name: 'main'
        file: 'src/content/homepage/main.json'
        fields:
          - label: 'Hero Bereich'
            name: 'hero'
            widget: 'object'
            fields:
              - {label: 'Titel', name: 'title', widget: 'string'}
              - {label: 'Untertitel', name: 'subtitle', widget: 'string'}
              - {label: 'Beschreibung', name: 'description', widget: 'text'}
              - {label: 'Primärer Button Text', name: 'primaryButtonText', widget: 'string'}
              - {label: 'Primärer Button Link', name: 'primaryButtonLink', widget: 'string'}
              - {label: 'Sekundärer Button Text', name: 'secondaryButtonText', widget: 'string'}
              - {label: 'Sekundärer Button Link', name: 'secondaryButtonLink', widget: 'string'}
          - label: 'Schnellinfo Karten'
            name: 'quickInfo'
            widget: 'list'
            fields:
              - {label: 'Titel', name: 'title', widget: 'string'}
              - {label: 'Beschreibung', name: 'description', widget: 'text'}
              - {label: 'Reihenfolge', name: 'order', widget: 'number', min: 1, max: 10}
          - label: 'Call-to-Action'
            name: 'callToAction'
            widget: 'object'
            fields:
              - {label: 'Titel', name: 'title', widget: 'string'}
              - {label: 'Beschreibung', name: 'description', widget: 'text'}
              - {label: 'Button Text', name: 'buttonText', widget: 'string'}
              - {label: 'Button Link', name: 'buttonLink', widget: 'string'}
`;

  return new Response(config, {
    headers: {
      'Content-Type': 'text/yaml',
    },
  });
};