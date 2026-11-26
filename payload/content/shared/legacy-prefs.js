/* Carry settings saved before the project was renamed from Arc UI to Zennia.
   Each arc-ui.* user pref moves to the matching zennia.* pref once; a value
   already saved under the new name wins. */
var ZenniaLegacyPrefs = {
  FROM: "arc-ui.",
  TO: "zennia.",
  migrate(prefs) {
    const legacy = prefs.getBranch(this.FROM);
    for (const name of legacy.getChildList("")) {
      const from = this.FROM + name, to = this.TO + name;
      if (!prefs.prefHasUserValue(from)) continue;
      if (!prefs.prefHasUserValue(to)) {
        const type = prefs.getPrefType(from);
        if (type === prefs.PREF_STRING) prefs.setStringPref(to, prefs.getStringPref(from));
        else if (type === prefs.PREF_INT) prefs.setIntPref(to, prefs.getIntPref(from));
        else if (type === prefs.PREF_BOOL) prefs.setBoolPref(to, prefs.getBoolPref(from));
        else continue;
      }
      prefs.clearUserPref(from);
    }
  },
};
