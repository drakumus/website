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
import AdminDashboard from './AdminDashboard';

// Admin dashboard (admin.zoci.me, tailnet-only). Its own bundle, built separately from the public
// site and served by the admin-web container so no admin UI code reaches the public zoci.me
// bundle. Same React + Mantine stack + theme as the public site.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <AdminDashboard />
    </MantineProvider>
  </StrictMode>,
);
