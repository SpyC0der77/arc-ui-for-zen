var ArcUpdates = {
  install(window, { el, icon, PrivateBrowsingUtils }) {
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return { destroy() {} };
    const { ArcUpdater: updater } = window.ChromeUtils.importESModule('chrome://arc-ui/content/updater.sys.mjs');
    const { document } = window;
    const button = el('button', { id: 'arc-update-button', type: 'button', hidden: true, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    button.append(icon('download'), el('span', { id: 'arc-update-label' }));
    const popup = el('div', { id: 'arc-update-popup', popover: 'auto', role: 'dialog', 'aria-label': 'Arc UI release notes' });
    const title = el('p', { class: 'arc-update-title' });
    const message = el('p', { role: 'status' });
    const progress = el('progress', { max: 100, 'aria-label': 'Installer download progress' });
    const notes = el('div', { class: 'arc-update-notes' });
    const action = el('button', { type: 'button' });
    const link = el('a', { href: '#', class: 'arc-update-link' }, 'View release on GitHub');
    popup.append(title, message, progress, notes, action, link);
    document.body.append(popup);
    const place = () => {
      const footer = document.getElementById('zen-sidebar-foot-buttons');
      if (footer && button.parentNode !== footer) footer.append(button);
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
      show();
      if (updater.state === 'ready') void updater.install();
      else if (['available', 'error'].includes(updater.state)) void updater.download();
    }
    button.addEventListener('click', activate);
    action.addEventListener('click', activate);
    link.addEventListener('click', event => {
      event.preventDefault();
      window.openTrustedLinkIn(`https://github.com/SpyC0der77/arc-ui-for-zen/releases/tag/${encodeURIComponent(updater.release.tag_name)}`, 'tab');
    });
    function render() {
      button.hidden = !updater.release;
      if (!updater.release) return;
      const state = updater.state;
      const label = state === 'downloading' ? `Downloading${updater.progress === null ? '…' : ` ${updater.progress}%`}` : state === 'opening' ? 'Opening installer…' : state === 'ready' ? 'Install update' : state === 'error' ? 'Retry download' : 'Download update';
      button.querySelector('span').textContent = label;
      button.setAttribute('aria-label', `Arc UI ${updater.release.tag_name}: ${label}`);
      title.textContent = `Arc UI ${updater.release.tag_name}`;
      message.textContent = updater.error || (state === 'ready' ? 'Download verified. Open the installer to update this Zen installation.' : state === 'downloading' ? label : 'A new version is available.');
      progress.hidden = state !== 'downloading';
      if (updater.progress === null) progress.removeAttribute('value'); else progress.value = updater.progress;
      action.textContent = label; action.disabled = ['downloading', 'opening'].includes(state);
      if (shownRelease !== updater.release) {
        shownRelease = updater.release;
        notes.replaceChildren();
        for (const line of (updater.release.body || 'No release notes provided.').slice(0, 40000).split(/\r?\n/)) {
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
