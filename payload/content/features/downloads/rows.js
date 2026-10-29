/* Render native or debug downloads with the same rows and actions. No download state is stored here. */
var ArcDownloadRows = {
  install(window, dependencies) {
    const { PathUtils, el, icon, downloadButton, runDownloadAction } =
      dependencies;
    const relativeTime = new Intl.RelativeTimeFormat(undefined, {
      numeric: "auto",
    });
    function downloadAge(download) {
      const time = new Date(download.endTime || download.startTime).getTime();
      if (!Number.isFinite(time)) return "Completed";
      const seconds = Math.max(0, (Date.now() - time) / 1000);
      if (seconds < 60) return "Just now";
      for (const [unit, length] of [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
      ]) {
        if (seconds >= length)
          return relativeTime.format(-Math.floor(seconds / length), unit);
      }
    }
    function render(list, downloads) {
      list.replaceChildren();
      for (const download of [...downloads].reverse().slice(0, 20)) {
        const row = el("li", { class: "arc-download-row" });
        const name = PathUtils.filename(download.target.path);
        const main = el("button", {
          type: "button",
          class: "arc-download-main",
          "aria-label": download.succeeded ? `Open ${name}` : name,
        });
        const fileIcon = el("span", {
          class: "arc-download-icon",
          "aria-hidden": "true",
        });
        fileIcon.append(
          icon(
            /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name)
              ? "media"
              : /\.(zip|7z|rar|gz|tar)$/i.test(name)
                ? "fileArchive"
                : /\.(mp4|webm|mov|mkv)$/i.test(name)
                  ? "film"
                  : /\.(mp3|wav|ogg|flac|m4a)$/i.test(name)
                    ? "music"
                    : "file",
          ),
        );
        main.append(fileIcon);
        const fileImage = el("img", {
          class: "arc-download-file-icon",
          alt: "",
          loading: "lazy",
          src: `moz-icon://${download.target.path}?size=32${download.succeeded ? "&state=normal" : ""}`,
        });
        fileImage.addEventListener(
          "load",
          () => fileIcon.classList.add("has-file-icon"),
          { once: true },
        );
        fileImage.addEventListener(
          "error",
          () => {
            fileIcon.classList.remove("has-file-icon");
            fileImage.remove();
          },
          { once: true },
        );
        fileIcon.append(fileImage);
        if (download.succeeded && /\.(png|jpe?g|gif|webp|avif)$/i.test(name)) {
          const preview = el("img", {
            class: "arc-download-preview",
            alt: "",
            loading: "lazy",
            decoding: "async",
            src: PathUtils.toFileURI(download.target.path),
          });
          preview.addEventListener(
            "load",
            () => fileIcon.classList.add("has-preview"),
            { once: true },
          );
          preview.addEventListener(
            "error",
            () => {
              fileIcon.classList.remove("has-preview");
              preview.remove();
            },
            { once: true },
          );
          fileIcon.append(preview);
        }
        main.disabled = !download.succeeded;
        main.addEventListener(
          "click",
          () => void runDownloadAction(download, "open"),
        );
        const label = el("span", { class: "arc-download-label" });
        label.append(
          el("span", { class: "arc-download-name", title: name }, name),
        );
        const size = (bytes) =>
          bytes >= 1048576
            ? `${(bytes / 1048576).toFixed(1)} MB`
            : bytes >= 1024
              ? `${Math.round(bytes / 1024)} KB`
              : `${bytes} B`;
        const meta = download.succeeded
          ? downloadAge(download)
          : download.error
            ? "Failed"
            : download.canceled
              ? download.hasPartialData
                ? "Paused"
                : "Cancelled"
              : download.hasProgress
                ? `${size(download.currentBytes)} of ${size(download.totalBytes)}`
                : "Downloading";
        const detail = el("span", { class: "arc-download-meta" }, meta);
        if (download.succeeded) {
          const time = new Date(
            download.endTime || download.startTime,
          ).getTime();
          if (Number.isFinite(time)) detail.dataset.downloadTime = String(time);
          if (download.target.size > 0)
            detail.title = size(download.target.size);
        }
        label.append(detail);
        if (!download.stopped && download.hasProgress)
          label.append(
            el("progress", {
              max: 100,
              value: download.progress,
              "aria-label": `Download progress for ${name}`,
            }),
          );
        main.append(label);
        row.append(main);
        if (download.succeeded)
          row.append(
            downloadButton(
              `Show ${name} in folder`,
              "folder-open",
              () => void runDownloadAction(download, "show"),
            ),
          );
        else if (!download.stopped || download.hasPartialData) {
          row.append(
            downloadButton(
              `${download.stopped ? "Resume" : "Pause"} ${name}`,
              download.stopped ? "play" : "pause",
              () =>
                void runDownloadAction(
                  download,
                  download.stopped ? "resume" : "pause",
                ),
            ),
          );
          row.append(
            downloadButton(
              `Cancel ${name}`,
              "x",
              () => void runDownloadAction(download, "cancel"),
            ),
          );
        }
        list.append(row);
      }
      if (!downloads.length) {
        const empty = el("li", { class: "arc-download-empty" });
        empty.textContent = "No downloads yet";
        list.append(empty);
      }
    }

    return { render, downloadAge };
  },
};
