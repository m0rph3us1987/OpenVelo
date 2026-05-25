import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Job } from './types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalizes and parses a date string from SQLite.
 * SQLite's CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:mm:ss" in UTC, 
 * but JS parses it as local time if the 'Z' or 'T' is missing.
 */
export function parseSqliteDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  let normalized = dateStr;
  if (!normalized.includes('T') && !normalized.includes('Z')) {
    normalized = normalized.replace(' ', 'T') + 'Z';
  }
  return new Date(normalized);
}

/**
 * Parse depends_on from the DB — stored as a JSON array string e.g. '["123","456"]'.
 * Falls back gracefully for legacy plain-string values.
 */
export function parsePredecessorIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [String(parsed)];
  } catch {
    return [raw];
  }
}

/**
 * Topological sort of jobs by depends_on → id dependency edges.
 * Jobs with no predecessor (or whose predecessor isn't in this set) come first.
 * Dependents always appear below every job they depend on.
 * Cycles are broken by insertion order (remaining nodes appended at end).
 */
export function topoSortJobs(jobs: Job[]): Job[] {
  const byJobId = new Map<string, Job>(jobs.map((j) => [String(j.id), j]));

  // Count how many unresolved predecessors each job has (only within this set)
  const inDegree = new Map<string, number>();
  const successors = new Map<string, string[]>(); // job id → list of dependent job ids

  for (const job of jobs) {
    const jobId = String(job.id);
    if (!inDegree.has(jobId)) inDegree.set(jobId, 0);
    if (!successors.has(jobId)) successors.set(jobId, []);
  }

  for (const job of jobs) {
    const jobId = String(job.id);
    const preds: string[] = parsePredecessorIds(job.depends_on);
    for (const predId of preds) {
      if (byJobId.has(predId)) {
        inDegree.set(jobId, (inDegree.get(jobId) ?? 0) + 1);
        successors.get(predId)?.push(jobId);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [jobId, degree] of inDegree) {
    if (degree === 0) queue.push(jobId);
  }

  const sorted: Job[] = [];
  while (queue.length > 0) {
    const jobId = queue.shift()!;
    const job = byJobId.get(jobId);
    if (job) sorted.push(job);
    for (const dep of successors.get(jobId) ?? []) {
      const newDegree = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, newDegree);
      if (newDegree === 0) queue.push(dep);
    }
  }

  // Append any remaining (cycle members) in original order
  const sortedIds = new Set(sorted.map((j) => String(j.id)));
  for (const job of jobs) {
    if (!sortedIds.has(String(job.id))) sorted.push(job);
  }

  return sorted;
}
