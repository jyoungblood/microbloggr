# Photo post format

This document defines the photo contract for importers and the editor.
The executable schema is `templates/microblog.schema.ts`.
The test site uses a copy at `tests/fixtures/site/src/microblog.schema.ts`.
Existing host projects need the updated photo schema in their own copy.

## Example

Write each post as a UTF-8 Markdown file under `src/content/microblog` (or the configured content directory).
Use a stable filename, such as `tumblr-123456.md`.
The filename without `.md` is the post ID.
Post IDs accept 1–128 ASCII letters, digits, underscores, or hyphens, with a letter or digit first.

```md
---
type: photo
status: published
title: Evening walk
tags: [photography]
createdAt: "2014-05-12T20:00:00.000Z"
publishedAt: "2014-05-12T20:00:00.000Z"
updatedAt: "2014-05-12T20:00:00.000Z"
photos:
  - id: tumblr-123456-photo-a
    src: /assets/microblog/photo/leaves.jpg
  - id: tumblr-123456-photo-b
    src: /assets/microblog/photo/sky.jpg
imported:
  platform: tumblr
  postId: "123456"
  url: https://example.tumblr.com/post/123456
---

The original post caption goes here, as Markdown.
```

## Photo fields

| Field | Contract                                                                                                                     |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| `id`  | Stable string, unique within this post. Same character rules as the post ID. Optional only for compatibility with old files. |
| `src` | Required site-relative path (`/assets/...`) or absolute HTTP(S) URL. Maximum 10,000 characters.                              |

`photos` is an ordered array with at most 100 entries. Array order is display order.
The first photo supplies the archive thumbnail. There is no separate position or cover field.
Drafts can omit `photos` or use an empty array. Published photo posts need at least one photo.

For new imports, supply an ID for every photo.
Use a source media ID or a UUID that you retain across repeated imports.
If the source has no media ID, assign an ID once and retain that mapping.
Keep the ID when you reorder a photo or change its URL.
Use a new ID for a different photo.
IDs identify photo entries within a post, not shared files in a media library.

For downloaded files, store the bytes under `public/assets/microblog/photo/` and omit `public` from `src`.
Keep any Astro base prefix out of site-relative URLs. The renderer adds that prefix.
Remote URLs are also valid. Two photos can share a URL if their IDs differ.

## Metadata and saves

Both the Astro schema and editor saves retain custom fields on photo entries.
Importers can use a custom `imported` object for source metadata at the post or photo level.
The example's `imported` fields are a convention, not validated core fields.
Dimensions, per-photo captions, and source layout data can also be custom fields. The editor does not interpret or display them.
The shared post caption remains the Markdown body.
Alternative text is not part of the format for now. Saves drop `alt` and `decorative` from older photo entries; adding alt text back is on the [publishing roadmap](publishing-roadmap.md).

On save, the server merges existing photo fields by ID. It never matches photos by array position.
An explicit new ID creates a new entry, even if its URL matches an old photo.
Omitted custom fields survive a matching edit. Supplied fields replace their previous values, without a recursive merge.
The submitted photo array replaces the previous list. Omitted entries are removed from the post. Their files are deleted from the media folder when no other post, draft, or trashed post still refers to them.

Old files without photo IDs remain readable. Reads do not rewrite files or assign IDs.
Editor saves assign UUIDs to photos without IDs.
For an ID-less edit, the server retains existing metadata only if the URL has one match.
If several existing photos share that URL, an ID-less API save fails. Supply unique IDs or use the editor, which assigns IDs to legacy entries.
An ID-less photo with a new URL cannot inherit omitted metadata. The editor carries each full saved photo object during edits.

Importers that need original timestamps or custom post metadata must write complete Markdown files.
The editor create endpoint sets `createdAt` itself and accepts only its editable post fields.
For repeat imports, preserve existing local edits or resolve conflicts before replacing files.

The form shows the photos as a thumbnail grid. Drag a thumbnail, or focus it and press Alt with an arrow key, to reorder. The circled x on a thumbnail (or Delete on a focused one) removes it after a confirmation.
Photos are added by choosing or dropping files, or by pasting a link; linked images are downloaded into the media folder on save.
Saves retain photo IDs, custom metadata, and order.
