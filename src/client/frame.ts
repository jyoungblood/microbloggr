/** Draws an early frame of a video into a JPEG. Null when the browser can't. */
export async function captureFrame(src: string): Promise<Blob | null> {
  if (!src) return null;
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  // Remote files without CORS headers taint the canvas; that path returns null.
  video.crossOrigin = "anonymous";
  const ready = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 8000);
      video.addEventListener(
        event,
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener("error", () => reject(video.error), {
        once: true,
      });
    });
  try {
    video.src = src;
    await ready("loadeddata");
    // A second in (or a tenth of short clips) skips black lead-in frames.
    video.currentTime = Math.min(1, (video.duration || 0) / 10);
    await ready("seeked");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!canvas.width || !context) return null;
    context.drawImage(video, 0, 0);
    return await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
  } catch {
    return null;
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
