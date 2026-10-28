import { mkdir, writeFile, lstat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../tests/fixtures/site/", import.meta.url));
const reset = process.argv.includes("--reset");
if (process.argv.slice(2).some((argument) => argument !== "--reset"))
  throw new Error("Usage: npm run seed [-- --reset]");
const asset = "/assets/microblog";
const records = [
  {
    date: "2026-10-17",
    type: "text",
    title: "A slower corner of the internet",
    tags: ["notes", "small-things"],
    body: "A place to leave the things I notice. A good sentence, a song on repeat, the light on the kitchen wall.\n\nNo big announcement. Just **a little more room to pay attention**.",
  },
  {
    date: "2026-10-16",
    type: "photo",
    title: "The long way home",
    tags: ["outside", "photography"],
    photos: [
      {
        src: `${asset}/photo/hills.svg`,
      },
    ],
    body: "Took the long way. Found the last of the light.",
  },
  {
    date: "2026-10-14",
    type: "audio",
    title: "A tiny afternoon loop",
    tags: ["music", "experiments"],
    media: { kind: "file", src: `${asset}/audio/afternoon.wav` },
    body: "Three soft notes, made for this playground. A small test of the native audio player.",
  },
  {
    date: "2026-10-12",
    type: "link",
    title: "A web that feels like a garden",
    tags: ["reading", "web"],
    link: {
      url: "https://developer.mozilla.org/en-US/docs/Learn_web_development",
    },
    body: "Saving this for a weekend with no plans.",
  },
  {
    date: "2026-10-10",
    type: "text",
    title: "Something I am still working out",
    status: "draft",
    tags: ["notes"],
    body: "This is a draft. It appears in the editor, but not on the public playground.\n\nMaybe the point is to make things before deciding what they are for.",
  },
  {
    date: "2026-10-05",
    type: "video",
    title: "A little motion study",
    tags: ["motion", "inspiration"],
    media: {
      kind: "embed",
      src: "https://vimeo.com/76979871",
    },
    body: "A Vimeo provider-link example.",
  },
  {
    date: "2026-09-28",
    type: "photo",
    title: "Windowsill, 4:12 pm",
    tags: ["home", "photography"],
    photos: [
      {
        src: `${asset}/photo/window.svg`,
      },
    ],
    body: "The plant has claimed the best seat in the house.",
  },
  {
    date: "2026-09-22",
    type: "audio",
    title: "An album for getting lost in",
    tags: ["music", "bandcamp"],
    media: { kind: "embed", src: "https://tycho.bandcamp.com/album/dive" },
    body: "A Bandcamp album reference. Stored as a normal URL, ready for the future embed adapter.",
  },
  {
    date: "2026-09-14",
    type: "text",
    title: "A few things worth keeping",
    tags: ["notes", "small-things"],
    body: '## From this week\n\n- A walk without headphones.\n- The first cool morning.\n- A book with someone else’s notes in the margin.\n\n> Pay attention. There is usually something.\n\nA longer post makes a useful check for **formatting**, _emphasis_, and a [regular link](https://example.com).\n\n```js\nconst littleThings = ["light", "leaves", "a good song"];\n```',
  },
  {
    date: "2026-09-03",
    type: "photo",
    tags: ["outside"],
    photos: [
      {
        src: `${asset}/photo/sea.svg`,
      },
    ],
    body: "No title needed for this one.",
  },
  {
    date: "2026-08-25",
    type: "video",
    title: "A moving postcard",
    tags: ["motion"],
    media: {
      kind: "embed",
      src: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    },
    body: "A YouTube reference for the video preview state.",
  },
  {
    date: "2026-08-18",
    type: "link",
    title: "A place to collect references",
    tags: ["reading", "design"],
    link: { url: "https://www.are.na/" },
    body: "A link post can have a little commentary, too.",
  },
  {
    date: "2026-08-04",
    type: "photo",
    title: "A photo I have not picked yet",
    status: "draft",
    tags: ["photography"],
    body: "An unfinished photo draft intentionally has no image yet.",
  },
  {
    date: "2026-07-19",
    type: "audio",
    title: "Another listening tab",
    tags: ["music"],
    media: { kind: "embed", src: "https://soundcloud.com/tycho/awake" },
    body: "A SoundCloud reference for the audio preview state.",
  },
  {
    date: "2026-06-12",
    type: "text",
    tags: [],
    body: "Some days, one sentence is enough.",
  },
  {
    date: "2026-05-02",
    type: "link",
    title: "A bookmark for later",
    status: "draft",
    tags: ["reading"],
    body: "An unfinished link draft intentionally has no destination yet.",
  },
];

// Only these deterministic seed IDs are managed. No directory clearing or glob deletion.
async function writeSeed(relative, content) {
  const destination = path.join(root, relative);
  const pieces = path.relative(root, path.dirname(destination)).split(path.sep);
  let cursor = root;
  for (const piece of [...pieces, path.basename(destination)]) {
    cursor = path.join(cursor, piece);
    const stat = await lstat(cursor).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (stat?.isSymbolicLink())
      throw new Error(`Refusing to seed through symlink: ${cursor}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await writeFile(destination, content, { flag: reset ? "w" : "wx" });
    return 1;
  } catch (error) {
    if (error.code === "EEXIST" && !reset) return 0;
    throw error;
  }
}

const svg = (background, art) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="${background}"/>${art}</svg>\n`;
const illustrations = {
  "photo/hills.svg": svg(
    "#ead6bd",
    '<circle cx="870" cy="240" r="98" fill="#d59972"/><path d="M0 470Q270 230 610 500T1200 420V800H0Z" fill="#899477"/><path d="M0 650Q310 380 650 620T1200 540V800H0Z" fill="#4e6655"/><path d="M400 800Q460 650 635 610" fill="none" stroke="#dfceb0" stroke-width="20"/>',
  ),
  "photo/window.svg": svg(
    "#e8dfce",
    '<rect x="220" y="80" width="760" height="540" fill="#c4d1c2"/><path d="M600 80V620M220 350H980" stroke="#f6f0e6" stroke-width="28"/><path d="M820 620L1200 800H410Z" fill="#d5c8ad"/><rect x="170" y="620" width="860" height="28" fill="#a18a70"/><path d="M480 470H720L680 630H520Z" fill="#b97555"/><path d="M600 480V260" stroke="#4e6651" stroke-width="12"/><ellipse cx="540" cy="330" rx="75" ry="35" transform="rotate(35 540 330)" fill="#74886a"/><ellipse cx="665" cy="265" rx="85" ry="38" transform="rotate(-35 665 265)" fill="#4c6b54"/>',
  ),
  "photo/sea.svg": svg(
    "#e4e4d6",
    '<circle cx="930" cy="170" r="60" fill="#ce8e64"/><path d="M0 360Q400 310 1200 370V800H0Z" fill="#6e9691"/><path d="M0 530Q450 440 1200 570V800H0Z" fill="#437b78"/><path d="M0 720Q600 500 1200 710V800H0Z" fill="#dbcdb0"/><path d="M0 698Q600 480 1200 690" fill="none" stroke="#f0e8d9" stroke-width="12"/>',
  ),
};
let written = 0;
for (const [index, record] of records.entries()) {
  const { date, body, ...fields } = record;
  const status = fields.status || "published";
  const timestamp = `${date}T17:00:00.000Z`;
  const frontmatter = {
    ...fields,
    status,
    createdAt: timestamp,
    publishedAt: status === "draft" ? null : timestamp,
    updatedAt: timestamp,
  };
  // JSON values are valid YAML flow values, so no YAML serializer is needed for seeds.
  const source = `---\n${Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n")}\n---\n\n${body}\n`;
  const id = `08c0ffee-2026-4000-8000-${String(index + 1).padStart(12, "0")}`;
  written += await writeSeed(`src/content/microblog/${id}.md`, source);
}
for (const [name, content] of Object.entries(illustrations))
  written += await writeSeed(`public${asset}/${name}`, content);

const rate = 22050,
  seconds = 3,
  samples = rate * seconds;
const wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF");
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate,
    envelope = Math.min(t * 3, 1) * Math.max(0, 1 - t / seconds);
  const value =
    [220, 277.18, 329.63].reduce(
      (sum, hz) => sum + Math.sin(2 * Math.PI * hz * t),
      0,
    ) / 3;
  wav.writeInt16LE(Math.round(value * envelope * 5000), 44 + i * 2);
}
written += await writeSeed(`public${asset}/audio/afternoon.wav`, wav);
console.log(
  `${reset ? "Reset" : "Created"} ${written} seed files. ${records.length} sample posts; existing files ${reset ? "with seed IDs replaced" : "left untouched"}.`,
);
