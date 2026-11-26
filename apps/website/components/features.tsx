import Image from 'next/image';
import { GITHUB } from '@/lib/content';

const features = [
  {
    title: 'A Space for each project',
    description: 'Keep work, personal tabs and reading lists in their own Spaces. Each one keeps its pinned tabs and folders. Hide the sidebar when you need more room and reveal it at the window edge.',
    image: '/product/spaces.png',
    width: 1945,
    height: 1543,
    alt: 'The Spaces overview showing Work, Personal, and Reading side by side',
  },
  {
    title: 'Commands where you type',
    description: 'Open the centered address bar to search with Zen’s suggestions. Type Archive, Downloads, or Split View to run a command in the same place.',
    image: '/product/commands.png',
    width: 2048,
    height: 1544,
    alt: 'The centered command bar with the Open Archive command among its suggestions',
  },
  {
    title: 'Downloads and archived tabs in reach',
    description: 'Downloads animate into the gift button. Open the Library there to find downloads or restore archived tabs. Auto-Archive moves idle tabs out of the sidebar on Zen versions with the native Library.',
    image: '/shared/product-library.png',
    width: 2048,
    height: 1544,
    alt: 'Zen’s Library open with archived tabs that can be restored',
  },
];

export function Features() {
  return (
    <section className="section container" id="features">
      <h2>What Zennia adds</h2>
      <div className="feature-grid">
        {features.map(({ title, description, image, width, height, alt }) => (
          <article key={image} className="feature">
            <Image src={image} width={width} height={height} sizes="(min-width: 1184px) 358px, (min-width: 800px) 32vw, 100vw" alt={alt} />
            <h3>{title}</h3>
            <p>{description}</p>
          </article>
        ))}
      </div>
      <a className="text-link" href={`${GITHUB}#features`}>See all features <span aria-hidden="true">↗</span></a>
    </section>
  );
}
