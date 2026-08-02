import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom lacks the browser APIs Mantine and Motion touch on render. Provide inert stubs so a
// render is deterministic and never throws: matchMedia (Mantine color scheme / responsive),
// ResizeObserver (Mantine layout), IntersectionObserver (Motion whileInView).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

class Noop {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
window.ResizeObserver = Noop as unknown as typeof ResizeObserver;
window.IntersectionObserver = Noop as unknown as typeof IntersectionObserver;
