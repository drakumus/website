import { useEffect, useState } from 'react';
import { HealthResponse, SystemStatus, HealthDot } from '@zoci/shared';

/** Tiny demo of the shared-types API wiring (site spec §6). */
export function useApiHealth() {
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setStatus(HealthResponse.parse(d).status))
      .catch(() => setStatus('down'));
  }, []);
  return status;
}

/** Public aggregate health dot, polled for the landing page. null = still loading. The full
 *  per-service verdict is never public; this is the only health signal on zoci.me. */
export function useHealthDot(intervalMs = 30000): HealthDot | null {
  const [dot, setDot] = useState<HealthDot | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch('/api/health-dot')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`dot ${r.status}`))))
        .then((d) => {
          if (active) setDot(HealthDot.parse(d));
        })
        .catch(() => {
          if (active) setDot({ status: 'unknown' });
        });
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return dot;
}

/** Home-server container health, polled for the landing dashboard. null = still loading. */
export function useSystemStatus(intervalMs = 15000) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch('/api/status')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
        .then((d) => {
          if (active) setStatus(SystemStatus.parse(d));
        })
        .catch(() => {
          if (active) setStatus({ containers: [] });
        });
    load();
    const id = setInterval(load, intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intervalMs]);
  return status;
}
