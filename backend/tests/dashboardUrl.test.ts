import { describe, it, expect } from 'vitest';
import { getDashboardUrl } from '../src/utils/dashboardUrl.js';

describe('getDashboardUrl', () => {
  it('uses PUBLIC_URL when set', () => {
    expect(getDashboardUrl({ PUBLIC_URL: 'https://example.com' })).toBe('https://example.com');
  });
  it('production fallback', () => {
    expect(getDashboardUrl({ NODE_ENV: 'production' })).toBe('https://football-analytics-bot-0zwd.onrender.com');
  });
  it('localhost in dev', () => {
    expect(getDashboardUrl({ NODE_ENV: 'development' })).toBe('http://localhost:5000');
  });
});