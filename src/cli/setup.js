import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { DEFAULT_PORT } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROXY_ROOT = path.resolve(__dirname, '../..');

export async function runSetup() {
    logger.info('Starting Antigravity Claude Proxy setup...');

    // 1. Install Claude Code CLI
    await installClaudeCode();

    // 2. Install this package globally (so proxy-claude uses local code)
    await installProxyGlobally();

    // 3. Configure Environment/Script
    await createProxyLauncher();

    logger.success('Setup complete!');
    console.log('');
    console.log('You can now run "proxy-claude" from anywhere to start the proxy and Claude Code seamlessly.');
    console.log('');
}

async function installClaudeCode() {
    try {
        // Check if claude is installed
        try {
            execSync('claude --version', { stdio: 'ignore' });
            logger.info('Claude Code CLI is already installed.');
        } catch (e) {
            // If checking version fails, it might not be installed or return non-zero
            throw new Error('Not found');
        }
    } catch (e) {
        logger.info('Installing Claude Code CLI...');
        try {
            execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
            logger.success('Claude Code CLI installed successfully.');
        } catch (err) {
            logger.error('Failed to install Claude Code CLI. Please install it manually: npm install -g @anthropic-ai/claude-code');
            // We don't exit here, maybe they want the script anyway
        }
    }
}

async function installProxyGlobally() {
    // Skip global install - too complex with build steps
    // Instead, proxy-claude will use npx or check for local project
    logger.info('Skipping global install (use npm link if needed).');
}

async function createProxyLauncher() {
    // Generate the script content.
    // IMPORTANT: We escape ${} for Bash variables as \${} so JS doesn't parse them.
    // We escape backslashes for colors as \\033 so they write correctly to the file.
    
    const scriptContent = `#!/bin/bash
# proxy-claude - Full CLI for Antigravity Claude Proxy
# This script provides complete control over the proxy and Claude Code.

VERSION="1.0.2"
PORT=\${PORT:-${DEFAULT_PORT || 8080}}
PROXY_PID=""

# Colors for output
RED='\\033[0;31m'
GREEN='\\033[0;32m'
YELLOW='\\033[1;33m'
BLUE='\\033[0;34m'
NC='\\033[0m' # No Color

# Function to cleanup background process on exit
cleanup() {
  if [ -n "$PROXY_PID" ]; then
    echo ""
    echo -e "\${YELLOW}Stopping Antigravity Claude Proxy...\${NC}"
    kill $PROXY_PID 2>/dev/null
    wait $PROXY_PID 2>/dev/null
    echo -e "\${GREEN}✓ Proxy stopped\${NC}"
  fi
}

# Function to start proxy and wait for it
start_proxy() {
  echo -e "\${BLUE}Starting Antigravity Claude Proxy on port $PORT...\${NC}"
  
  if command -v proxy-claude &> /dev/null; then
    proxy-claude start > /tmp/antigravity-proxy.log 2>&1 &
  else
    npx @kamel-ahmed/proxy-claude@latest start > /tmp/antigravity-proxy.log 2>&1 &
  fi
  PROXY_PID=$!
  
  echo "Waiting for proxy to be ready..."
  MAX_RETRIES=60
  count=0
  while ! nc -z localhost $PORT >/dev/null 2>&1; do
    sleep 0.5
    count=$((count+1))
    if [ $count -ge $MAX_RETRIES ]; then
      echo -e "\${RED}Error: Proxy failed to start within 30 seconds.\${NC}"
      echo "Check logs: /tmp/antigravity-proxy.log"
      tail -n 20 /tmp/antigravity-proxy.log
      exit 1
    fi
  done
  echo -e "\${GREEN}✓ Proxy is ready on port $PORT!\${NC}"
}

# Function to run the proxy command (uses npm global install or npx)
run_proxy_cmd() {
  if command -v proxy-claude &> /dev/null; then
    proxy-claude "$@"
  else
    npx @kamel-ahmed/proxy-claude@latest "$@"
  fi
}

show_help() {
  echo ""
  echo -e "\${BLUE}proxy-claude\${NC} v$VERSION - Antigravity Claude Proxy CLI"
  echo ""
  echo "USAGE:"
  echo "  proxy-claude [command] [options]"
  echo ""
  echo "COMMANDS:"
  echo "  (default)           Start proxy + launch Claude Code (interactive)"
  echo "  web                 Start proxy with web dashboard only"
  echo "  start               Start proxy server only (foreground)"
  echo "  accounts [action]   Manage Google accounts (add/list/remove/verify/clear)"
  echo "  refresh             Check and refresh account tokens"
  echo "  status              Check if proxy is running"
  echo "  stop                Stop running proxy server"
  echo "  logs                View proxy logs"
  echo "  uninstall           Remove proxy-claude from system"
  echo "  help                Show this help message"
  echo ""
  echo "OPTIONS:"
  echo "  --port, -p <port>   Set custom port (default: 8080)"
  echo "  --version, -v       Show version"
  echo ""
  echo "EXAMPLES:"
  echo "  proxy-claude                    # Start proxy + Claude"
  echo "  proxy-claude web                # Start web dashboard"
  echo "  proxy-claude accounts add       # Add Google account"
  echo "  proxy-claude refresh            # Check and refresh tokens"
  echo "  proxy-claude refresh --force    # Force refresh all tokens"
  echo "  PORT=3000 proxy-claude          # Use custom port"
  echo "  proxy-claude --port 3000 web    # Web on custom port"
  echo ""
  echo "WEB DASHBOARD:"
  echo "  http://localhost:$PORT"
  echo ""
}

# Parse global options
while [[ "$1" == --* ]] || [[ "$1" == -* ]]; do
  case "$1" in
    --port|-p)
      PORT="$2"
      shift 2
      ;;
    --version|-v)
      echo "proxy-claude v$VERSION"
      exit 0
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

COMMAND="\${1:-}"
shift 2>/dev/null || true

case "$COMMAND" in
  ""|"claude")
    # Default: Start proxy + Claude
    trap cleanup EXIT INT TERM
    start_proxy
    echo ""
    if command -v claude &> /dev/null; then
      export ANTHROPIC_BASE_URL="http://localhost:$PORT"
      export ANTHROPIC_API_KEY="dummy"
      claude "$@"
    else
      echo -e "\${RED}Error: 'claude' command not found.\${NC}"
      echo "Install it with: npm install -g @anthropic-ai/claude-code"
      exit 1
    fi
    ;;
    
  "web")
    # Start proxy with web dashboard only (foreground)
    echo -e "\${BLUE}Starting Antigravity Claude Proxy with Web Dashboard...\${NC}"
    echo -e "Web UI: \${GREEN}http://localhost:$PORT\${NC}"
    echo ""
    echo "Press Ctrl+C to stop"
    echo ""
    run_proxy_cmd start
    ;;
    
  "start")
    # Start proxy only (foreground)
    echo -e "\${BLUE}Starting proxy server...\${NC}"
    run_proxy_cmd start
    ;;
    
  "accounts")
    # Account management
    run_proxy_cmd accounts "$@"
    ;;
    
  "refresh")
    # Token refresh - run inline since npm package may not have this yet
    CONFIG_FILE="$HOME/.config/antigravity-proxy/accounts.json"
    
    if [ ! -f "$CONFIG_FILE" ]; then
      echo -e "\${YELLOW}No accounts configured.\${NC}"
      echo "Run 'proxy-claude accounts add' to add an account."
      exit 0
    fi
    
    # Try to run via the package first, fall back to verify which does similar
    if run_proxy_cmd refresh "$@" 2>/dev/null; then
      exit 0
    else
      echo "Running token verification..."
      run_proxy_cmd accounts verify
    fi
    ;;
    
  "status")
    # Check if proxy is running
    if nc -z localhost $PORT >/dev/null 2>&1; then
      echo -e "\${GREEN}✓ Proxy is running on port $PORT\${NC}"
      # Try to get health info
      curl -s "http://localhost:$PORT/health" 2>/dev/null || true
    else
      echo -e "\${YELLOW}✗ Proxy is not running on port $PORT\${NC}"
    fi
    ;;
    
  "stop")
    # Stop running proxy
    echo "Stopping proxy on port $PORT..."
    # Find and kill process listening on the port
    PID=$(lsof -ti tcp:$PORT 2>/dev/null)
    if [ -n "$PID" ]; then
      kill $PID 2>/dev/null
      echo -e "\${GREEN}✓ Proxy stopped (PID: $PID)\${NC}"
    else
      echo -e "\${YELLOW}No proxy found running on port $PORT\${NC}"
    fi
    ;;
    
  "logs")
    # View logs
    if [ -f /tmp/antigravity-proxy.log ]; then
      echo -e "\${BLUE}=== Proxy Logs ===\${NC}"
      tail -f /tmp/antigravity-proxy.log
    else
      echo "No log file found at /tmp/antigravity-proxy.log"
    fi
    ;;
    
  "uninstall")
    # Uninstall proxy-claude
    echo -e "\${YELLOW}Uninstalling proxy-claude...\${NC}"
    if [ -f /usr/local/bin/proxy-claude ]; then
      sudo rm /usr/local/bin/proxy-claude
      echo -e "\${GREEN}✓ Removed /usr/local/bin/proxy-claude\${NC}"
    else
      echo "proxy-claude not found in /usr/local/bin"
    fi
    echo ""
    echo "To also uninstall the npm package (if installed globally):"
    echo "  npm uninstall -g @kamel-ahmed/proxy-claude"
    ;;
    
  "help"|"--help"|"-h")
    show_help
    ;;
    
  *)
    echo -e "\${RED}Unknown command: $COMMAND\${NC}"
    echo "Run 'proxy-claude help' for usage"
    exit 1
    ;;
esac
`;

    // Try to install it to /usr/local/bin directly if possible
    const targetPath = '/usr/local/bin/proxy-claude';
    
    try {
        // Try writing directly (might fail if not sudo)
        fs.writeFileSync(targetPath, scriptContent);
        fs.chmodSync(targetPath, '755');
        logger.success(`Installed global command: ${targetPath}`);
    } catch (err) {
        // Fallback: Write to local and try to move with sudo, or just tell user what to do
        if (err.code === 'EACCES') {
             logger.warn('Could not write directly to /usr/local/bin. Trying with sudo...');
             const tempPath = path.join(os.tmpdir(), 'proxy-claude');
             fs.writeFileSync(tempPath, scriptContent);
             fs.chmodSync(tempPath, '755');
             
             try {
                execSync(`sudo mv "${tempPath}" "${targetPath}"`, { stdio: 'inherit' });
                logger.success(`Installed global command: ${targetPath}`);
             } catch (sudoErr) {
                 logger.error('Failed to install global command. Please run the setup with sudo or move the file manually.');
                 console.log(`Command to run: sudo mv "${tempPath}" "${targetPath}"`);
             }
        } else {
            logger.error(`Failed to create launcher: ${err.message}`);
        }
    }
}