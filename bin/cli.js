#!/usr/bin/env node

/**
 * Proxy Claude CLI
 * 
 * Cross-platform CLI tool for running Claude Code with Antigravity proxy.
 * Works on Windows, macOS, and Linux.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import os from 'os';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Platform detection
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = os.homedir();

// Config paths
const CONFIG_DIR = join(HOME_DIR, '.config', 'antigravity-proxy');
const ACCOUNTS_FILE = join(CONFIG_DIR, 'accounts.json');
const CLAUDE_SETTINGS = join(HOME_DIR, '.claude', 'settings.json');

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const args = process.argv.slice(2);
const command = args[0];

// Colors (cross-platform)
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

/**
 * Check if first run (no accounts or settings configured)
 */
function isFirstRun() {
  try {
    if (!existsSync(ACCOUNTS_FILE)) return true;
    const accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
    if (!accounts.accounts || accounts.accounts.length === 0) return true;
    
    if (!existsSync(CLAUDE_SETTINGS)) return true;
    const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS, 'utf-8'));
    if (!settings.env?.ANTHROPIC_BASE_URL) return true;
    
    return false;
  } catch {
    return true;
  }
}

/**
 * Check if command exists (cross-platform)
 */
function commandExists(cmd) {
  try {
    const checkCmd = IS_WINDOWS ? `where ${cmd}` : `which ${cmd}`;
    execSync(checkCmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if port is in use using Node.js (cross-platform)
 */
function checkPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      resolve(true);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for proxy to be ready
 */
async function waitForProxy(port, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkPort(port)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Stop proxy server (cross-platform)
 */
async function stopProxy(port) {
  if (IS_WINDOWS) {
    try {
      // Find PID using netstat on Windows
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      const lines = output.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') {
          try {
            execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
          } catch {}
        }
      }
      return true;
    } catch {
      return false;
    }
  } else {
    try {
      execSync(`lsof -ti tcp:${port} | xargs kill 2>/dev/null`, { 
        stdio: 'ignore',
        shell: true 
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get port from args or env
 */
function getPort() {
  const portIndex = args.findIndex(a => a === '--port' || a === '-p');
  if (portIndex !== -1 && args[portIndex + 1]) {
    return parseInt(args[portIndex + 1], 10);
  }
  return parseInt(process.env.PORT || '8080', 10);
}

function showHelp() {
  console.log(`
${C.cyan}proxy-claude${C.reset} v${packageJson.version}

Proxy server for using Antigravity's Claude models with Claude Code CLI.

${C.bold}USAGE:${C.reset}
  proxy-claude [command] [options]

${C.bold}COMMANDS:${C.reset}
  ${C.cyan}(default)${C.reset}             Start proxy + launch Claude Code
  ${C.cyan}init${C.reset}                  Run setup wizard (configure models & accounts)
  ${C.cyan}start${C.reset}                 Start the proxy server only
  ${C.cyan}stop${C.reset}                  Stop running proxy server
  ${C.cyan}status${C.reset}                Check if proxy is running
  ${C.cyan}accounts${C.reset}              Manage Google accounts (add/list/remove/verify)
  ${C.cyan}refresh${C.reset}               Check and refresh account tokens

${C.bold}OPTIONS:${C.reset}
  --help, -h            Show this help message
  --version, -v         Show version number
  --port, -p <port>     Set custom port (default: 8080)
  --force               Force reconfigure (with init)

${C.bold}ENVIRONMENT:${C.reset}
  PORT                  Server port (default: 8080)

${C.bold}EXAMPLES:${C.reset}
  proxy-claude                    # Start proxy + Claude Code
  proxy-claude init               # Run setup wizard
  proxy-claude start              # Start proxy server only
  proxy-claude stop               # Stop proxy server
  PORT=3000 proxy-claude          # Use custom port
  proxy-claude accounts add       # Add Google account

${C.bold}FIRST TIME?${C.reset}
  Run ${C.cyan}proxy-claude init${C.reset} to configure everything.
`);
}

function showVersion() {
  console.log(packageJson.version);
}

/**
 * Main CLI handler
 */
async function main() {
  // Handle flags
  if (args.includes('--help') || args.includes('-h')) {
    showHelp();
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    showVersion();
    process.exit(0);
  }

  const port = getPort();

  // Handle commands
  switch (command) {
    case 'init':
    case 'setup': {
      // Run onboarding wizard
      const force = args.includes('--force') || args.includes('-f');
      const { runOnboarding } = await import('../src/cli/onboard.js');
      const success = await runOnboarding({ skipIfConfigured: !force });
      process.exit(success ? 0 : 1);
      break;
    }

    case 'start':
    case 'web': {
      // Start the server only
      await import('../src/index.js');
      break;
    }

    case 'stop': {
      // Stop running proxy
      console.log(`${C.yellow}Stopping proxy on port ${port}...${C.reset}`);
      const stopped = await stopProxy(port);
      if (stopped) {
        console.log(`${C.green}✓ Proxy stopped${C.reset}`);
      } else {
        console.log(`${C.dim}No proxy found running on port ${port}${C.reset}`);
      }
      break;
    }

    case 'status': {
      // Check if proxy is running
      const running = await checkPort(port);
      if (running) {
        console.log(`${C.green}✓ Proxy is running on port ${port}${C.reset}`);
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          const data = await res.json();
          console.log(`  ${C.dim}Status: ${data.summary}${C.reset}`);
        } catch {}
      } else {
        console.log(`${C.yellow}✗ Proxy is not running on port ${port}${C.reset}`);
      }
      break;
    }

    case 'accounts': {
      // Pass remaining args to accounts CLI
      const subCommand = args[1] || 'add';
      process.argv = ['node', 'accounts-cli.js', subCommand, ...args.slice(2)];
      await import('../src/cli/accounts.js');
      break;
    }

    case 'refresh': {
      // Token refresh
      const force = args.includes('--force') || args.includes('-f');
      const quiet = args.includes('--quiet') || args.includes('-q');
      const { runRefresh } = await import('../src/cli/refresh.js');
      await runRefresh({ force, quiet });
      break;
    }

    case 'help':
      showHelp();
      break;

    case 'version':
      showVersion();
      break;

    case undefined:
    case 'run': {
      // Check if first run - prompt for setup
      if (isFirstRun()) {
        console.log(`${C.cyan}Welcome to Proxy Claude!${C.reset}`);
        console.log(`${C.dim}It looks like this is your first time running.${C.reset}`);
        console.log('');
        console.log(`Running setup wizard...`);
        console.log('');
        
        const { runOnboarding } = await import('../src/cli/onboard.js');
        const success = await runOnboarding();
        if (!success) {
          process.exit(1);
        }
        console.log('');
      }

      // Default: Start proxy in background + launch Claude Code
      console.log(`${C.blue}Starting Antigravity Claude Proxy on port ${port}...${C.reset}`);
      
      // Check if already running
      if (await checkPort(port)) {
        console.log(`${C.green}✓ Proxy already running on port ${port}${C.reset}`);
      } else {
        // Start proxy in background
        const proxyScript = join(__dirname, '..', 'src', 'index.js');
        const proxyProcess = spawn(process.execPath, [proxyScript], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, PORT: String(port) },
          shell: false,
          windowsHide: true,
        });
        proxyProcess.unref();
        
        // Wait for proxy to be ready
        console.log('Waiting for proxy to be ready...');
        const ready = await waitForProxy(port);
        
        if (!ready) {
          console.error(`${C.red}Error: Proxy failed to start within 30 seconds.${C.reset}`);
          process.exit(1);
        }
        
        console.log(`${C.green}✓ Proxy is ready on port ${port}!${C.reset}`);
      }
      console.log('');
      
      // Check if claude is installed
      if (!commandExists('claude')) {
        console.error(`${C.red}Error: Claude Code CLI not found.${C.reset}`);
        console.error('Install it with: npm install -g @anthropic-ai/claude-code');
        console.error('Or run: proxy-claude init');
        process.exit(1);
      }
      
      // Launch Claude with proxy config
      const claudeArgs = args.slice(command === 'run' ? 1 : 0).filter(a => 
        a !== '--port' && a !== '-p' && !args[args.indexOf('--port') + 1]?.includes(a)
      );
      
      const claudeProcess = spawn('claude', claudeArgs, {
        stdio: 'inherit',
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: `http://localhost:${port}`,
          ANTHROPIC_API_KEY: 'proxy-claude',
        },
        shell: IS_WINDOWS,
      });
      
      // Cleanup on exit
      const cleanup = async () => {
        console.log(`\n${C.yellow}Stopping Antigravity Claude Proxy...${C.reset}`);
        await stopProxy(port);
        console.log(`${C.green}✓ Proxy stopped${C.reset}`);
      };
      
      claudeProcess.on('close', async (code) => {
        await cleanup();
        process.exit(code || 0);
      });
      
      // Handle signals
      const handleSignal = (signal) => {
        claudeProcess.kill(signal);
      };
      
      process.on('SIGINT', () => handleSignal('SIGINT'));
      process.on('SIGTERM', () => handleSignal('SIGTERM'));
      
      // Windows-specific handling
      if (IS_WINDOWS) {
        process.on('SIGHUP', () => handleSignal('SIGHUP'));
      }
      break;
    }

    default:
      console.error(`${C.red}Unknown command: ${command}${C.reset}`);
      console.error('Run "proxy-claude --help" for usage information.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`${C.red}Error:${C.reset}`, err.message);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
