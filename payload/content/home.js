"use strict";
window.addEventListener("DOMContentLoaded", () => {
document.getElementById("preview").addEventListener("click", async event => {
  const button = event.currentTarget;
  const status = document.getElementById("status");
  button.disabled = true;
  try {
    const win = window.browsingContext.topChromeWindow;
    if (!win.Zennia) throw new Error("The Zennia patch is not loaded. Restart Zen after installing.");
    status.textContent = "";
    await win.Zennia.previewDownload(event.detail ? {
      clientX: event.screenX - win.mozInnerScreenX,
      clientY: event.screenY - win.mozInnerScreenY,
    } : undefined);
    status.textContent = "Preview complete. No file was downloaded.";
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

}, {once:true});
