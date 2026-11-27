// Removes Zennia from the running browser's installation and profile, as the installer's remove
// does (engine.cjs): every file in the receipt goes back to what it was before installing, and
// user.js keeps settings added since, losing only Zennia's block. Everything is checked before
// anything is written, and a failed write puts every file back. Preferences are the caller's:
// the running browser holds them, so it restores them from the returned receipt.
// Shared by the browser updater and filesystem regression tests.
const USER_BLOCK = /\/\/ BEGIN Zennia\r?\n[\s\S]*?\/\/ END Zennia(?:\r?\n)?/g;

export async function uninstallTheme({io, paths, hash, decode, encode}) {
  const {profile, resources, join, separator} = paths;
  const receiptPath = join(profile, 'chrome', 'zennia.install.json');
  const ownerPath = join(resources, 'zennia-owner.json');
  const userPath = join(profile, 'user.js');
  const appFiles = [ownerPath, join(resources, 'zennia.cfg'), join(resources, 'defaults', 'pref', 'zennia-autoconfig.js')];
  const root = join(profile, 'chrome', 'zennia') + separator;

  const receipt = await io.readJSON(receiptPath), owner = await io.readJSON(ownerPath);
  if (receipt.profile !== profile || receipt.resources !== resources || owner.profile !== profile || owner.version !== receipt.version)
    throw new Error('The installation receipt belongs to a different Zen installation or profile.');
  if (await io.exists(join(profile, 'chrome', 'zennia-update-journal.json')))
    throw new Error('An interrupted update needs recovery first. Restart Zen and try again.');

  // What each file becomes (null: removed), and what it is now, to roll back to.
  const next = new Map(), current = new Map();
  for (const file of receipt.files) {
    const owned = appFiles.includes(file.path) || file.path === userPath || file.path.startsWith(root);
    if (!owned || next.has(file.path)) throw new Error('Invalid installation receipt.');
    await io.assertPath(file.path);
    const bytes = await io.exists(file.path) ? await io.read(file.path) : null;
    current.set(file.path, bytes);
    let restored = file.before === null ? null : decode(file.before);
    if (bytes && await hash(bytes) !== file.installedHash) {
      if (file.path !== userPath) throw new Error('A Zennia file was edited after installation: ' + file.path);
      const text = new TextDecoder().decode(bytes);
      if (text.match(USER_BLOCK)?.length !== 1)
        throw new Error("Zennia's settings block in user.js was edited. Restore its BEGIN and END lines and try again.");
      restored = encode(text.replace(USER_BLOCK, ''));
    }
    next.set(file.path, restored);
  }
  if (![userPath, ...appFiles].every(file => next.has(file))) throw new Error('Incomplete installation receipt.');
  await io.assertPath(receiptPath);
  current.set(receiptPath, await io.read(receiptPath));

  const put = (file, bytes) => (bytes === null ? io.remove(file) : io.write(file, bytes));
  try {
    for (const [file, bytes] of [...next].reverse()) await put(file, bytes);
    // Last, so a removal that stops part way still has its receipt.
    await io.remove(receiptPath);
  } catch (error) {
    const failures = [];
    for (const [file, bytes] of current) await put(file, bytes).catch(failure => failures.push(failure.message));
    throw new Error(`${error.message} ` +
      (failures.length ? `Restoring Zennia's files also failed, so keep zennia.install.json: ${failures.join('; ')}` : 'Nothing was changed.'));
  }
  return receipt;
}
