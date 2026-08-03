import { Box } from '@mantine/core';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';

// Shared framed panel used by the tailnet surfaces (admin, finance). The theme `.gold-frame` draws
// the ::after frame, `.frame-shimmer` is the one-time metal gleam, and the motion rise matches the
// site's subtle entrance. Kept here so the framed-card look lives in one place, not copied per page.
export function FrameCard({
  children,
  delay = 0,
  p = '1.1rem 1.25rem',
}: {
  children: ReactNode;
  delay?: number;
  p?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay }}
    >
      <Box className="gold-frame" style={{ padding: p, boxShadow: '0 10px 30px -16px rgba(0,0,0,0.75)' }}>
        <span className="frame-shimmer" aria-hidden />
        {children}
      </Box>
    </motion.div>
  );
}

// Soft top glow behind a tailnet page, matching the public site's backdrop.
export function TopGlow() {
  return (
    <Box
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: -1,
        pointerEvents: 'none',
        background: 'radial-gradient(1200px 820px at 50% 0%, rgba(255,255,255,0.05), transparent 60%)',
      }}
    />
  );
}
