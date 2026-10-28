# Implementation progress

The integration skeleton, seeded playground, and editing workflows for all five post types are implemented. The full product spec describes the intended version one.

## Implemented

- Dev-only integration, toolbar navigation, custom editor path, and Astro base paths.
- Local request guards and per-session tokens for writes and uploads.
- Create, edit, draft, publish, backdate, and delete to a local trash with a Trash page to restore, delete forever, or empty it (media no other post uses is deleted with it).
- Atomic file replacement, per-post serialization, stale revision checks, unchanged-body preservation, and custom-frontmatter preservation.
- Independent editor file reads with per-file errors; malformed records are left unchanged. Host-wide Astro startup errors can still prevent the dev server from running.
- Tiptap rich text saved as Markdown, keyboard undo/redo, and an automatic CodeMirror source fallback for unsupported syntax. No mode toggle or undo/redo buttons.
- Two-step media picker (upload or add from web, also a dropzone) for photo, video, and audio. Photo thumbnail grid with drag and keyboard reordering and confirmed removal. Linked files download on save; provider links stay embeds. Photo IDs and custom metadata survive edits.
- Manual link metadata; audio/video file, direct URL, and provider URL fields.
- Shared YouTube, Vimeo, SoundCloud, and Bandcamp player rendering in feed and detail views, with autoplay disabled and no platform links beside working players. Bandcamp album/track page links resolve to players on save. Video and audio saves store a thumbnail or artwork (provider download or browser-captured frame). No iframe HTML storage.
- Live provider players remain mounted through caption, title, and tag edits.
- Local uploads with signature/size validation and unique names. Picked files are staged in browser memory and upload only on save. Files a post stops using are deleted on save unless another post or trashed post refers to them. Deleting posts leaves media intact.
- Tags with keyboard entry/removal, case-insensitive deduplication, and existing-tag suggestions.
- Dirty-form navigation warnings and save errors that retain form content. Unsaved edits are not cached for recovery.
- Feed pagination, square archive with month groups/search/filters, and standalone details.
- Archive returns preserve the exact filters/page and restore tab-local scroll position and card focus. Close and delete return to the originating archive; saves retain that context.
- External edits, additions, deletions, and unreadable files produce reload notices. Checks run every five seconds in visible tabs and on focus. Own saves are acknowledged, unsaved fields and revisions stay intact, and editor pages defer Astro's wildcard content reloads.
- Configurable content/media directories and upload limits.
- Independent published-only public theme, editable Zod template, sixteen seeds, and safe seed reset.

## Visual direction

The editor follows the supplied old Tumblr dark dashboard: charcoal surfaces, a narrow feed, monochrome post-type icons, system typography, and plain tag links. The public playground follows `astro-arena-demo`: oversized uppercase type, an edge-to-edge irregular grid, image overlays, and simple black-and-white detail pages.

## Scope decisions

The requested archive restoration and external-edit notifications are implemented. Timezone configuration has been removed from scope; forms use the browser timezone and archive/feed dates use UTC. The [publishing roadmap](publishing-roadmap.md) tracks remaining UI work, user-led manual checks, guided installation, the public demo, and release preparation.

S3 storage, inline uploads, scheduled publication, automatic link metadata, and a media library remain later work.

## Known issues

- **Esc needs two presses to close a new post form in Chrome** (seen 2026-10-26). With no field focused, the first Esc does nothing and the second closes the form. It does not reproduce in the Claude desktop app's built-in browser, where one press closes it. Ruled out so far: ProseMirror's Escape binding (Esc from the body editor is handled), focus left on non-text controls such as the file picker, and feed embeds taking focus as they load (a guard that returned focus to the page did not help). The handler is the Escape `keydown` listener in `src/client/composer.ts`. Next step: log `keydown` events and `document.activeElement` in Chrome while reproducing.

## Validation

- Unit tests cover publication transitions, body/custom-field preservation, conflicts, trash, traversal/symlinks, file signatures/limits, and Markdown sanitization.
- Provider tests cover URL variants, Vimeo privacy hashes, SoundCloud secret links, Bandcamp numeric identifiers, spoofed hosts, malformed inputs, autoplay denial, and safe fallbacks. Raw Markdown iframes remain stripped.
- HTTP tests create, edit, publish, and delete all five types in a temporary playground copy. They exercise tokens, uploads, custom paths, and Astro base paths.
- Archive/notification checks cover filter-specific scroll and focus restoration, validated return URLs, direct filesystem changes, changed/deleted/unreadable posts, polling lifecycle, own-save races, and unsaved-form preservation.
- DOM tests exercise rich text, the unsupported-syntax fallback, undo/redo, tag entry, saves, and stale-error recovery without launching a browser or loading third-party frames.
- Static builds before and after editing sessions exclude editor code and draft content; production preview returns 404 for management routes.
- Test servers stop automatically. Visual checks remain with the user.
