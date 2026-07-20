import * as fs from 'fs';
import { CONFIG } from './config.js';

export interface Verdict {
    verdict: 'pass' | 'fail';
    summary: string;
}

export function wipeVerdict(): void {
    try { if (fs.existsSync(CONFIG.VERDICT_PATH)) fs.unlinkSync(CONFIG.VERDICT_PATH); }
    catch { /* ignore */ }
}

export function readVerdict(): Verdict | null {
    if (!fs.existsSync(CONFIG.VERDICT_PATH)) return null;
    const raw = fs.readFileSync(CONFIG.VERDICT_PATH, 'utf-8');
    const trimmed = raw.replace(/\r\n/g, '\n').trim();
    if (!trimmed) return null;

    // Preferred format: a JSON object { "verdict": "pass"|"fail", "summary": "..." }.
    try {
        const obj = JSON.parse(trimmed) as { verdict?: unknown; summary?: unknown };
        const verdict = typeof obj.verdict === 'string' ? obj.verdict.trim().toLowerCase() : '';
        if (verdict === 'pass' || verdict === 'fail') {
            const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
            return { verdict, summary };
        }
        // Valid JSON but not a usable verdict shape.
        return null;
    } catch {
        // Not JSON — fall through to the legacy two-line text format.
    }

    // Legacy fallback: first line is `pass`/`fail`, the rest is the summary.
    const firstNewline = trimmed.indexOf('\n');
    const firstLine = (firstNewline === -1 ? trimmed : trimmed.substring(0, firstNewline)).trim().toLowerCase();
    const rest = firstNewline === -1 ? '' : trimmed.substring(firstNewline + 1).trim();
    if (firstLine !== 'pass' && firstLine !== 'fail') return null;
    return { verdict: firstLine, summary: rest };
}