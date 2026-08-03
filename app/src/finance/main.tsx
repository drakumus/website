import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
// Same shared visual layer as the public site (tokens, .title-accent, .gold-frame, .rise).
import '@zoci/shared/theme.css';
import '../index.css';
import { theme } from '../theme';
import FinanceApp from './FinanceApp';

// Finance dashboard (finance.zoci.me, tailnet-only). Its own bundle, built separately from the
// public site and served by the finance-web container so no finance UI code reaches the public
// zoci.me bundle. Same React + Mantine stack + theme as the rest of the site.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <FinanceApp />
    </MantineProvider>
  </StrictMode>,
);
