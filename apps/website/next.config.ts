import path from 'node:path';
import type { NextConfig } from 'next';

// The site reads installer data from the rest of the monorepo at build time.
const root = path.join(__dirname, '..', '..');

const config: NextConfig = {
  outputFileTracingRoot: root,
  turbopack: { root },
};

export default config;
