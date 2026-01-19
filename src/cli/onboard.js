/**
 * Professional CLI Onboarding
 * 
 * Cross-platform setup wizard that configures everything needed
 * to run Claude Code with the Antigravity proxy.
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors (cross-platform safe)
const supportsColor = process.stdout.isTTY && (
    process.env.COLORTERM === 'truecolor' ||
    process.env.TERM?.includes('256color') ||
    process.platform === 'win32'
);

const COLORS = {
    reset: supportsColor ? '\x1b[0m' : '',
    bold: supportsColor ? '\x1b[1m' : '',
    dim: supportsColor ? '\x1b[2m' : '',
    red: supportsColor ? '\x1b[31m' : '',
    green: supportsColor ? '\x1b[32m' : '',
    yellow: supportsColor ? '\x1b[33m' : '',
    blue: supportsColor ? '\x1b[34m' : '',
    magenta: supportsColor ? '\x1b[35m' : '',
    cyan: supportsColor ? '\x1b[36m' : '',
    white: supportsColor ? '\x1b[37m' : '',
};

// Platform detection
const PLATFORM = {
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
    homeDir: os.homedir(),
    pathSep: path.sep,
};

// Paths
const CONFIG_DIR = path.join(PLATFORM.homeDir, '.config', 'antigravity-proxy');
const ACCOUNTS_FILE = path.join(CONFIG_DIR, 'accounts.json');
const CLAUDE_CONFIG_DIR = path.join(PLATFORM.homeDir, '.claude');
const CLAUDE_SETTINGS_FILE = path.join(CLAUDE_CONFIG_DIR, 'settings.json');

// All available models in Antigravity (fetched dynamically, but this is a fallback)
const ALL_MODELS = [
    // Claude models
    { id: 'claude-opus-4-5-thinking', family: 'claude', tier: 'opus', description: 'Claude Opus 4.5 with thinking' },
    { id: 'claude-sonnet-4-5-thinking', family: 'claude', tier: 'sonnet', description: 'Claude Sonnet 4.5 with thinking' },
    { id: 'claude-sonnet-4-5', family: 'claude', tier: 'sonnet', description: 'Claude Sonnet 4.5' },
    // Gemini models  
    { id: 'gemini-3-pro-high', family: 'gemini', tier: 'opus', description: 'Gemini 3 Pro High (best quality)' },
    { id: 'gemini-3-pro-low', family: 'gemini', tier: 'sonnet', description: 'Gemini 3 Pro Low' },
    { id: 'gemini-3-flash', family: 'gemini', tier: 'sonnet', description: 'Gemini 3 Flash (fast)' },
    { id: 'gemini-2.5-flash-lite', family: 'gemini', tier: 'haiku', description: 'Gemini 2.5 Flash Lite (fastest)' },
];

// Model tier descriptions
const TIER_INFO = {
    opus: {
        name: 'Opus (Primary)',
        description: 'Main model for complex tasks',
        envKey: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    },
    sonnet: {
        name: 'Sonnet (Default)',
        description: 'Balanced model for most tasks',
        envKey: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    },
    haiku: {
        name: 'Haiku (Fast)',
        description: 'Quick model for simple tasks & background',
        envKey: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    },
};

/**
 * Create readline interface for user input
 */
function createPrompt() {
    return readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
}

/**
 * Prompt user for input
 */
async function prompt(rl, question, defaultValue = '') {
    return new Promise((resolve) => {
        const defaultText = defaultValue ? ` ${COLORS.dim}(${defaultValue})${COLORS.reset}` : '';
        rl.question(`${question}${defaultText}: `, (answer) => {
            resolve(answer.trim() || defaultValue);
        });
    });
}

/**
 * Prompt for yes/no
 */
async function confirm(rl, question, defaultYes = true) {
    const hint = defaultYes ? 'Y/n' : 'y/N';
    const answer = await prompt(rl, `${question} [${hint}]`);
    if (!answer) return defaultYes;
    return answer.toLowerCase().startsWith('y');
}

/**
 * Print styled message
 */
function print(message, type = 'info') {
    const icons = {
        info: `${COLORS.blue}ℹ${COLORS.reset}`,
        success: `${COLORS.green}✓${COLORS.reset}`,
        warn: `${COLORS.yellow}⚠${COLORS.reset}`,
        error: `${COLORS.red}✗${COLORS.reset}`,
        step: `${COLORS.cyan}▸${COLORS.reset}`,
    };
    console.log(`${icons[type] || ''} ${message}`);
}

/**
 * Print header
 */
function printHeader() {
    console.log('');
    console.log(`${COLORS.cyan}╔══════════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}     ${COLORS.bold}Proxy Claude - Setup Wizard${COLORS.reset}                         ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.cyan}║${COLORS.reset}     ${COLORS.dim}Configure everything in one go${COLORS.reset}                      ${COLORS.cyan}║${COLORS.reset}`);
    console.log(`${COLORS.cyan}╚══════════════════════════════════════════════════════════╝${COLORS.reset}`);
    console.log('');
}

/**
 * Print step header
 */
function printStep(step, total, title) {
    console.log('');
    console.log(`${COLORS.bold}${COLORS.blue}[${step}/${total}]${COLORS.reset} ${COLORS.bold}${title}${COLORS.reset}`);
    console.log(`${COLORS.dim}${'─'.repeat(50)}${COLORS.reset}`);
}

/**
 * Check if a command exists
 */
function commandExists(cmd) {
    try {
        const checkCmd = PLATFORM.isWindows ? `where ${cmd}` : `which ${cmd}`;
        execSync(checkCmd, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Check Node.js version
 */
function checkNodeVersion() {
    const version = process.version;
    const major = parseInt(version.slice(1).split('.')[0], 10);
    return { version, major, ok: major >= 18 };
}

/**
 * Check if Claude Code CLI is installed
 */
function checkClaudeCli() {
    return commandExists('claude');
}

/**
 * Install Claude Code CLI
 */
async function installClaudeCli() {
    print('Installing Claude Code CLI...', 'step');
    try {
        execSync('npm install -g @anthropic-ai/claude-code', { 
            stdio: 'inherit',
            shell: true 
        });
        print('Claude Code CLI installed successfully', 'success');
        return true;
    } catch (error) {
        print(`Failed to install Claude Code CLI: ${error.message}`, 'error');
        print('Please install manually: npm install -g @anthropic-ai/claude-code', 'info');
        return false;
    }
}

/**
 * Check for existing accounts
 */
function getExistingAccounts() {
    try {
        if (fs.existsSync(ACCOUNTS_FILE)) {
            const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8'));
            return data.accounts || [];
        }
    } catch {}
    return [];
}

/**
 * Fetch available models from the API using account token
 */
async function fetchAvailableModels(accounts) {
    if (!accounts || accounts.length === 0) {
        return ALL_MODELS;
    }
    
    try {
        // Get token from first account
        const account = accounts[0];
        const token = account.accessToken;
        
        if (!token) {
            return ALL_MODELS;
        }
        
        // Import the model API
        const { fetchAvailableModels: fetchModels } = await import('../cloudcode/model-api.js');
        const data = await fetchModels(token);
        
        if (data && data.models) {
            const models = [];
            for (const [modelId, modelData] of Object.entries(data.models)) {
                // Only include Claude and Gemini models
                if (!modelId.includes('claude') && !modelId.includes('gemini')) continue;
                
                // Determine family
                const family = modelId.includes('claude') ? 'claude' : 'gemini';
                
                // Determine tier based on model name
                let tier = 'sonnet';
                if (modelId.includes('opus') || modelId.includes('pro-high')) tier = 'opus';
                else if (modelId.includes('haiku') || modelId.includes('flash-lite')) tier = 'haiku';
                
                // Check if model has quota (remaining > 0)
                const hasQuota = modelData.remainingFraction === undefined || modelData.remainingFraction > 0;
                
                models.push({
                    id: modelId,
                    family,
                    tier,
                    description: modelData.displayName || modelId,
                    hasQuota,
                    remainingFraction: modelData.remainingFraction,
                });
            }
            
            if (models.length > 0) {
                return models;
            }
        }
    } catch (error) {
        print(`Could not fetch models from API: ${error.message}`, 'warn');
    }
    
    return ALL_MODELS;
}

/**
 * Add Google account via OAuth
 */
async function addGoogleAccount() {
    print('Starting Google OAuth flow...', 'step');
    print('A browser window will open for authentication.', 'info');
    console.log('');
    
    return new Promise((resolve) => {
        const accountsScript = path.join(__dirname, 'accounts.js');
        const child = spawn('node', [accountsScript, 'add'], {
            stdio: 'inherit',
            shell: true,
        });
        
        child.on('close', (code) => {
            resolve(code === 0);
        });
    });
}

/**
 * Load existing Claude settings
 */
function loadClaudeSettings() {
    try {
        if (fs.existsSync(CLAUDE_SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_FILE, 'utf-8'));
        }
    } catch {}
    return {};
}

/**
 * Save Claude settings
 */
function saveClaudeSettings(settings) {
    // Ensure directory exists
    if (!fs.existsSync(CLAUDE_CONFIG_DIR)) {
        fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CLAUDE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/**
 * Select a model for a specific tier
 */
async function selectModelForTier(rl, tier, availableModels) {
    const tierInfo = TIER_INFO[tier];
    console.log('');
    console.log(`${COLORS.bold}${tierInfo.name}${COLORS.reset} - ${COLORS.dim}${tierInfo.description}${COLORS.reset}`);
    console.log('');
    
    // Filter models that are suitable for this tier or higher
    // opus can use any model, sonnet can use sonnet/haiku, haiku uses haiku
    const tierPriority = { opus: 3, sonnet: 2, haiku: 1 };
    const minTier = tierPriority[tier];
    
    const suitableModels = availableModels.filter(m => {
        const modelTier = tierPriority[m.tier] || 2;
        return modelTier >= minTier - 1; // Allow one tier lower
    });
    
    // Sort: models with quota first, then by family (claude first), then by tier
    suitableModels.sort((a, b) => {
        // Quota status
        if (a.hasQuota !== b.hasQuota) return a.hasQuota ? -1 : 1;
        // Family (claude first for opus/sonnet, gemini first for haiku)
        if (tier === 'haiku') {
            if (a.family !== b.family) return a.family === 'gemini' ? -1 : 1;
        } else {
            if (a.family !== b.family) return a.family === 'claude' ? -1 : 1;
        }
        // Tier priority
        return (tierPriority[b.tier] || 0) - (tierPriority[a.tier] || 0);
    });
    
    // Display models
    console.log(`${COLORS.dim}Available models:${COLORS.reset}`);
    suitableModels.forEach((model, index) => {
        const quotaStatus = model.hasQuota === false 
            ? `${COLORS.red}(no quota)${COLORS.reset}` 
            : model.remainingFraction !== undefined 
                ? `${COLORS.green}(${Math.round(model.remainingFraction * 100)}% quota)${COLORS.reset}`
                : '';
        const familyBadge = model.family === 'claude' 
            ? `${COLORS.magenta}[Claude]${COLORS.reset}` 
            : `${COLORS.blue}[Gemini]${COLORS.reset}`;
        console.log(`  ${COLORS.cyan}${index + 1}.${COLORS.reset} ${model.id} ${familyBadge} ${quotaStatus}`);
    });
    console.log('');
    
    // Default to first model with quota
    const defaultIndex = suitableModels.findIndex(m => m.hasQuota !== false) + 1 || 1;
    
    const choice = await prompt(rl, `Select model for ${tier} (1-${suitableModels.length})`, String(defaultIndex));
    const index = parseInt(choice, 10) - 1;
    
    if (index >= 0 && index < suitableModels.length) {
        return suitableModels[index].id;
    }
    return suitableModels[0]?.id || ALL_MODELS.find(m => m.tier === tier)?.id;
}

/**
 * Configure Claude Code settings with selected models
 */
function configureClaudeSettingsWithModels(modelConfig, port = 8080) {
    const existing = loadClaudeSettings();
    
    const newSettings = {
        ...existing,
        env: {
            ...(existing.env || {}),
            ANTHROPIC_AUTH_TOKEN: 'proxy-claude',
            ANTHROPIC_BASE_URL: `http://localhost:${port}`,
            ANTHROPIC_MODEL: modelConfig.sonnet, // Default model is sonnet
            ANTHROPIC_DEFAULT_OPUS_MODEL: modelConfig.opus,
            ANTHROPIC_DEFAULT_SONNET_MODEL: modelConfig.sonnet,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: modelConfig.haiku,
            CLAUDE_CODE_SUBAGENT_MODEL: modelConfig.haiku, // Subagent uses haiku for efficiency
            ENABLE_EXPERIMENTAL_MCP_CLI: 'true',
        }
    };
    
    // Also set hasCompletedOnboarding to skip Claude's own onboarding
    if (!existing.hasCompletedOnboarding) {
        newSettings.hasCompletedOnboarding = true;
    }
    
    saveClaudeSettings(newSettings);
    return newSettings;
}

/**
 * Print summary with selected models
 */
function printSummary(accounts, modelConfig, port) {
    console.log('');
    console.log(`${COLORS.green}╔══════════════════════════════════════════════════════════╗${COLORS.reset}`);
    console.log(`${COLORS.green}║${COLORS.reset}     ${COLORS.bold}${COLORS.green}Setup Complete!${COLORS.reset}                                   ${COLORS.green}║${COLORS.reset}`);
    console.log(`${COLORS.green}╚══════════════════════════════════════════════════════════╝${COLORS.reset}`);
    console.log('');
    
    console.log(`${COLORS.bold}Configuration Summary:${COLORS.reset}`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Accounts: ${accounts.length} configured`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Opus model: ${COLORS.cyan}${modelConfig.opus}${COLORS.reset}`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Sonnet model: ${COLORS.cyan}${modelConfig.sonnet}${COLORS.reset}`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Haiku model: ${COLORS.cyan}${modelConfig.haiku}${COLORS.reset}`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Proxy port: ${port}`);
    console.log(`  ${COLORS.dim}•${COLORS.reset} Settings saved to: ${CLAUDE_SETTINGS_FILE}`);
    console.log('');
    
    console.log(`${COLORS.bold}To start using Claude with the proxy:${COLORS.reset}`);
    console.log('');
    console.log(`  ${COLORS.cyan}proxy-claude${COLORS.reset}`);
    console.log('');
    console.log(`${COLORS.dim}Or start components separately:${COLORS.reset}`);
    console.log(`  ${COLORS.dim}proxy-claude start${COLORS.reset}  - Start proxy server only`);
    console.log(`  ${COLORS.dim}proxy-claude web${COLORS.reset}    - Start with web dashboard`);
    console.log('');
}

/**
 * Main onboarding flow
 */
export async function runOnboarding(options = {}) {
    const { skipIfConfigured = false, quiet = false } = options;
    
    // Check if already configured
    const existingAccounts = getExistingAccounts();
    const existingSettings = loadClaudeSettings();
    const isConfigured = existingAccounts.length > 0 && existingSettings.env?.ANTHROPIC_BASE_URL;
    
    if (skipIfConfigured && isConfigured) {
        if (!quiet) {
            print('Already configured. Use --force to reconfigure.', 'info');
        }
        return true;
    }
    
    printHeader();
    
    const rl = createPrompt();
    const totalSteps = 4;
    let currentStep = 0;
    
    try {
        // Step 1: Check prerequisites
        printStep(++currentStep, totalSteps, 'Checking Prerequisites');
        
        // Check Node.js
        const nodeCheck = checkNodeVersion();
        if (nodeCheck.ok) {
            print(`Node.js ${nodeCheck.version} ✓`, 'success');
        } else {
            print(`Node.js ${nodeCheck.version} - version 18+ required`, 'error');
            rl.close();
            return false;
        }
        
        // Check/Install Claude CLI
        if (checkClaudeCli()) {
            print('Claude Code CLI ✓', 'success');
        } else {
            print('Claude Code CLI not found', 'warn');
            const install = await confirm(rl, 'Install Claude Code CLI now?');
            if (install) {
                const installed = await installClaudeCli();
                if (!installed) {
                    rl.close();
                    return false;
                }
            } else {
                print('Claude Code CLI is required. Please install it first.', 'error');
                rl.close();
                return false;
            }
        }
        
        // Step 2: Account Setup
        printStep(++currentStep, totalSteps, 'Account Configuration');
        
        if (existingAccounts.length > 0) {
            print(`Found ${existingAccounts.length} existing account(s):`, 'info');
            existingAccounts.forEach((acc, i) => {
                console.log(`  ${COLORS.dim}${i + 1}.${COLORS.reset} ${acc.email}`);
            });
            
            const addMore = await confirm(rl, 'Add another account?', false);
            if (addMore) {
                await addGoogleAccount();
            }
        } else {
            print('No accounts configured yet.', 'info');
            const addAccount = await confirm(rl, 'Add a Google account now?');
            if (addAccount) {
                await addGoogleAccount();
            } else {
                print('You can add accounts later with: proxy-claude accounts add', 'info');
            }
        }
        
        // Reload accounts after potential additions
        const accounts = getExistingAccounts();
        
        // Step 3: Model Configuration
        printStep(++currentStep, totalSteps, 'Model Configuration');
        
        print('Fetching available models from your account...', 'step');
        const availableModels = await fetchAvailableModels(accounts);
        print(`Found ${availableModels.length} models available`, 'success');
        
        console.log('');
        print('Now select a model for each tier. Models with quota are shown first.', 'info');
        print(`${COLORS.dim}Tip: Use Gemini for Haiku to save your Claude quota!${COLORS.reset}`, 'info');
        
        // Select model for each tier
        const modelConfig = {
            opus: await selectModelForTier(rl, 'opus', availableModels),
            sonnet: await selectModelForTier(rl, 'sonnet', availableModels),
            haiku: await selectModelForTier(rl, 'haiku', availableModels),
        };
        
        console.log('');
        print('Model configuration:', 'success');
        console.log(`  ${COLORS.dim}Opus:${COLORS.reset}   ${COLORS.cyan}${modelConfig.opus}${COLORS.reset}`);
        console.log(`  ${COLORS.dim}Sonnet:${COLORS.reset} ${COLORS.cyan}${modelConfig.sonnet}${COLORS.reset}`);
        console.log(`  ${COLORS.dim}Haiku:${COLORS.reset}  ${COLORS.cyan}${modelConfig.haiku}${COLORS.reset}`);
        
        // Step 4: Apply Configuration
        printStep(++currentStep, totalSteps, 'Applying Configuration');
        
        const port = parseInt(process.env.PORT || '8080', 10);
        
        // Configure Claude Code settings
        print('Configuring Claude Code settings...', 'step');
        configureClaudeSettingsWithModels(modelConfig, port);
        print(`Settings saved to ${CLAUDE_SETTINGS_FILE}`, 'success');
        
        // Print summary
        printSummary(accounts, modelConfig, port);
        
        rl.close();
        return true;
        
    } catch (error) {
        print(`Setup error: ${error.message}`, 'error');
        rl.close();
        return false;
    }
}

/**
 * Check if first run (no config exists)
 */
export function isFirstRun() {
    const accounts = getExistingAccounts();
    const settings = loadClaudeSettings();
    return accounts.length === 0 || !settings.env?.ANTHROPIC_BASE_URL;
}

// CLI entry point
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const force = process.argv.includes('--force') || process.argv.includes('-f');
    runOnboarding({ skipIfConfigured: !force }).then((success) => {
        process.exit(success ? 0 : 1);
    });
}
