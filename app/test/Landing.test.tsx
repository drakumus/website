import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
import Landing from '../src/pages/Landing';
import { renderApp } from './util';

describe('Landing', () => {
  beforeEach(() => {
    // useHealthDot fetches /api/health-dot on mount; reject it so the aggregate status falls back
    // to the unavailable (unknown) state, which is what the no-network assertion below checks.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network'))));
  });

  it('renders both destination links to the right targets', () => {
    renderApp(<Landing />);
    expect(screen.getByRole('link', { name: /Portfolio/ })).toHaveAttribute('href', '/portfolio');
    expect(screen.getByRole('link', { name: /Jellyfin/ })).toHaveAttribute('href', 'https://js1.zoci.me');
  });

  it('shows only a single aggregate status, never per-service internal detail', async () => {
    renderApp(<Landing />);
    // With the dot fetch failing, the public page shows the unavailable state, not a green.
    expect(await screen.findByText(/Status unavailable/)).toBeInTheDocument();
    // The public front page must NOT enumerate internal services (that stays tailnet-only).
    for (const name of ['Caddy', 'API', 'ha-broker', 'Jellyfin', 'CoreDNS']) {
      // Jellyfin appears as a destination link label, so only assert the internal-only names.
      if (name === 'Jellyfin') continue;
      expect(screen.queryByText(name)).toBeNull();
    }
  });
});
