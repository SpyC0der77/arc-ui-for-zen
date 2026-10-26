/* Arc UI auto-archive: retires long-idle background tabs into Zen's Archive list. */
var ArcArchive = {
  DEFAULT_HOURS: 12,
  MAX_PER_RUN: 10,
  FIRST_RUN_DELAY_MS: 90000,
  RUN_INTERVAL_MS: 300000,

  /**
   * Reads the idle window in hours. Zero turns auto-archive off; a missing or
   * invalid value keeps the Arc default rather than archiving more eagerly.
   *
   * @param {nsIPrefBranch} prefs
   * @returns {number}
   */
  hours(prefs) {
    let hours = ArcArchive.DEFAULT_HOURS;
    try {
      hours = prefs.getIntPref("arc-ui.archive.hours", ArcArchive.DEFAULT_HOURS);
    } catch (error) {
      return ArcArchive.DEFAULT_HOURS;
    }
    return Number.isInteger(hours) && hours >= 0 ? hours : ArcArchive.DEFAULT_HOURS;
  },

  /**
   * Whether a tab may leave the tab strip for the Archive.
   *
   * Everything the user pinned, is looking at, is listening to, or filed away
   * stays where it is. Only ordinary web pages the user has ignored long
   * enough are eligible.
   *
   * @param {object} tab - Tab facts, not the live XUL tab
   * @param {number} now
   * @param {number} idleMs
   * @returns {boolean}
   */
  eligible(tab, now, idleMs) {
    if (!tab || tab.closed) return false;
    if (tab.private || tab.pinned || tab.essential) return false;
    if (tab.selected || tab.multiselected) return false;
    if (tab.splitview || tab.grouped || tab.folded) return false;
    if (tab.audible || tab.busy || tab.attention) return false;
    if (!tab.url || !/^(https?|file):/i.test(tab.url)) return false;
    if (!Number.isFinite(tab.lastAccessed) || tab.lastAccessed <= 0) return false;
    return now - tab.lastAccessed >= idleMs;
  },

  /**
   * The tabs due for archiving, least recently used first and capped so one
   * pass cannot fill the Archive's closed-tab history on its own.
   *
   * @param {object[]} tabs
   * @param {object} options
   * @param {number} options.now
   * @param {number} options.hours
   * @returns {object[]}
   */
  due(tabs, { now = Date.now(), hours = ArcArchive.DEFAULT_HOURS } = {}) {
    const idleMs = hours * 3600000;
    if (!(idleMs > 0)) return [];
    return tabs
      .filter(tab => ArcArchive.eligible(tab, now, idleMs))
      .sort((a, b) => a.lastAccessed - b.lastAccessed)
      .slice(0, ArcArchive.MAX_PER_RUN);
  },

  /**
   * Runs the archive pass once shortly after startup, then on an interval.
   *
   * All browser access is injected so the schedule is testable: `tabs()`
   * returns tab facts, `close(row)` closes one, and `schedule`/`cancel` own
   * the timers.
   *
   * @param {object} options
   * @returns {Function} Stop function
   */
  start({
    tabs,
    close,
    announce = () => {},
    getHours = () => ArcArchive.DEFAULT_HOURS,
    now = Date.now,
    isClosed = () => false,
    schedule,
    cancel = () => {},
    onError = () => {},
    delay = ArcArchive.FIRST_RUN_DELAY_MS,
    interval = ArcArchive.RUN_INTERVAL_MS,
  }) {
    let stopped = false;
    let timer = null;

    function run() {
      timer = null;
      if (stopped || isClosed()) return;
      try {
        const rows = ArcArchive.due(tabs(), { now: now(), hours: getHours() });
        let archived = 0;
        for (const row of rows) {
          if (stopped || isClosed()) break;
          try {
            close(row);
            archived++;
          } catch (error) {
            onError(error);
          }
        }
        if (archived) announce(archived);
      } catch (error) {
        onError(error);
      }
      if (!stopped && !isClosed()) timer = schedule(run, interval);
    }

    timer = schedule(run, delay);
    return () => {
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
    };
  },
};
