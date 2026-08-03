/**
 * Minimal Prometheus metrics registry. This is a local, self-contained copy of the same utility
 * in `shared/src/metrics.ts`: ha-broker is a standalone package (own lockfile, build context =
 * ha-broker/) so the token holder's image stays minimal, which means it cannot import from the
 * monorepo's shared package. A metrics registry is a generic utility, not a cross-boundary
 * contract, so a local copy is the right call rather than widening this build context.
 *
 * Owning the text exposition guarantees no HA token or entity_id can reach a label (spec §5).
 */

export type Labels = Record<string, string>;

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function renderLabels(labels: Labels, extra?: Labels): string {
  const all = { ...labels, ...(extra ?? {}) };
  const keys = Object.keys(all).sort();
  if (keys.length === 0) return '';
  return '{' + keys.map((k) => `${k}="${escapeLabelValue(all[k] ?? '')}"`).join(',') + '}';
}

function mapKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${labels[k]}`).join('\x1f');
}

interface Metric {
  readonly name: string;
  expose(): string[];
}

class Counter implements Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, private readonly help: string) {}

  inc(labels: Labels = {}, delta = 1): void {
    const k = mapKey(labels);
    const cur = this.values.get(k);
    if (cur) cur.value += delta;
    else this.values.set(k, { labels, value: delta });
  }

  expose(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const { labels, value } of this.values.values()) {
      out.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return out;
  }
}

class Gauge implements Metric {
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(readonly name: string, private readonly help: string) {}

  set(value: number, labels: Labels = {}): void {
    this.values.set(mapKey(labels), { labels, value });
  }
  inc(labels: Labels = {}, delta = 1): void {
    const k = mapKey(labels);
    const cur = this.values.get(k);
    if (cur) cur.value += delta;
    else this.values.set(k, { labels, value: delta });
  }
  dec(labels: Labels = {}, delta = 1): void {
    this.inc(labels, -delta);
  }

  expose(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, value } of this.values.values()) {
      out.push(`${this.name}${renderLabels(labels)} ${value}`);
    }
    return out;
  }
}

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Histogram implements Metric {
  private readonly data = new Map<
    string,
    { labels: Labels; counts: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    private readonly help: string,
    private readonly buckets: number[] = DEFAULT_BUCKETS,
  ) {}

  observe(value: number, labels: Labels = {}): void {
    const k = mapKey(labels);
    let entry = this.data.get(k);
    if (!entry) {
      entry = { labels, counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.data.set(k, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.counts[i] += 1;
    }
  }

  expose(): string[] {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const entry of this.data.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += entry.counts[i];
        out.push(
          `${this.name}_bucket${renderLabels(entry.labels, { le: String(this.buckets[i]) })} ${cumulative}`,
        );
      }
      out.push(`${this.name}_bucket${renderLabels(entry.labels, { le: '+Inf' })} ${entry.count}`);
      out.push(`${this.name}_sum${renderLabels(entry.labels)} ${entry.sum}`);
      out.push(`${this.name}_count${renderLabels(entry.labels)} ${entry.count}`);
    }
    return out;
  }
}

export class Registry {
  private readonly metrics: Metric[] = [];

  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.metrics.push(c);
    return c;
  }
  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.metrics.push(g);
    return g;
  }
  histogram(name: string, help: string, buckets?: number[]): Histogram {
    const h = new Histogram(name, help, buckets);
    this.metrics.push(h);
    return h;
  }

  /** Prometheus text exposition (v0.0.4), terminated by a trailing newline. */
  expose(): string {
    return this.metrics.flatMap((m) => m.expose()).join('\n') + '\n';
  }
}
