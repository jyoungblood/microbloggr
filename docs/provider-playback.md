# Editor provider playback

The editor uses `src/embeds.mjs` for feed cards and detail pages. Public-theme components do not import this module. It parses URLs and constructs players on fixed HTTPS origins. It never executes provider HTML or changes the saved source URL. Network lookups live in `src/server/providers.mjs` and run only when a post is saved.

## Bandcamp decision

Bandcamp’s [official instructions](https://get.bandcamp.help/en/articles/15263071-how-do-i-create-a-bandcamp-embedded-player) direct users to Share/Embed under the album artwork to generate player code. Inspection of the public [Tycho — Dive page](https://tycho.bandcamp.com/album/dive) confirmed its `og:video` URL:

```text
https://bandcamp.com/EmbeddedPlayer/v=2/album=3619628392/size=large/tracklist=false/artwork=small/
```

The page advertises a 120-pixel-high player and a numeric album ID; `/album/dive` alone does not supply that ID. The adapter therefore accepts a Bandcamp-issued EmbeddedPlayer URL with `album=<number>`, `track=<number>`, or both. Users paste only the URL inside the generated code’s `src` attribute. The renderer rebuilds a compact 120-pixel player with artwork and no tracklist, discarding other supplied parameters. Its standard player starts paused, and the iframe explicitly denies autoplay permission.

Ordinary album/track URLs on `*.bandcamp.com` are resolved on save: the server reads the page’s `bc-page-properties` metadata for the album or track ID and stores the resulting EmbeddedPlayer URL in `media.embed`. The original page link stays in `media.src`. The lookup is redone only when the link changes. Custom artist domains are not resolved and stay links. Offline saves succeed without a player.

## Thumbnails and artwork

Video and audio saves without a poster fetch one. YouTube uses the fixed `i.ytimg.com` image for the video ID (`maxresdefault`, falling back to `hqdefault`); Vimeo uses its oEmbed `thumbnail_url` on `i.vimeocdn.com`, or the public page’s `og:image` when the owner has disabled oEmbed. SoundCloud uses its oEmbed `thumbnail_url` on `*.sndcdn.com`; Bandcamp album and track pages use their `og:image` on `*.bcbits.com`. Images are validated like photo uploads and written to `<mediaDir>/thumbnails/`. Uploaded and direct video files get a JPEG frame captured in the browser. Posters under the thumbnails folder count as generated: they are replaced when the source changes. Any other poster is the author’s and is kept.

## Other providers

- [YouTube player parameters](https://developers.google.com/youtube/player_parameters): extract an 11-character video ID from supported watch/share/shorts/live/player paths, use the privacy-enhanced player origin, and set `autoplay=0`. Player dimensions retain YouTube’s 200-pixel minimum height.
- [Vimeo player parameters](https://help.vimeo.com/hc/en-us/articles/12426260232977-About-Player-Parameters): construct a video player with `autoplay=0`. Preserve the [unlisted privacy hash](https://help.vimeo.com/hc/en-us/articles/12426470858001-Embedded-player-displays-This-video-does-not-exist-message) before adding playback parameters. Discard background mode and other supplied options.
- [SoundCloud widget parameters](https://developers.soundcloud.com/docs/api/html5-widget): pass an encoded full track/playlist URL to the widget with `auto_play=false`. Preserve secret-link paths and `secret_token` where present; discard tracking parameters. Shortened share links remain fallbacks.

All frames have titles, lazy loading, a strict-origin-when-cross-origin referrer policy, and explicit autoplay denial. Recognized players render without a separate platform link. Markdown sanitization still rejects all user-authored iframes. Unsupported providers and mismatched audio/video sources remain links.

## Verification boundary

Unit and HTTP/DOM checks validate URL parsing, markup safety, persistence, and production exclusion. They do not load remote iframe documents or prove playback. The user should verify all four providers in feed and detail views, check that playback starts only after interaction, and test keyboard access, narrow layouts, and the fallback link for unsupported sources.
