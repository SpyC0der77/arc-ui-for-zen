import { GITHUB, type ZenVersion } from '@/lib/content';

export function Compatibility({ versions }: { versions: ZenVersion[] }) {
  const older = versions.filter(version => version.library === 'menu');
  const native = versions.filter(version => version.library === 'native');

  return (
    <section className="section container section-split" id="versions">
      <div>
        <h2>Zen compatibility</h2>
        <p className="section-summary">Browser tests run on Windows for each version below. On macOS and Linux, automated tests cover installation and removal.</p>
        <a className="text-link" href={`${GITHUB}/tree/main/apps/installer/payload/zen-versions`}>Inspect the version files <span aria-hidden="true">↗</span></a>
      </div>
      <dl className="compatibility-list">
        <div>
          <dt>Native Library</dt>
          <dd>Includes Auto-Archive and Debug Mode.</dd>
          <dd className="version-list">{native.map(version => version.version).join(', ')}</dd>
        </div>
        <div>
          <dt>Library menu</dt>
          <dd>Downloads, bookmarks, history and recently closed tabs.</dd>
          <dd className="version-list">{older.map(version => version.version).join(', ')}</dd>
        </div>
      </dl>
    </section>
  );
}
