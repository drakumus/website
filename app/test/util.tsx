import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';

// Pages use Mantine context and react-router links, so render them inside the same providers the
// app mounts at startup (see app/src/main.tsx), minus the real BrowserRouter.
export function renderApp(ui: ReactNode) {
  return render(
    <MemoryRouter>
      <MantineProvider>{ui}</MantineProvider>
    </MemoryRouter>,
  );
}
