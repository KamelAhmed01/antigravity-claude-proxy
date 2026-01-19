#!/usr/bin/env node

/**
 * Token Refresh CLI
 *
 * Checks and refreshes OAuth tokens for all configured accounts.
 * Can be run manually or scheduled as a cron job.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { ACCOUNT_CONFIG_PATH } from '../constants.js';
import { refreshAccessToken } from '../auth/oauth.js';
import { logger } from '../utils/logger.js';

const COLORS = {
    RESET: '\x1b[0m',
    GREEN: '\x1b[32m',
    RED: '\x1b[31m',
    YELLOW: '\x1b[33m',
    BLUE: '\x1b[34m',
    CYAN: '\x1b[36m'
};

/**
 * Load accounts from config file
 */
function loadAccounts() {
    if (!existsSync(ACCOUNT_CONFIG_PATH)) {
        return null;
    }
    try {
        const data = readFileSync(ACCOUNT_CONFIG_PATH, 'utf-8');
        return JSON.parse(data);
    } catch (err) {
        return null;
    }
}

/**
 * Save accounts to config file
 */
function saveAccounts(config) {
    writeFileSync(ACCOUNT_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * Check if a token needs refresh (expires within threshold)
 * @param {object} account - Account object
 * @param {number} thresholdMs - Refresh if expiring within this time (default: 5 minutes)
 */
function needsRefresh(account, thresholdMs = 5 * 60 * 1000) {
    if (!account.tokenExpiresAt) {
        // No expiry info, assume it needs refresh
        return true;
    }
    const expiresAt = new Date(account.tokenExpiresAt).getTime();
    const now = Date.now();
    return (expiresAt - now) < thresholdMs;
}

/**
 * Refresh a single account's token
 */
async function refreshAccount(account) {
    if (!account.refreshToken) {
        return {
            success: false,
            error: 'No refresh token available'
        };
    }

    try {
        const result = await refreshAccessToken(account.refreshToken);
        return {
            success: true,
            accessToken: result.accessToken,
            expiresIn: result.expiresIn
        };
    } catch (err) {
        return {
            success: false,
            error: err.message
        };
    }
}

/**
 * Main refresh function
 */
export async function runRefresh(options = {}) {
    const { force = false, quiet = false } = options;

    const log = quiet ? () => {} : console.log;

    log(`${COLORS.BLUE}╔════════════════════════════════════════╗${COLORS.RESET}`);
    log(`${COLORS.BLUE}║   Antigravity Proxy Token Refresh      ║${COLORS.RESET}`);
    log(`${COLORS.BLUE}╚════════════════════════════════════════╝${COLORS.RESET}`);
    log('');

    const config = loadAccounts();
    
    if (!config || !config.accounts || config.accounts.length === 0) {
        log(`${COLORS.YELLOW}No accounts configured.${COLORS.RESET}`);
        log(`Run 'proxy-claude accounts add' to add an account.`);
        return { refreshed: 0, failed: 0, skipped: 0 };
    }

    const accounts = config.accounts;
    let refreshed = 0;
    let failed = 0;
    let skipped = 0;
    const invalidAccounts = [];

    log(`Found ${accounts.length} account(s). Checking tokens...\n`);

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const email = account.email || `Account ${i + 1}`;

        process.stdout.write(`  ${email}: `);

        // Check if refresh is needed
        if (!force && !needsRefresh(account)) {
            const expiresIn = account.tokenExpiresAt 
                ? Math.round((new Date(account.tokenExpiresAt).getTime() - Date.now()) / 60000)
                : '?';
            log(`${COLORS.GREEN}✓ Valid (expires in ${expiresIn} min)${COLORS.RESET}`);
            skipped++;
            continue;
        }

        // Attempt refresh
        const result = await refreshAccount(account);

        if (result.success) {
            // Update account with new token
            accounts[i].accessToken = result.accessToken;
            accounts[i].tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000).toISOString();
            accounts[i].isInvalid = false;
            accounts[i].invalidReason = null;
            
            log(`${COLORS.GREEN}✓ Refreshed (expires in ${Math.round(result.expiresIn / 60)} min)${COLORS.RESET}`);
            refreshed++;
        } else {
            log(`${COLORS.RED}✗ Failed: ${result.error}${COLORS.RESET}`);
            
            // Mark as invalid if refresh token is bad
            if (result.error.includes('invalid_grant') || result.error.includes('Bad Request')) {
                accounts[i].isInvalid = true;
                accounts[i].invalidReason = 'Refresh token expired or revoked';
                invalidAccounts.push(email);
            }
            failed++;
        }
    }

    // Save updated config
    config.accounts = accounts;
    saveAccounts(config);

    log('');
    log(`${COLORS.CYAN}Summary:${COLORS.RESET}`);
    log(`  Refreshed: ${COLORS.GREEN}${refreshed}${COLORS.RESET}`);
    log(`  Skipped:   ${COLORS.BLUE}${skipped}${COLORS.RESET} (still valid)`);
    log(`  Failed:    ${COLORS.RED}${failed}${COLORS.RESET}`);

    if (invalidAccounts.length > 0) {
        log('');
        log(`${COLORS.RED}⚠ The following accounts need to be re-added:${COLORS.RESET}`);
        invalidAccounts.forEach(email => {
            log(`  - ${email}`);
        });
        log('');
        log(`Run 'proxy-claude accounts add' to re-authenticate.`);
    }

    return { refreshed, failed, skipped, invalidAccounts };
}

// Run if called directly
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: proxy-claude refresh [options]

Options:
  --force, -f    Force refresh all tokens, even if not expired
  --quiet, -q    Suppress output (for cron jobs)
  --help, -h     Show this help
`);
    process.exit(0);
}

const force = args.includes('--force') || args.includes('-f');
const quiet = args.includes('--quiet') || args.includes('-q');

runRefresh({ force, quiet }).then(result => {
    if (result.failed > 0) {
        process.exit(1);
    }
});
