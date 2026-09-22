// Test environment: config validates env at import time, so satisfy it here
// before any module under test is loaded. No DB/network is touched by tests —
// they exercise the pure logic layers.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/strata_test';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789';
process.env.TOKEN_ENC_KEY ??= 'a'.repeat(64);

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
