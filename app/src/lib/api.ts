import { useEffect, useState } from 'react';
import { HealthResponse, SystemStatus } from '@zoci/shared';

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
