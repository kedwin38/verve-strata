import { describe, it, expect } from 'vitest';
import {
  parsePackageJson, parseRequirementsTxt, parsePackageLock,
} from '../src/engine/manifests.js';

describe('parsePackageJson', () => {
  it('extracts prod and dev deps with kinds', () => {
    const parsed = parsePackageJson(JSON.stringify({
      name: 'x',
      dependencies: { express: '^4.18.0', '@scope/pkg': '~2.1.0' },
      devDependencies: { vite: '^6.0.0' },
      optionalDependencies: { fsevents: '^3.0.0' },
    }))!;
    expect(parsed.deps.size).toBe(4);
    expect(parsed.deps.get('express')).toEqual({ name: 'express', range: '^4.18.0', kind: 'prod' });
    expect(parsed.deps.get('vite')!.kind).toBe('dev');
    expect(parsed.deps.get('@scope/pkg')!.range).toBe('~2.1.0');
    expect(parsed.deps.get('fsevents')!.kind).toBe('prod');
  });

  it('returns null on malformed json', () => {
    expect(parsePackageJson('{ nope')).toBeNull();
  });
});

describe('parseRequirementsTxt', () => {
  it('parses pins, ranges, comments and options', () => {
    const txt = [
      '# core',
      'flask==2.3.3',
      'requests >= 2.31, < 3.0',
      'numpy~=1.26',
      'click',
      '-r other.txt',
      '--index-url https://example.com',
      '',
      'pytest # test-only comment',
    ].join('\n');
    const deps = parseRequirementsTxt(txt);
    expect(deps.size).toBe(5);
    expect(deps.get('flask')!.range).toBe('==2.3.3');
    expect(deps.get('requests')!.range).toBe('>= 2.31, < 3.0');
    expect(deps.get('numpy')!.range).toBe('~=1.26');
    expect(deps.get('click')!.range).toBeNull();
    expect(deps.get('pytest')!.range).toBeNull();
  });

  it('normalizes hyphenated names to underscores', () => {
    const deps = parseRequirementsTxt('typing-extensions>=4.0');
    expect(deps.has('typing_extensions')).toBe(true);
  });
});

describe('parsePackageLock', () => {
  it('extracts exact pins from lockfile v3 packages map', () => {
    const lock = JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'x', dependencies: { lodash: '^4.17.0' } },
        'node_modules/lodash': { version: '4.17.21' },
        'node_modules/express': { version: '4.18.2' },
      },
    });
    const pins = parsePackageLock(lock);
    expect(pins.get('lodash')).toBe('4.17.21');
    expect(pins.get('express')).toBe('4.18.2');
    expect(pins.has('')).toBe(false);
  });

  it('handles v1 dependencies map and garbage input', () => {
    const pins = parsePackageLock(JSON.stringify({
      dependencies: { semver: { version: '7.6.0' } },
    }));
    expect(pins.get('semver')).toBe('7.6.0');
    expect(parsePackageLock('not json').size).toBe(0);
  });
});
