#!/usr/bin/env node

import { copyFileSync, existsSync } from 'fs';
import { join } from 'path';

const sourceFile = 'node_modules/decap-cms-app/dist/decap-cms-app.js';
const targetFile = 'public/decap-cms-app.js';

if (existsSync(sourceFile)) {
  copyFileSync(sourceFile, targetFile);
  console.log('✓ Copied Decap CMS from local package to public directory');
} else {
  console.warn('⚠ Local Decap CMS package not found, CMS will fall back to CDN');
}