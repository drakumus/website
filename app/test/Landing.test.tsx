import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { SERVICES } from '@zoci/shared';
import Landing from '../src/pages/Landing';
import { renderApp } from './util';

describe('Landing', () => {
  beforeEach(() => {
    // useSystemStatus fetches /api/status on mount; reject it so ServerStatus falls back to the
    // canonical SERVICES labels (the loading/offline state), which is what this asserts.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  });

  it('renders both destination links to the right targets', () => {
    renderApp(<Landing />);
    expect(screen.getByRole('link', { name: /Portfolio/ })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('link', { name: /Jellyfin/ })).toHaveAttribute('href', 'https://js1.zoci.me');
  });

  it('renders a fallback label for every canonical service', () => {
    renderApp(<Landing />);
    for (const s of SERVICES) {
      expect(screen.getAllByText(s.name).length).toBeGreaterThan(0);
    }
  });
});
