import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';
import { DEFAULT_PORT } from '../constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROXY_ROOT = path.resolve(__dirname, '../../');

export async function runSetup() {
    logger.info('Starting Antigravity Claude Proxy setup...');

    // 1. Install Claude Code CLI
    await installClaudeCode();

    // 2. Configure Environment/Script
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

async function createProxyLauncher() {
    // Generate the script content - use npx for portability so it works on any machine
    const scriptContent = `#!/bin/bash
# Wrapper script for Antigravity Claude Proxy + Claude Code
# This script starts the proxy server and launches Claude Code with proper configuration.

# Function to cleanup background process on exit
cleanup() {
  if [ -n "$PROXY_PID" ]; then
    echo ""
    echo "Stopping Antigravity Claude Proxy..."
    kill $PROXY_PID 2>/dev/null
    wait $PROXY_PID 2>/dev/null
  fi
}
trap cleanup EXIT INT TERM

PORT=\${PORT:-8080}

# 1. Start the proxy server in background
echo "Starting Antigravity Claude Proxy on port $PORT..."

# Try to use globally installed package first, fall back to npx
if command -v antigravity-claude-proxy &> /dev/null; then
    antigravity-claude-proxy start > /tmp/antigravity-proxy.log 2>&1 &
else
    npx antigravity-claude-proxy@latest start > /tmp/antigravity-proxy.log 2>&1 &
fi
PROXY_PID=$!

# 2. Wait for server to be ready
echo "Waiting for proxy to be ready..."
MAX_RETRIES=60
count=0
while ! nc -z localhost $PORT >/dev/null 2>&1; do
  sleep 0.5
  count=$((count+1))
  if [ $count -ge $MAX_RETRIES ]; then
    echo "Error: Proxy failed to start within 30 seconds."
    echo "Check logs: /tmp/antigravity-proxy.log"
    echo "Last 20 lines of log:"
    tail -n 20 /tmp/antigravity-proxy.log
    exit 1
  fi
done
echo "✓ Proxy is ready on port $PORT!"
echo ""

# 3. Run Claude Code with environment configured
if command -v claude &> /dev/null; then
    export ANTHROPIC_BASE_URL="http://localhost:$PORT"
    export ANTHROPIC_API_KEY="dummy"
    # Pass all arguments to claude
    claude "$@"
else
    echo "Error: 'claude' command not found."
    echo "Please install Claude Code CLI: npm install -g @anthropic-ai/claude-code"
    exit 1
fi
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