import type { AstroIntegration } from "astro";
export interface MicrobloggrOptions {
  /** Management URL, relative to the Astro base path. Default: /editor. */
  editorPath?: string;
  /** Relative to the project root. Match this in the collection glob loader. */
  contentDir?: string;
  /** Relative to Astro publicDir. Default: assets/microblog. */
  mediaDir?: string;
  /** Maximum upload sizes in bytes. Defaults: photo 20 MiB, audio/video 100 MiB. */
  uploadLimits?: Partial<Record<"photo" | "audio" | "video", number>>;
  /**
   * On save, download YouTube/Vimeo thumbnails and resolve Bandcamp album or
   * track links to players. Needs network access. Default: true.
   */
  providerLookups?: boolean;
}
export default function microbloggr(
  options?: MicrobloggrOptions,
): AstroIntegration;
