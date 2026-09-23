import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Every build gets a version. The app compares it with /version.json to offer "Update".
const VERSION = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || Date.now().toString(36);

function versionFiles() {
  let outDir;
  return {
    name: 'linkup-version',
    apply: 'build',
    configResolved(c) { outDir = path.resolve(c.root, c.build.outDir); },
    closeBundle() {
      fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify({ version: VERSION }));
      // A new sw.js per build, so phones install the new service worker (and drop the old cache).
      const sw = path.join(outDir, 'sw.js');
      fs.writeFileSync(sw, fs.readFileSync(sw, 'utf8').replaceAll('__BUILD__', VERSION));
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFiles()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
