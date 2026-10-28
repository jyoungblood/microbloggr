import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  providerEmbed,
  renderProvider,
} from "../src/embeds.mjs";
import { markdown } from "../src/render.mjs";

test("YouTube share, watch, shorts, live and player URLs produce a paused player", () => {
  for (const source of [
    "https://www.youtube.com/watch?v=aqz-KE-bpKQ&autoplay=1",
    "http://m.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtu.be/aqz-KE-bpKQ?si=tracking",
    "https://youtube.com/shorts/aqz-KE-bpKQ",
    "https://youtube.com/live/aqz-KE-bpKQ",
    "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1",
  ]) {
    const embed = providerEmbed(source, "video");
    assert.equal(
      embed.src,
      "https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=0&playsinline=1",
    );
    assert.equal(embed.href, "https://www.youtube.com/watch?v=aqz-KE-bpKQ");
  }
});

test("Vimeo preserves unlisted hashes and discards background/autoplay options", () => {
  for (const source of [
    "https://vimeo.com/76979871/5e2d1c1e6d",
    "https://player.vimeo.com/video/76979871?h=5e2d1c1e6d&background=1&autoplay=1",
  ]) {
    const embed = providerEmbed(source, "video");
    assert.equal(
      embed.src,
      "https://player.vimeo.com/video/76979871?h=5e2d1c1e6d&autoplay=0",
    );
    assert.equal(embed.href, "https://vimeo.com/76979871/5e2d1c1e6d");
  }
  for (const path of [
    "76979871",
    "channels/staffpicks/76979871",
    "groups/animation/videos/76979871",
  ])
    assert.equal(
      providerEmbed(`https://vimeo.com/${path}`, "video").src,
      "https://player.vimeo.com/video/76979871?autoplay=0",
    );
});

test("SoundCloud encodes track/playlist URLs, preserves secret tokens, disables autoplay", () => {
  for (const [source, expected, height] of [
    [
      "https://soundcloud.com/tycho/awake?auto_play=true&utm_source=share",
      "https://soundcloud.com/tycho/awake",
      166,
    ],
    [
      "https://soundcloud.com/artist/sets/album",
      "https://soundcloud.com/artist/sets/album",
      450,
    ],
    [
      "https://soundcloud.com/artist/song/s-secret",
      "https://soundcloud.com/artist/song/s-secret",
      166,
    ],
    [
      "https://api.soundcloud.com/tracks/123?secret_token=s-secret",
      "https://api.soundcloud.com/tracks/123?secret_token=s-secret",
      166,
    ],
  ]) {
    const embed = providerEmbed(source, "audio");
    const player = new URL(embed.src);
    assert.equal(player.origin, "https://w.soundcloud.com");
    assert.equal(player.searchParams.get("url"), expected);
    assert.equal(player.searchParams.get("auto_play"), "false");
    assert.equal(embed.height, height);
  }
});

test("Bandcamp uses numeric album/track IDs and ignores supplied player options", () => {
  for (const ids of ["album=123", "track=456", "album=123/track=456"]) {
    const embed = providerEmbed(
      `https://bandcamp.com/EmbeddedPlayer/${ids}/size=large/autoplay=true/?autoplay=1`,
      "audio",
    );
    assert.equal(
      embed.src,
      `https://bandcamp.com/EmbeddedPlayer/${ids}/size=large/bgcol=202025/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/`,
    );
    assert.equal(embed.height, 120);
  }
  const fallback = renderProvider(
    "https://tycho.bandcamp.com/album/dive",
    "audio",
  );
  assert.ok(!fallback.includes("<iframe"));
  assert.match(fallback, /href="https:\/\/tycho.bandcamp.com\/album\/dive"/);
});

test("unsupported, spoofed, malformed and mismatched sources cannot create frames", () => {
  for (const source of [
    "https://youtube.com.evil.test/watch?v=aqz-KE-bpKQ",
    "https://evil.youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com@evil.test/watch?v=aqz-KE-bpKQ",
    "https://evil.test@youtube.com/watch?v=aqz-KE-bpKQ",
    "https://youtube.com:8443/watch?v=aqz-KE-bpKQ",
    "https://youtube.com/watch?v=invalid",
    "https://youtube.com/playlist?list=anything",
    "https://vimeo.com/123/extra/path",
    "https://player.vimeo.com/video/123?h=%22onload%3Dalert(1)",
    "https://soundcloud.com/tycho",
    "https://on.soundcloud.com/short-link",
    "https://bandcamp.com/EmbeddedPlayer/album=abc/",
    "https://bandcamp.com/EmbeddedPlayer/album=1/album=2/",
    "https://bandcamp.com/EmbeddedPlayer/track=0/",
    "https://artist.bandcamp.com/EmbeddedPlayer/album=123/",
    "https://bandcamp.com/EmbeddedPlayer/album=1%22onload=alert(1)/",
    "https://example.com/video",
    "javascript:alert(1)",
    "data:text/html,<iframe></iframe>",
    "//youtube.com/watch?v=aqz-KE-bpKQ",
    '<iframe src="https://youtube.com/embed/aqz-KE-bpKQ"></iframe>',
    "https://youtube.com\\@evil.test/watch?v=aqz-KE-bpKQ",
  ])
    for (const type of ["audio", "video"]) {
      assert.equal(providerEmbed(source, type), null, source);
      assert.ok(!renderProvider(source, type).includes("<iframe"), source);
    }
  assert.equal(providerEmbed("https://youtu.be/aqz-KE-bpKQ", "audio"), null);
  assert.equal(
    providerEmbed("https://soundcloud.com/tycho/awake", "video"),
    null,
  );
});

test("rendered frames have accessible titles, lazy loading, autoplay denial and no platform links", () => {
  for (const [source, type] of [
    ["https://youtu.be/aqz-KE-bpKQ", "video"],
    ["https://vimeo.com/76979871", "video"],
    ["https://soundcloud.com/tycho/awake", "audio"],
    ["https://bandcamp.com/EmbeddedPlayer/album=123/", "audio"],
  ]) {
    const dom = new JSDOM(renderProvider(source, type));
    try {
      const frame = dom.window.document.querySelector("iframe");
      assert.ok(frame.title);
      assert.equal(frame.getAttribute("loading"), "lazy");
      assert.equal(
        frame.getAttribute("referrerpolicy"),
        "strict-origin-when-cross-origin",
      );
      assert.match(frame.getAttribute("allow"), /autoplay 'none'/);
      assert.ok(!frame.hasAttribute("srcdoc"));
      assert.equal(dom.window.document.querySelector("a"), null);
    } finally {
      dom.window.close();
    }
  }
  const output = renderProvider(
    'https://example.com/?q=" onclick="bad',
    "audio",
  );
  assert.ok(!output.includes(' onclick="'));
  assert.ok(
    !markdown(
      '<iframe src="https://www.youtube.com/embed/aqz-KE-bpKQ"></iframe>',
    ).includes("<iframe"),
  );
});
