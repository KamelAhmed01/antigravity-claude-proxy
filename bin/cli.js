#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read package.json for version
const packageJson = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf-8')
);

const args = process.argv.slice(2);
const command = args[0];

function showHelp() {
  console.log(`
proxy-claude v${packageJson.version}

Proxy server for using Antigravity's Claude models with Claude Code CLI.

USAGE:
  proxy-claude [command] [options]

COMMANDS:
  (default)             Start proxy + launch Claude Code (interactive)
  run                   Same as default - start proxy + Claude Code
  start                 Start the proxy server only (foreground)
  web                   Same as start - server with web dashboard
  accounts              Manage Google accounts (interactive)
  accounts add          Add a new Google account via OAuth
  accounts list         List all configured accounts
  accounts remove       Remove accounts interactively
  accounts verify       Verify account tokens are valid
  accounts clear        Remove all accounts
  refresh               Check and refresh account tokens
  setup                 Install Claude Code CLI (if needed)

OPTIONS:
  --help, -h            Show this help message
  --version, -v         Show version number

ENVIRONMENT:
  PORT                  Server port (default: 8080)

EXAMPLES:
  proxy-claude                    # Start proxy + Claude Code
  proxy-claude run                # Same as above
  proxy-claude start              # Start proxy server only
  PORT=3000 proxy-claude          # Use custom port
  proxy-claude accounts add       # Add Google account

CONFIGURATION:
  Claude Code CLI (~/.claude/settings.json):
    {
      "env": {
        "ANTHROPIC_BASE_URL": "http://localhost:8080"
      }
    }
`);
}

function showVersion() {
  console.log(packageJson.version);
}

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

  // Handle commands
  switch (command) {
    case 'setup':
      await import('../src/cli/setup.js').then(module => module.runSetup());
      break;

    case 'start':
      // Start the server only
      await import('../src/index.js');
      break;

    case 'web':
      // Alias for start (server with web dashboard)
      await import('../src/index.js');
      break;

    case undefined:
    case 'run': {
      // Default: Start proxy in background + launch Claude Code
      const { spawn, execSync } = await import('child_process');
      const port = process.env.PORT || 8080;
      
      console.log(`\x1b[34mStarting Antigravity Claude Proxy on port ${port}...\x1b[0m`);
      
      // Start proxy in background
      const proxyProcess = spawn('node', [join(__dirname, '..', 'src', 'index.js')], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, PORT: port }
      });
      proxyProcess.unref();
      
      // Wait for proxy to be ready
      console.log('Waiting for proxy to be ready...');
      let ready = false;
      for (let i = 0; i < 60; i++) {
        try {
          execSync(`curl -s http://localhost:${port}/health`, { stdio: 'ignore' });
          ready = true;
          break;
        } catch {
          await new Promise(r => setTimeout(r, 500));
        }
      }
      
      if (!ready) {
        console.error('\x1b[31mError: Proxy failed to start within 30 seconds.\x1b[0m');
        process.exit(1);
      }
      
      console.log(`\x1b[32m✓ Proxy is ready on port ${port}!\x1b[0m\n`);
      
      // Check if claude is installed
      try {
        execSync('which claude', { stdio: 'ignore' });
      } catch {
        console.error('\x1b[31mError: Claude Code CLI not found.\x1b[0m');
        console.error('Install it with: npm install -g @anthropic-ai/claude-code');
        process.exit(1);
      }
      
      // Launch Claude with proxy config
      const claudeArgs = args.slice(command === 'run' ? 1 : 0);
      const claudeProcess = spawn('claude', claudeArgs, {
        stdio: 'inherit',
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: `http://localhost:${port}`,
          ANTHROPIC_API_KEY: 'dummy'
        }
      });
      
      // Cleanup on exit
      const cleanup = () => {
        console.log('\n\x1b[33mStopping Antigravity Claude Proxy...\x1b[0m');
        try {
          execSync(`lsof -ti tcp:${port} | xargs kill 2>/dev/null`, { stdio: 'ignore' });
        } catch {}
        console.log('\x1b[32m✓ Proxy stopped\x1b[0m');
      };
      
      claudeProcess.on('close', (code) => {
        cleanup();
        process.exit(code || 0);
      });
      
      process.on('SIGINT', () => {
        claudeProcess.kill('SIGINT');
      });
      process.on('SIGTERM', () => {
        claudeProcess.kill('SIGTERM');
      });
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

    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "proxy-claude --help" for usage information.');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
