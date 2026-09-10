/** Load the first decoded frame without starting the playback clock. */
export function loadVideoFirstFrame(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      video.removeEventListener("loadeddata", ready);
      video.removeEventListener("error", failed);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("Unable to load the first video frame"));
    const timeout = setTimeout(failed, 15_000);
    video.pause();
    video.autoplay = false;
    video.preload = "auto";
    video.srcObject = null;
    video.src = url;
    video.load();
    video.addEventListener("loadeddata", ready);
    video.addEventListener("error", failed);
    if (video.readyState >= 2) ready();
  });
}
