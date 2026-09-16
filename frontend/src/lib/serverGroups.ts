import { Server } from '../types';

/**
 * How to pile a server estate into something you can read.
 *
 * Grouping by environment was the first instinct and it is the wrong one. A
 * bank's DC block ends up holding every unrelated box in the building, sorted
 * alphabetically, so ATM, Bakong, MBS and the load balancer interleave - and
 * MBS-APP-01 lands several screens away from MBS-APP-01-DR, which is the one
 * server you actually want beside it during a failover.
 *
 * Grouping by service puts the nodes of one application together and turns the
 * environment into a badge, which is what it always was: an attribute of the
 * node, not a category of work.
 */

export type GroupBy = 'service' | 'environment' | 'role';

export const ENV_ORDER = ['DC', 'DR', 'UAT', 'SIT', 'DEV', 'OTHER'];

export interface ServerGroup {
  key: string;
  label: string;
  /** Set when the label came from the role because no system was assigned. */
  derived?: boolean;
  items: Server[];
  /** Node count per environment, in ENV_ORDER, for the header summary. */
  envCounts: { env: string; count: number }[];
}

const UNASSIGNED = 'Not assigned to a service';

/**
 * The role, as a grouping key.
 *
 * A DR node's role is almost always the DC one with a qualifier bolted on -
 * "IBM MQ 9.3" and "IBM MQ 9.3 (standby)". Treating those as two services
 * splits exactly the pair that most needs to be side by side, so the trailing
 * parenthetical is dropped for grouping and kept for display.
 */
export function roleKey(role: string): string {
  return role.replace(/\s*\([^)]*\)\s*$/, '').trim() || role.trim();
}

function envRank(env: string): number {
  const i = ENV_ORDER.indexOf(env);
  return i === -1 ? ENV_ORDER.length : i;
}

/** DC before DR before the test environments, then by name. */
export function byEnvThenName(a: Server, b: Server): number {
  const d = envRank(a.environment) - envRank(b.environment);
  return d !== 0 ? d : a.name.localeCompare(b.name, undefined, { numeric: true });
}

function keyFor(server: Server, mode: GroupBy, systemName: (id?: number | null) => string) {
  if (mode === 'environment') return { label: server.environment || 'OTHER' };
  if (mode === 'role') return { label: roleKey(server.role || '') || 'No role recorded' };

  const system = systemName(server.system_id);
  if (system && system !== '—') return { label: system };
  // Falling back to the role means the page is useful before anyone has
  // backfilled the Systems directory - which is the state it will be in for
  // weeks, and an empty grouping is worse than an approximate one.
  const role = roleKey(server.role || '');
  if (role) return { label: role, derived: true };
  return { label: UNASSIGNED, derived: true };
}

export function groupServers(
  servers: Server[],
  mode: GroupBy,
  systemName: (id?: number | null) => string,
): ServerGroup[] {
  const buckets = new Map<string, ServerGroup>();

  for (const s of servers) {
    const { label, derived } = keyFor(s, mode, systemName);
    let g = buckets.get(label);
    if (!g) {
      g = { key: label, label, derived, items: [], envCounts: [] };
      buckets.set(label, g);
    }
    // A group is only "derived" if every server in it was guessed at.
    if (!derived) g.derived = false;
    g.items.push(s);
  }

  const groups = [...buckets.values()];
  for (const g of groups) {
    g.items.sort(byEnvThenName);
    const counts = new Map<string, number>();
    for (const s of g.items) counts.set(s.environment, (counts.get(s.environment) ?? 0) + 1);
    g.envCounts = ENV_ORDER
      .filter((e) => counts.has(e))
      .map((env) => ({ env, count: counts.get(env)! }));
  }

  if (mode === 'environment') {
    groups.sort((a, b) => envRank(a.label) - envRank(b.label));
  } else {
    // Biggest service first - it is the one with the most to go wrong - and
    // the unassigned bucket last whatever its size, since it is a to-do list
    // rather than a service.
    groups.sort((a, b) => {
      const au = a.label === UNASSIGNED ? 1 : 0;
      const bu = b.label === UNASSIGNED ? 1 : 0;
      if (au !== bu) return au - bu;
      return b.items.length - a.items.length || a.label.localeCompare(b.label);
    });
  }
  return groups;
}

/** Colour for an environment badge. DR has to be distinguishable at a glance. */
export function envTone(env: string): string {
  switch (env) {
    case 'DC': return 'bg-blue-50 text-blue-700 ring-blue-200';
    case 'DR': return 'bg-violet-50 text-violet-700 ring-violet-200';
    case 'UAT': return 'bg-amber-50 text-amber-700 ring-amber-200';
    case 'SIT': return 'bg-teal-50 text-teal-700 ring-teal-200';
    case 'DEV': return 'bg-slate-100 text-slate-600 ring-slate-200';
    default: return 'bg-slate-100 text-slate-600 ring-slate-200';
  }
}
