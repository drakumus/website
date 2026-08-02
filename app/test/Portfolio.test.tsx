import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { profile } from '../src/data/profile';
import { projects } from '../src/data/projects';
import Portfolio from '../src/pages/Portfolio';
import { renderApp } from './util';

describe('Portfolio', () => {
  it('renders the identity heading', () => {
    renderApp(<Portfolio />);
    expect(screen.getByRole('heading', { level: 1, name: profile.name })).toBeInTheDocument();
  });

  it('renders one openable card per project', () => {
    renderApp(<Portfolio />);
    // Each project card is a button labelled "Open <title>" (opens the detail modal).
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(projects.length);
  });
});
