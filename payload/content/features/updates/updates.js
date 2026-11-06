var ArcUpdates = {
  install(window, { el, icon, PrivateBrowsingUtils }) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return { destroy() {} };
    const { ArcUpdater: updater } = window.ChromeUtils.importESModule('chrome://arc-ui/content/updater.sys.mjs');
    const { document } = window;
    const button = el('button', { id: 'arc-update-button', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    button.append(icon('download'));
    const popup = el('div', { id: 'arc-update-popup', popover: 'auto', role: 'dialog', 'aria-label': 'Arc UI release notes' });
    const title = el('p', { class: 'arc-update-title' });
    const message = el('p', { role: 'status' });
    const progress = el('progress', { max: 100, 'aria-label': 'Theme download progress' });
    const notes = el('div', { class: 'arc-update-notes' });
    const action = el('button', { type: 'button' });
    const link = el('a', { href: '#', class: 'arc-update-link' }, 'View release on GitHub');
    popup.append(title, message, progress, notes, action, link);
    document.body.append(popup);
    const place = () => {
      const footer = document.getElementById('zen-sidebar-foot-buttons');
      const gift = document.getElementById('arc-gift-button');
      if (footer && gift?.parentNode === footer && gift.nextElementSibling !== button) gift.after(button);
      else if (footer && button.parentNode !== footer) footer.append(button);
    };
    const observer = new window.MutationObserver(place);
    observer.observe(document.getElementById('navigator-toolbox'), { childList: true, subtree: true });
    place();
    let hideTimer, shownRelease;
    function hide() { popup.hidePopover(); button.setAttribute('aria-expanded', 'false'); }
    function show() {
      window.clearTimeout(hideTimer);
      if (button.hidden) return;
      popup.showPopover(); button.setAttribute('aria-expanded', 'true');
      const r = button.getBoundingClientRect();
      popup.style.left = Math.max(8, Math.min(r.left, window.innerWidth - popup.offsetWidth - 8)) + 'px';
      popup.style.top = Math.max(8, r.top - popup.offsetHeight - 8) + 'px';
    }
    const later = () => { hideTimer = window.setTimeout(() => { if (!popup.contains(document.activeElement) && document.activeElement !== button) hide(); }, 240); };
    for (const node of [button, popup]) {
      node.addEventListener('pointerenter', show);
      node.addEventListener('pointerleave', later);
      node.addEventListener('focusin', show);
      node.addEventListener('focusout', later);
    }
    popup.addEventListener('toggle', () => button.setAttribute('aria-expanded', String(popup.matches(':popover-open'))));
    function activate() {
      if (updater.state === 'ready') void updater.restart();
      else if (['available', 'error'].includes(updater.state)) void updater.download();
      show();
    }
    button.addEventListener('click', activate);
    action.addEventListener('click', activate);
    link.addEventListener('click', event => {
      event.preventDefault();
      window.openTrustedLinkIn(`https://github.com/SpyC0der77/arc-ui-for-zen/releases/tag/${encodeURIComponent(updater.release.tag_name)}`, 'tab');
    });
    function render() {
      button.hidden = !updater.release;
      if (!updater.release) { hide(); return; }
      const state = updater.state;
      const label = state === 'downloading' ? `Downloading${updater.progress === null ? '…' : ` ${updater.progress}%`}` : state === 'applying' ? 'Applying update...' : state === 'restarting' ? 'Restarting...' : state === 'ready' ? 'Restart to apply' : state === 'error' ? 'Retry download' : 'Download update';
      button.setAttribute('aria-label', `Arc UI ${updater.release.tag_name}: ${label}`);
      title.textContent = `Arc UI ${updater.release.tag_name}`;
      message.textContent = updater.error || (state === 'ready' ? 'Theme updated in place. Restart Zen to apply it.' : state === 'downloading' ? label : 'A new version is available.');
      progress.hidden = state !== 'downloading';
      if (updater.progress === null) progress.removeAttribute('value'); else progress.value = updater.progress;
      action.textContent = label; action.disabled = ['downloading', 'applying', 'restarting'].includes(state);
      if (shownRelease !== updater.release) {
        shownRelease = updater.release;
        notes.replaceChildren();
        const lines = (updater.release.body || '').slice(0, 40000).split(/\r?\n/);
        const start = lines.findIndex(line => /^#{1,6}\s+(?:changelog|changes(?: since the previous release)?|what.s new)\s*$/i.test(line.trim()));
        let changes = [];
        if (start >= 0) {
          const level = lines[start].match(/^#+/)[0].length;
          const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}}\\s+`).test(line));
          changes = lines.slice(start + 1, end < 0 ? undefined : end);
        }
        if (!changes.some(line => line.trim())) changes = ['No changelog provided.'];
        for (const line of changes) {
          if (!line.trim()) continue;
          notes.append(el('p', {}, line.replace(/^#{1,6}\s+/, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')));
        }
      }
    }
    updater.listeners.add(render); render();
    let stopped = false;
    async function poll() {
      try { await updater.check(); }
      finally { if (!stopped) pollTimer = window.setTimeout(poll, 6 * 60 * 60 * 1000); }
    }
    let pollTimer = window.setTimeout(poll, 30000);
    return { destroy() { stopped = true; observer.disconnect(); updater.listeners.delete(render); window.clearTimeout(pollTimer); window.clearTimeout(hideTimer); popup.remove(); button.remove(); } };
  },
};

