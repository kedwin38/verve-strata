import { describe, it, expect } from 'vitest';
import {
  scanJsImports, scanPyImports, normalizeJsPackage, prioritizeFiles, isSourceFile,
} from '../src/engine/imports.js';

describe('scanJsImports', () => {
  it('captures require, import-from, dynamic import; excludes relative paths', () => {
    const src = `
      const express = require('express');
      import { Router } from '@angular/router';
      const dyn = import('lodash/merge');
      import local from './local.js';
      require('../parent');
      const fs = require('node:fs');
    `;
    const refs = scanJsImports(src);
    expect(refs).toContain('express');
    expect(refs).toContain('@angular/router');
    expect(refs).toContain('lodash');
    expect(refs).not.toContain('./local.js');
    expect(refs).not.toContain('node:fs');
  });

  it('normalizes scoped packages to scope/name', () => {
    expect(normalizeJsPackage('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(normalizeJsPackage('plain/sub')).toBe('plain');
  });
});

describe('scanPyImports', () => {
  it('captures from-import and plain import top-level modules', () => {
    const src = `
import os
import numpy as np
from flask import Flask
from requests.adapters import HTTPAdapter
`;
    const refs = scanPyImports(src);
    expect(refs).toContain('os');
    expect(refs).toContain('numpy');
    expect(refs).toContain('flask');
    expect(refs).toContain('requests');
    expect(refs).not.toContain('requests.adapters');
  });
});

describe('file triage', () => {
  it('classifies source files and rejects vendored/generated paths', () => {
    expect(isSourceFile('src/app.ts')).toBe(true);
    expect(isSourceFile('lib/core.py')).toBe(true);
    expect(isSourceFile('node_modules/x/index.js')).toBe(false);
    expect(isSourceFile('dist/bundle.js')).toBe(false);
    expect(isSourceFile('src/app.test.ts')).toBe(false);
    expect(isSourceFile('types.d.ts')).toBe(false);
  });

  it('prioritizes entrypoints and shallow paths under the cap', () => {
    const files = [
      'deep/a/b/c/d/thing.js',
      'src/index.ts',
      'src/server.ts',
      'a/b/c/module.ts',
      'src/utils/helper.ts',
    ];
    const picked = prioritizeFiles(files, 3);
    expect(picked[0]).toBe('src/index.ts');
    expect(picked.length).toBe(3);
    expect(picked).not.toContain('deep/a/b/c/d/thing.js');
  });
});
