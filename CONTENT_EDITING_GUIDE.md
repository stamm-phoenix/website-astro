# Content Editing Guide

This guide explains how to edit website content through the Sveltia CMS interface.

## Accessing the CMS

1. Navigate to [https://stamm-phoenix.de/admin](https://stamm-phoenix.de/admin) (or your deployment URL + /admin)
2. Click "Login with GitHub"
3. Authorize the application with your GitHub account
4. You'll be redirected to the CMS dashboard

**Note**: You need appropriate GitHub repository permissions to edit content.

## Content Collections

The website uses Astro Content Collections for type-safe, validated content management. All content is stored in the repository and managed through the CMS.

### 1. Blog Posts

**Location**: `src/content/blog/`  
**File format**: Markdown (`.md`)  
**CMS Label**: "Blog"

#### Creating a New Blog Post

1. Go to the "Blog" section in the CMS
2. Click "New Blog"
3. Fill in the required fields:
   - **Title**: Post title (required)
   - **Date**: Publication date in YYYY-MM-DD format (required)
   - **Author**: Author name (optional, defaults to "Stamm Phoenix")
   - **Description**: Brief summary for post listing (optional)
   - **Tags**: Keywords/categories (optional)
   - **Body**: Main content in Markdown format (required)
4. Click "Save" to create a draft
5. Click "Publish" to make it live

#### Editing an Existing Post

1. Go to the "Blog" section
2. Click on the post you want to edit
3. Make your changes
4. Click "Save" and then "Publish"

**Schema**:
- `title`: string (required)
- `date`: string (required)
- `description`: string (optional)
- `tags`: array of strings (optional)
- `author`: string (optional)
- `body`: markdown content (required)

### 2. Gruppenstunden (Group Sessions)

**Location**: `src/content/gruppenstunden/`  
**File format**: JSON (`.json`)  
**CMS Label**: "Gruppenstunden"

#### Managing Group Sessions

1. Go to the "Gruppenstunden" section in the CMS
2. Click on an existing session to edit or "New Gruppenstunden" to create
3. Fill in the fields:
   - **Name**: Group name (e.g., "Wölflinge", "Pfadfinder")
   - **Alter**: Age range (e.g., "7–9 Jahre")
   - **Uhrzeit**: Meeting time (e.g., "17:30–19:00")
   - **Wochentag**: Day of week (dropdown selection)
   - **Beschreibung**: Description (optional)
   - **Reihenfolge**: Display order (1-10, determines sorting on page)
4. Save and publish

**Schema**:
- `name`: string (required)
- `age`: string (required)
- `time`: string (required)
- `day`: dropdown selection (required)
- `description`: string (optional)
- `order`: number 1-10 (optional, controls display order)

### 3. Homepage Content

**Location**: `src/content/homepage/main.json`  
**File format**: JSON  
**CMS Label**: "Startseite"

#### Editing Homepage Sections

The homepage is divided into three main sections, all editable through a single CMS entry:

##### Hero Section
The main banner at the top of the homepage.

Fields:
- **Titel**: Main headline
- **Untertitel**: Subheading text
- **Beschreibung**: Detailed description paragraph
- **Primärer Button Text**: Text for primary CTA button
- **Primärer Button Link**: URL for primary button (e.g., `/mitmachen`)
- **Sekundärer Button Text**: Text for secondary button
- **Sekundärer Button Link**: URL for secondary button (e.g., `/gruppenstunden`)

##### Quick Info Cards
Three feature cards displayed below the hero.

Each card has:
- **Titel**: Card heading
- **Beschreibung**: Card content text
- **Reihenfolge**: Display order (1, 2, 3)

To edit:
1. Expand the "Schnellinfo Karten" list
2. Click on a card to edit
3. Modify text as needed
4. Cards are displayed in order specified by the "Reihenfolge" field

##### Call-to-Action Section
Bottom section encouraging visitors to join.

Fields:
- **Titel**: Section heading
- **Beschreibung**: Section description
- **Button Text**: CTA button text
- **Button Link**: CTA button URL

**Schema**:
```typescript
{
  hero: {
    title: string,
    subtitle: string,
    description: string,
    primaryButtonText: string,
    primaryButtonLink: string,
    secondaryButtonText: string,
    secondaryButtonLink: string
  },
  quickInfo: Array<{
    title: string,
    description: string,
    order: number
  }>,
  callToAction: {
    title: string,
    description: string,
    buttonText: string,
    buttonLink: string
  }
}
```

## Content Workflow

### Draft → Review → Publish

1. **Draft**: Create or edit content without publishing
2. **Review**: Preview changes (if available in CMS)
3. **Publish**: Make changes live on the website

**Important**: Changes are committed to the repository immediately upon publishing. The Netlify build process automatically deploys changes within a few minutes.

## Media Management

### Uploading Images

1. In any content editor, click the image icon or use the media library
2. Click "Upload" or drag-and-drop files
3. Images are stored in `public/images/uploads/`
4. They're accessible at `/images/uploads/filename.jpg`

### Image Best Practices

- Use descriptive filenames (e.g., `summer-camp-2025.jpg`)
- Optimize images before upload (recommended max width: 1920px)
- Use JPG for photos, PNG for graphics with transparency
- Keep file sizes reasonable (< 500KB for web performance)

## Markdown Formatting

Blog posts use Markdown for rich text formatting. Here are common examples:

```markdown
# Heading 1
## Heading 2
### Heading 3

**Bold text**
*Italic text*

[Link text](https://example.com)

![Image alt text](/images/uploads/photo.jpg)

- Bullet point 1
- Bullet point 2

1. Numbered item 1
2. Numbered item 2

> Blockquote text
```

## Tips and Best Practices

1. **Always preview before publishing** if the CMS supports it
2. **Use consistent formatting** across similar content types
3. **Fill in optional fields** like descriptions and tags for better SEO
4. **Keep URLs lowercase** and use hyphens instead of spaces
5. **Test links** after publishing to ensure they work
6. **Order matters**: Use the "Reihenfolge/order" fields to control display sequence
7. **Commit meaningful changes**: Each publish creates a Git commit, so make complete edits before publishing

## Troubleshooting

### Changes Not Appearing

- Wait 2-3 minutes for Netlify deployment to complete
- Check the [Netlify deployment status](https://app.netlify.com/projects/stamm-phoenix-astro/deploys)
- Clear your browser cache and reload

### Cannot Login

- Ensure you have GitHub account access
- Verify repository permissions with the team admin
- Try logging out of GitHub and back in

### Validation Errors

- Check that all required fields are filled
- Ensure dates are in YYYY-MM-DD format
- Verify order/Reihenfolge numbers are between 1-10

## Getting Help

If you encounter issues:

1. Check this documentation
2. Review [Sveltia CMS documentation](https://github.com/sveltia/sveltia-cms)
3. Contact the technical team
4. Check the repository issues on GitHub

## Schema Reference

All content types are validated against TypeScript schemas defined in `src/content.config.ts`. This ensures data consistency and prevents errors.

View the source code for detailed schema definitions:
- Blog: Markdown content with frontmatter validation
- Gruppenstunden: JSON with required fields for sessions
- Homepage: Nested JSON structure for page sections
