import Image from 'next/image';
import { Compatibility } from '@/components/compatibility';
import { Features } from '@/components/features';
import { changes, DOWNLOAD, GITHUB, installerVersion, zenVersions } from '@/lib/content';

export default function Home() {
  const versions = zenVersions();
  const range = `${versions[0].version} to ${versions.at(-1)!.version}`;
  const version = installerVersion();
  const recent = changes().filter(change => change.release === `v${version}`);

  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="#top">
            <img src="/icon.svg" alt="" width="28" height="28" /> Zennia
          </a>
          <nav aria-label="Main navigation">
            <a href="#features">Features</a>
            <a href="#versions">Compatibility</a>
            <a href="#changes">Changelog</a>
          </nav>
          <a className="header-install" href="#install">Install <span aria-hidden="true">↓</span></a>
        </div>
      </header>

      <main id="main">
        <section className="hero" id="top">
          <div className="container hero-inner">
            <div className="hero-copy">
              <h1>The Arc look<br />for Zen.</h1>
              <p>A lavender sidebar, a centered command bar, and your tabs and Spaces right where you left them. Install Zennia into the Zen profile you already use.</p>
              <div className="actions">
                <a className="button" href={DOWNLOAD}>Download Zennia</a>
                <a className="text-link" href={GITHUB}>View on GitHub <span aria-hidden="true">↗</span></a>
              </div>
              <p className="platforms">Windows, macOS and Linux <span aria-hidden="true">·</span> Free</p>
            </div>
            <figure className="hero-preview">
              <Image src="/product/sidebar.png" width={2048} height={1544} sizes="(min-width: 1184px) 656px, (min-width: 960px) 56vw, 100vw" alt="Zennia’s lavender sidebar with Figma, YouTube, and Spotify pinned and the Python documentation open" preload />
              <figcaption>Zennia’s sidebar in Zen Browser</figcaption>
            </figure>
          </div>
        </section>

        <Features />

        <section className="section install-section" id="install">
          <div className="container section-split">
            <div>
              <h2>Install Zennia</h2>
              <p className="section-summary">The current source supports Zen {range}. Check the notes on the release you download for its supported versions.</p>
              <div className="actions">
                <a className="button" href={DOWNLOAD}>Browse releases</a>
                <a className="text-link" href={`${GITHUB}#command-line`}>Command-line setup <span aria-hidden="true">↗</span></a>
              </div>
            </div>
            <ol className="install-steps">
              <li><strong>Download the installer for your OS.</strong><p>Pick a Windows executable, macOS archive, or Linux AppImage from GitHub Releases.</p></li>
              <li><strong>Choose your Zen installation and profile.</strong><p>Close Zen, then select Install. The installer records the files it adds.</p></li>
              <li><strong>Open Zen from the installer.</strong><p>Use Remove in the same installer to restore your previous setup.</p></li>
            </ol>
          </div>
        </section>

        <Compatibility versions={versions} />

        <section className="section container section-split" id="changes">
          <div>
            <h2>Changelog</h2>
            <p className="section-summary">Zennia {version}</p>
            <a className="text-link" href={`${GITHUB}/blob/main/CHANGES.md`}>Read the full changelog <span aria-hidden="true">↗</span></a>
          </div>
          <ul className="release-notes">
            {recent.map(change => <li key={change.text}>{change.text}</li>)}
          </ul>
        </section>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <p>A theme for Zen Browser.</p>
          <nav aria-label="Project links">
            <a href={GITHUB}>Source</a>
            <a href={`${GITHUB}/issues`}>Report an issue</a>
            <a href={`${GITHUB}#installation-details`}>Installation details</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
