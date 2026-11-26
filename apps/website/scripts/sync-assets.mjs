// Copies the shared Library screenshot, mark and fonts from the installer.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const installer = join(here, '..', '..', 'installer');
const source = join(installer, 'installer', 'ui');
const target = join(here, '..', 'public', 'shared');
mkdirSync(target, { recursive: true });
copyFileSync(join(source, 'product-library.png'), join(target, 'product-library.png'));
for (const file of ['geist-400.woff2', 'geist-500.woff2', 'geist-600.woff2', 'Geist-LICENSE.txt'])
  copyFileSync(join(installer, 'payload', 'content', file), join(target, file));
copyFileSync(join(source, 'zennia-mark.svg'), join(here, '..', 'public', 'icon.svg'));
