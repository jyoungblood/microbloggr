# Microbloggr product spec

Status: Version one target. The integration, playground, persistence, Markdown editor, and local uploads are implemented. See [implementation progress](progress.md) for current scope.

Microbloggr is a local Astro integration for a Tumblr-inspired microblog editor and archive. It manages the `microblog` collection through Markdown files.

The integration provides five post types, draft and published states, local uploads, a recent feed, and an archive. The host theme owns the public website.

## Development boundary

The entire management tool runs only during `astro dev`, normally through `npm run dev`.

- Register the toolbar app, editor routes and file endpoints only when Astro reports `command === 'dev'`.
- Do not register them during `build`, `preview`, or `sync`.
- Keep editor JavaScript, CSS, route modules, and server handlers out of production output. A hidden interface or a runtime authorization check is insufficient.
- Keep editor assets inside the integration package. Do not place them in the host project's `public` directory.
- Restrict editor requests to loopback access. A host site started with `--host` must not expose the editor to the LAN.
- Check the request host and origin. Require a per-session token for mutations, and reject requests through forwarded proxies.
- Do not add production routes, public edit links, authentication services, or a hosted CMS backend.

Post content and uploaded media remain ordinary site inputs. Those files can appear in production through the host theme and normal Astro behavior.

Astro supplies command detection, route injection, toolbar registration, and development server hooks. [Integration API](https://docs.astro.build/en/reference/integrations-reference/)

## Screens and routes

`editorPath` defaults to `/editor`. All management routes share this prefix and honor the Astro base path.

| Route                    | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `/editor`                | Post type selector, new-post form, recent feed, archive link |
| `/editor/archive`        | Searchable grid grouped by month and year                    |
| `/editor/posts/:id`      | Standalone rendered detail page                              |
| `/editor/posts/:id/edit` | Existing-post form and delete action                         |

The toolbar icon opens the main screen. Direct navigation and refresh work on every route. Conflicting host routes produce a clear error.

### Main screen

- Start with text, photo, link, audio, and video buttons.
- A selected type opens its form above the recent feed.
- Every form has tags, publication controls, and dates.
- The feed shows 10 saved posts per page, including drafts with clear labels.
- Each post has separate View and Edit links.
- Save failures retain the current form. Successful saves refresh the feed without a full-page reload.

### Editors

| Type  | Fields and behavior                                                                            |
| ----- | ---------------------------------------------------------------------------------------------- |
| Text  | Optional title and Markdown body                                                               |
| Photo | Multiple image uploads or downloaded links, order, optional title, Markdown caption            |
| Link  | Destination URL, optional title, Markdown commentary                                           |
| Audio | Local upload, downloaded file link, or provider URL, optional title, Markdown caption          |
| Video | Local upload, downloaded file link, or provider URL, generated poster, title, Markdown caption |

Photo, video, and audio forms open on a two-way picker, after the old Tumblr uploader: upload a file or add one from the web. The picker is also a dropzone. The photo editor supports up to 100 images in a thumbnail grid, reordered by dragging (or Alt and arrow keys) and removed with a circled x after a confirmation. The first photo supplies the cover. Video and audio show their player with the same remove control.

Tags support repeated entry, keyboard removal, and suggestions from existing posts. Trim whitespace and deduplicate case-insensitively while retaining the first spelling.

Post type remains fixed after the first save in version one. This prevents accidental loss of fields during conversion.

### Markdown editing

Use the editor in `astro-data-grid` as the interaction reference. Its rich editor uses Tiptap, and its source editor uses CodeMirror.

The editor provides basic rich text saved as Markdown, with keyboard undo/redo. Bodies with syntax rich text cannot represent open in a Markdown source editor instead. Formatting includes bold, italic, strikethrough, three heading levels, lists, quotes, inline code, links, and horizontal rules.

Unsupported Markdown remains editable in source mode. Switching modes must not silently discard unsupported content. Metadata-only edits preserve the body verbatim.

Version one excludes MDX, arbitrary component execution, and inline media uploads. Source mode can retain ordinary Markdown image syntax.

Reference files:

- `../astro-data-grid/src/renderer/editors/ContentEditorDialog.tsx`
- `../astro-data-grid/src/renderer/editors/RichTextEditor.tsx`
- `../astro-data-grid/src/renderer/editors/SourceEditor.tsx`

These paths are relative to the Microbloggr repository root. Reuse browser editing patterns without the Electron bridge or application-specific history events.

### Detail pages

Feed cards and detail pages share a post renderer. The detail page shows the full body, media, tags, status, and dates.

The renderer provides a neutral representation of the content. It does not promise an exact preview of a custom theme.

- Local files and direct media URLs use native image, audio, and video elements.
- Recognized provider URLs use explicit embed adapters. The initial providers are YouTube and Vimeo for video, and SoundCloud and Bandcamp for audio.
- Unknown providers show a linked card. Unsupported or failed embeds never prevent editing or saving.
- Store provider URLs rather than arbitrary iframe HTML. Disable autoplay.
- Bandcamp playback uses the numeric album/track identifiers in an EmbeddedPlayer URL. Ordinary Bandcamp page URLs resolve to that player on save; the original link is kept.
- Saving a video or audio post stores an image when it has no poster: provider thumbnails or artwork for YouTube, Vimeo, SoundCloud, and Bandcamp, and a captured frame for video files.
- Sanitize rendered Markdown and link protocols. Do not execute scripts from post content.
- Version one uses manual link metadata. Automatic metadata discovery is deferred.

Provider support belongs only to the development preview. Public themes implement their own embeds.

### Archive

- Show a large responsive grid of square cards, newest first, grouped by month and year.
- Images use thumbnails. Video uses its poster where available. Other posts use a readable excerpt, title, or type icon.
- Each card opens the edit page and has an accessible label and visible draft state.
- Search title, Markdown body text, tags, and link URL without case sensitivity.
- Support type, tag, and draft/published filters. Combine active filters with AND.
- Keep search and filters in the URL. Returning from edit restores the archive position where possible.
- Use lazy media loading and incremental results. All posts remain reachable without mounting the entire archive at once.

Order by `publishedAt ?? createdAt` descending, then stable ID for ties. Use this date for month groups, including previously published drafts.

## Content format

The collection name is `microblog`. The default directory is `src/content/microblog`, configurable relative to the host project root.

Each post uses one UTF-8 `.md` file with YAML frontmatter. A generated UUID serves as the filename and collection entry ID.

Titles and dates do not change filenames. Public permalink design belongs to the theme. Version one does not require a title or slug.

| Field         | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `type`        | `text`, `photo`, `link`, `audio`, or `video`                 |
| `status`      | `draft` or `published`                                       |
| `title`       | Optional text                                                |
| `tags`        | Array of strings, default `[]`                               |
| `createdAt`   | Required timestamp, set on the first save                    |
| `publishedAt` | Timestamp or `null`, initially `null`                        |
| `updatedAt`   | Required timestamp, updated on each material save            |
| `photos`      | Ordered photo entries with `id` and `src`                    |
| `link`        | Object with `url`; the post body describes the link          |
| `media`       | Audio/video object with `kind`, `src`, and optional `poster` |

`media.kind` is `file` for uploaded files and direct media URLs, or `embed` for provider URLs. Type-specific fields appear only on the matching type.

`src`, `poster`, and preview image values use site-relative asset URLs or absolute HTTP(S) URLs. The renderer resolves site-relative assets against the Astro base path.

The [photo post format](photo-format.md) defines stable photo IDs, validation, metadata preservation, and importer examples. IDs remain optional for old files. Editor saves assign missing IDs. Array order controls display order.

The Markdown body contains the text, caption, or commentary. A photo post example:

```md
---
type: photo
status: published
title: Evening walk
tags:
  - photography
createdAt: "2026-10-17T20:00:00.000Z"
publishedAt: "2026-10-17T20:05:00.000Z"
updatedAt: "2026-10-17T20:05:00.000Z"
photos:
  - id: 9ef85e97-photo
    src: /assets/microblog/photo/9ef85e97.jpg
---

A small moment from tonight's walk.
```

### Collection schema

Provide a documented Astro collection definition and an editable Zod schema template. Users own the copied schema and can add optional fields or defaults.

The definition uses Astro's `glob()` loader for `.md` files. The schema distinguishes post types and publication states, and converts timestamps to dates for theme use.

Drafts can omit unfinished content, including the photo, link, or media payload. Published posts require the corresponding payload and `publishedAt`.

Published text posts require a nonempty body. This check belongs in the save workflow because the body is separate from frontmatter.

The editor checks its core contract before every save. The Astro collection checks the user's schema during content loading and build.

Extra frontmatter survives editor saves. Version one does not generate forms for custom schema fields or evaluate arbitrary schema transforms during saves.

New required custom fields need defaults or manual file edits. Renaming core fields breaks editor compatibility. These limits must appear beside the schema example.

The collection schema must not import the editor, server, or integration entrypoint. Content must remain usable after the integration is removed.

Astro supports file loaders, Zod schemas, and collection query filters. [Content collections](https://docs.astro.build/en/guides/content-collections/)

## Publication and dates

New posts offer Save draft and Publish. Existing drafts offer Save draft and Publish. Published posts offer Save changes only. Saving an existing post returns to the feed, archive, or post page the edit started from.

- `createdAt` remains unchanged after the first save and appears read-only.
- `updatedAt` equals `createdAt` initially and changes only after a material save.
- First publication sets `publishedAt` to now unless the user supplies an earlier date.
- The publication date is editable for backdating. Future publication dates are outside version one.
- Moving a post to draft retains `publishedAt`. Republishing retains that date unless the user changes it.
- Store timestamps as quoted UTC ISO 8601 strings. Forms use the browser timezone; feed dates and archive groups use UTC. Configurable timezone handling is outside the current scope.

Publish changes the local record. It does not commit, push, deploy, or upload the site.

Public themes must filter for `status === 'published'` in feeds, detail routes, RSS, search indexes, and sitemaps. The starter example must demonstrate this.

Draft status is not access control. Public-directory uploads, including draft attachments, still enter static output. Draft content exclusion depends on the host theme.

## Media storage

The proposed local default is `<publicDir>/assets/microblog/<type>`, normally `public/assets/microblog/photo`, `audio`, or `video`.

A root-level `assets` directory has no automatic public URL. The `public` directory provides predictable URLs for all three media types.

Files in `public` copy into the build unchanged. Automatic Astro image optimization is outside this initial storage model. [Astro images](https://docs.astro.build/en/guides/images/)

- Provide a configurable subdirectory within the Astro public directory.
- Generate collision-resistant filenames and retain the file extension. Never overwrite an existing upload.
- Check file signatures, allowed formats, and size limits. Proposed defaults: 20 MiB for photos and 100 MiB for audio/video.
- Start with JPEG, PNG, WebP, GIF, and AVIF images, MP3/M4A/WAV/Ogg audio, and MP4/WebM video. Playback still depends on browser codecs.
- Alternative text is deferred; see the [publishing roadmap](publishing-roadmap.md).
- Deleting a post moves it to the trash and keeps its media. Removing or replacing media in a post deletes the old file on save when no other post, draft, or trashed post refers to it. Deleting a trashed post forever deletes its media under the same rule.
- Pasted links to images and media files are downloaded on save, refusing local and private network addresses.
- Picked files stay in browser memory until the post is saved, so canceled forms leave no uploads. A failed upload stops the save and keeps the file staged. A media library is deferred.

### Future S3-compatible storage

The content format already permits remote URLs. The initial local upload code must return a media reference without coupling forms to filesystem paths.

A later storage backend can supply the same result. No S3 client, credentials screen, or generic plugin framework is required in version one.

The future design needs an endpoint, bucket, region, object prefix, credentials, and a stable delivery URL. Secrets stay in server-side environment variables.

Do not save expiring signed URLs in Markdown. Private objects need a deliberate delivery design. Remote deletion stays off by default to protect deployed references.

## Reliability without a large subsystem

- Write a temporary file beside the destination, then rename it after a successful write.
- Check a revision hash before save or delete. Reject stale requests instead of overwriting external edits or another tab's changes.
- Serialize mutations per post within the dev server.
- Keep all writes within configured content and upload directories, including checks for symlinks and path traversal.
- Warn before leaving a dirty form. Do not autosave unpublished typing to disk.
- Ask before deletion. Move deleted Markdown into project-local `.microbloggr/trash`, outside the collection and public directory.
- A Trash page lists deleted posts with per-post and bulk (checkbox and Select all) Restore and Delete forever. Permanent deletion asks first. `.microbloggr/` writes its own `.gitignore` so the trash stays out of Git. Full revision history is deferred.
- Keep malformed files unchanged. Show a useful file error without making the entire archive unusable where the host dev server permits it.
- Refresh lists and Astro content after saves. Detect external edits without replacing a dirty form.
- Preserve unknown frontmatter values. YAML formatting can normalize on save, but metadata-only edits must not rewrite the Markdown body.

## Configuration and installation

Version one uses integration configuration in `astro.config.*`. A separate settings screen is deferred.

Configuration covers the editor prefix, content directory, media subdirectory, and upload size limits.

Install the integration as a development dependency. Provide collection setup instructions and a minimal theme example without overwriting existing project configuration.

The initial implementation targets one current stable Astro major and its supported Node versions. Record exact versions before dependency installation.

The package must not require a production adapter or a React integration in the host project. Its editor dependencies stay isolated from the host theme.

## Implementation sequence

1. Establish the dev-only integration, toolbar link, routes, collection template, and production exclusion checks.
2. Add file persistence, text posts, draft/publication behavior, Markdown editing, feed, and detail view.
3. Add photo uploads and the archive with search and filters.
4. Add link, audio, and video forms, native players, and the initial embed adapters.
5. Add archive scroll restoration and external-edit notifications. The [publishing roadmap](publishing-roadmap.md) tracks subsequent release preparation and user-led manual checks.

All five post types belong to version one. The sequence delivers small usable steps without redefining the final scope.

## Acceptance criteria

- All management routes and the toolbar work during local `astro dev`, including a custom editor prefix and Astro base path.
- Static build output contains no editor pages, scripts, styles, handlers, toolbar assets, or integration-added public links.
- `astro preview` exposes no management endpoints. A LAN client cannot use editor endpoints during a host site's network-enabled dev session.
- Create, edit, draft, publish, backdate, view, and delete work for each post type.
- A restart retains saved content. External edits appear without data loss. Stale saves fail with a recoverable message.
- Feed pagination, archive ordering, month groups, search, and combined filters produce consistent results.
- Unsupported Markdown survives source editing. Malicious HTML does not execute in rendered posts.
- Uploads survive post deletion. Invalid uploads fail without overwriting files.
- A sample static theme renders published content and excludes draft posts from every public content surface.
- Production exclusion checks cover clean builds and builds after a dev session with all screens used.
- Automated checks cover persistence, state transitions, path boundaries, request restrictions, and production exclusion.
- Visual behavior is reviewed by the user. Browser preview/debugging requires an explicit request.

## Defaults to settle before their implementation step

No unanswered question blocks the first integration step. These proposed defaults remain easy to revise:

1. **Media location:** public-directory uploads favor simple URLs. Source assets require a separate image pipeline. Public draft attachments are not private.
2. **Markdown interaction:** basic rich text plus source mode follows the reference project. Source-only editing is a smaller alternative.
3. **Embed providers:** start with YouTube, Vimeo, SoundCloud, and Bandcamp, with linked cards for others.
4. **Schema customization:** preserve extra fields, but keep custom-field editing and arbitrary schema-driven forms outside version one.
5. **Date behavior:** retain the original publication date across draft transitions and reject future dates until scheduling has an explicit design.
