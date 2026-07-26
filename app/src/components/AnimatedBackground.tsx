import { motion, useReducedMotion } from 'motion/react';

// Ambient background: one consistent, even glow from the top — no offset hotspots.
// Gently breathes opacity (cheap; no layout/paint of blur). Matches the top-glow
// gradient on the rest of the site so the landing reads consistent. Disabled under
// prefers-reduced-motion.
export function AnimatedBackground() {
  const reduce = useReducedMotion();

  return (
    <motion.div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        pointerEvents: 'none',
        background:
          'radial-gradient(130% 90% at 50% -20%, rgba(255, 255, 255, 0.09), transparent 55%)',
        willChange: 'opacity',
      }}
      animate={reduce ? undefined : { opacity: [0.8, 1, 0.8] }}
      transition={
        reduce ? undefined : { duration: 14, repeat: Infinity, ease: 'easeInOut' }
      }
    />
  );
}
