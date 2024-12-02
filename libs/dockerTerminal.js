import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// DOM Elements
const dockerTerminalModal = document.getElementById('docker-terminal-modal');
const dockerTerminalTitle = document.getElementById('docker-terminal-title');
const dockerTerminalContainer = document.getElementById('docker-terminal-container');
const dockerKillTerminalBtn = document.getElementById('docker-kill-terminal-btn');

// Terminal variables
let dockerTerminalSession = null;

// Start Docker CLI terminal session
function startDockerTerminal(connectionId, peer) {
  if (!peer) {
    console.error('[ERROR] No active peer for Docker CLI terminal.');
    return;
  }

  if (dockerTerminalSession) {
    console.log(`[INFO] Docker CLI terminal session already exists for connection: ${connectionId}`);
    return;
  }

  console.log(`[INFO] Starting Docker CLI terminal for connection: ${connectionId}`);

  const xterm = new Terminal({
    cursorBlink: true,
    theme: { background: '#1a1a1a', foreground: '#ffffff' },
  });
  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

  dockerTerminalContainer.innerHTML = ''; // Clear previous content
  xterm.open(dockerTerminalContainer);
  fitAddon.fit();

  dockerTerminalSession = { xterm, fitAddon, connectionId, peer };

  xterm.onData((input) => {
    const sanitizedInput = sanitizeDockerCommand(input.trim());
    if (sanitizedInput) {
      console.log(`[DEBUG] Sending Docker CLI command: ${sanitizedInput}`);
      peer.write(
        JSON.stringify({
          type: 'dockerCommand',
          data: sanitizedInput,
        })
      );
    } else {
      xterm.write('\r\n[ERROR] Invalid command. Only Docker CLI commands are allowed.\r\n');
    }
  });

  peer.on('data', (data) => {
    try {
      const response = JSON.parse(data.toString());
      if (response.type === 'dockerOutput' && response.connectionId === connectionId) {
        xterm.write(response.data);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to parse response from peer: ${error.message}`);
    }
  });

  dockerTerminalTitle.textContent = `Docker CLI Terminal: ${connectionId}`;
  dockerTerminalModal.style.display = 'flex';
}

// Sanitize input to ensure only Docker CLI commands are allowed
function sanitizeDockerCommand(command) {
  const allowedCommands = ['docker', 'docker-compose'];
  const parts = command.split(/\s+/);
  const baseCommand = parts[0];

  if (allowedCommands.includes(baseCommand)) {
    return command; // Valid Docker command
  }

  return null; // Invalid command
}

// Clean up Docker CLI terminal session
function cleanUpDockerTerminal() {
  if (dockerTerminalSession) {
    dockerTerminalSession.xterm.dispose();
    dockerTerminalSession = null;
    dockerTerminalContainer.innerHTML = '';
    dockerTerminalModal.style.display = 'none';
    console.log('[INFO] Docker CLI terminal session cleaned up.');
  }
}

// Handle Kill Terminal button
dockerKillTerminalBtn.onclick = () => {
  cleanUpDockerTerminal();
};

// Export functions
export { startDockerTerminal, cleanUpDockerTerminal };
