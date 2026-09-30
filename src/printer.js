'use strict';

const { svgUrl } = require('./icons');

const LABEL_MAKER_URL = process.env.LABEL_MAKER_URL || 'http://ui:8000';
const DRY_RUN = process.env.DRY_RUN === '1';
const PRINT_TIMEOUT_MS = 6000; // leaves headroom inside Alexa's ~8 s response window

// Dry-run jobs, kept so tests can assert on exactly what would have printed.
const dryRunJobs = [];

/**
 * Sends a Food label to the label maker's existing /api/print, the same request its
 * web UI makes; layout stays defined in the label maker's labelConfig.js.
 */
async function printLabel(label) {
    const job = {
        primaryText: label.text,
        labelType: 'Food',
        secondaryText: label.secondary || '',
        dateText: label.dateText || '',
        iconUrl: label.iconId ? svgUrl(label.iconId) : '',
        qtyText: String(label.copies || 1),
    };

    if (DRY_RUN) {
        dryRunJobs.push(job);
        console.log('[dry-run] would print', JSON.stringify(job));
        return;
    }

    const res = await fetch(`${LABEL_MAKER_URL}/api/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
        signal: AbortSignal.timeout(PRINT_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`label maker print failed: HTTP ${res.status} ${await res.text()}`);
}

module.exports = { printLabel, dryRunJobs };
