import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// DOM Elements
const dockerTerminalModal = document.getElementById('docker-terminal-modal');
const dockerTerminalTitle = document.getElementById('docker-terminal-title');
const dockerTerminalContainer = document.getElementById('docker-terminal-container');
const dockerKillTerminalBtn = document.getElementById('docker-kill-terminal-btn');

// Terminal variables
let dockerTerminalSession = null;

function startDockerTerminal(connectionId, peer) {
    if (!peer) {
      console.error('[ERROR] No active peer for Docker CLI terminal.');
      return;
    }
  
    if (dockerTerminalSession) {
      console.log('[INFO] Docker CLI terminal session already exists.');
      return;
    }
  
    const xterm = new Terminal({
      cursorBlink: true,
      theme: { background: '#000000', foreground: '#ffffff' },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
  
    dockerTerminalContainer.innerHTML = ''; // Clear previous content
    xterm.open(dockerTerminalContainer);
    fitAddon.fit();
  
    dockerTerminalSession = { xterm, fitAddon, connectionId, peer };
  
    let inputBuffer = ''; // Buffer for user input
  
    xterm.onData((input) => {
      if (input === '\r') { // User pressed Enter
        const sanitizedInput = sanitizeDockerCommand(inputBuffer.trim());
        if (sanitizedInput) {
          console.log(`[DEBUG] Sending Docker CLI command: ${sanitizedInput}`);
          peer.write(
            JSON.stringify({
              type: 'dockerCommand',
              connectionId,
              data: sanitizedInput,
            })
          );
          xterm.write('\r\n'); // Move to the next line in the terminal
        } else {
          xterm.write('\r\n[ERROR] Invalid command. Only Docker CLI commands are allowed.\r\n');
        }
        inputBuffer = ''; // Clear the buffer after processing
      } else if (input === '\u007F') { // Handle backspace
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1); // Remove the last character from the buffer
          xterm.write('\b \b'); // Erase the character from the terminal display
        }
      } else {
        inputBuffer += input; // Append input to the buffer
        xterm.write(input); // Display input in the terminal
      }
    });
  
    peer.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (response.type === 'dockerOutput' && response.connectionId === connectionId) {
          xterm.write(`${response.data}\r\n`);
        }
      } catch (error) {
        console.error(`[ERROR] Failed to parse response from peer: ${error.message}`);
      }
    });
  
    dockerTerminalTitle.textContent = `Docker CLI Terminal: ${connectionId}`;
    dockerTerminalModal.style.display = 'flex';
  
    dockerKillTerminalBtn.onclick = () => {
      cleanUpDockerTerminal();
    };
  }
  
// Sanitize input to ensure only Docker CLI commands are allowed
function sanitizeDockerCommand(command) {
    // Allow commands starting with "docker" and disallow dangerous operators
    const isValid = /^docker(\s+[\w.-]+)*$/i.test(command);
    return isValid ? command : null;
  }

// Clean up Docker CLI terminal session
function cleanUpDockerTerminal() {
    if (dockerTerminalSession) {
      dockerTerminalSession.xterm.dispose();
      dockerTerminalSession = null;
      dockerTerminalContainer.innerHTML = ''; // Clear terminal content
      dockerTerminalModal.style.display = 'none'; // Hide the modal
      dockerTerminalModal.classList.add('hidden');
      console.log('[INFO] Docker CLI terminal session cleaned up.');
    }
  }
  
// Handle Kill Terminal button
dockerKillTerminalBtn.onclick = () => {
  cleanUpDockerTerminal();
};

// Export functions
export { startDockerTerminal, cleanUpDockerTerminal };
