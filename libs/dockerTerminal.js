import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// DOM Elements
const dockerTerminalModal = document.getElementById('docker-terminal-modal');
const dockerTerminalTitle = document.getElementById('docker-terminal-title');
const dockerTerminalContainer = document.getElementById('docker-terminal-container');
const dockerKillTerminalBtn = document.getElementById('docker-kill-terminal-btn');

// Terminal variables
let dockerTerminalSession = null;

/**
 * Initialize and start the Docker CLI terminal.
 * @param {string} connectionId - Unique ID for the connection.
 * @param {Object} peer - Active peer object for communication.
 */
function startDockerTerminal(connectionId, peer) {
    if (!peer) {
      console.error('[ERROR] No active peer for Docker CLI terminal.');
      return;
    }
  
    if (dockerTerminalSession) {
      console.log('[INFO] Docker CLI terminal session already exists.');
      return;
    }
  
    // Verify DOM elements
    const dockerTerminalContainer = document.getElementById('docker-terminal-container');
    const dockerTerminalTitle = document.getElementById('docker-terminal-title');
    const dockerTerminalModal = document.getElementById('dockerTerminalModal');
    const dockerKillTerminalBtn = document.getElementById('docker-kill-terminal-btn');
  
    if (!dockerTerminalContainer || !dockerTerminalTitle || !dockerTerminalModal || !dockerKillTerminalBtn) {
      console.error('[ERROR] Missing required DOM elements for Docker CLI terminal.');
      return;
    }
  
    // Initialize the xterm.js terminal
    const xterm = new Terminal({
      cursorBlink: true,
      theme: { background: '#000000', foreground: '#ffffff' },
    });
    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
  
    // Prepare the terminal container
    dockerTerminalContainer.innerHTML = ''; // Clear previous content
    xterm.open(dockerTerminalContainer);
    fitAddon.fit();
  
    dockerTerminalSession = { xterm, fitAddon, connectionId, peer };
  
    // Buffer to accumulate user input
    let inputBuffer = '';
  
    // Handle terminal input
    xterm.onData((input) => {
      if (input === '\r') {
        // User pressed Enter
        const fullCommand = prependDockerCommand(inputBuffer.trim());
        if (fullCommand) {
          console.log(`[DEBUG] Sending Docker CLI command: ${fullCommand}`);
          peer.write(
            JSON.stringify({
              command: 'dockerCommand',
              connectionId,
              data: fullCommand,
            })
          );
          xterm.write('\r\n'); // Move to the next line
        } else {
          xterm.write('\r\n[ERROR] Invalid command. Please check your input.\r\n');
        }
        inputBuffer = ''; // Clear the buffer after processing
      } else if (input === '\u007F') {
        // Handle backspace
        if (inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1); // Remove last character
          xterm.write('\b \b'); // Erase character from display
        }
      } else {
        // Append input to buffer and display it
        inputBuffer += input;
        xterm.write(input);
      }
    });
  
    // Handle peer data
    peer.on('data', (data) => {
      console.log('[DEBUG] Received data event');
      try {
        const response = JSON.parse(data.toString());
        if (response.connectionId === connectionId) {
          const decodedData = decodeResponseData(response.data, response.encoding);
  
          if (response.type === 'dockerOutput') {
            xterm.write(`${decodedData.trim()}\r\n`);
          } else if (response.type === 'terminalErrorOutput') {
            xterm.write(`\r\n[ERROR] ${decodedData.trim()}\r\n`);
          }
        }
      } catch (error) {
        console.error(`[ERROR] Failed to parse response from peer: ${error.message}`);
      }
    });
  
    // Update the terminal modal and title
    dockerTerminalTitle.textContent = `Docker CLI Terminal: ${connectionId}`;
    const modalInstance = new bootstrap.Modal(dockerTerminalModal);
    modalInstance.show();
  
    // Attach event listener for Kill Terminal button
    dockerKillTerminalBtn.onclick = () => {
      cleanUpDockerTerminal();
    };
  }
  
/**
 * Prepend 'docker' to the command if it's missing.
 * @param {string} command - Command string entered by the user.
 * @returns {string|null} - Full Docker command or null if invalid.
 */
function prependDockerCommand(command) {
  // Disallow dangerous operators
  if (/[\|;&`]/.test(command)) {
    console.warn('[WARN] Invalid characters detected in command.');
    return null;
  }

  // Prepend 'docker' if not already present
  if (!command.startsWith('docker ')) {
    return `docker ${command}`;
  }
  return command;
}

/**
 * Decode response data from Base64 or return as-is if not encoded.
 * @param {string} data - Response data from the server.
 * @param {string} encoding - Encoding type (e.g., 'base64').
 * @returns {string} - Decoded or plain data.
 */
function decodeResponseData(data, encoding) {
  if (encoding === 'base64') {
    try {
      return atob(data); // Decode Base64 data
    } catch (error) {
      console.error(`[ERROR] Failed to decode Base64 data: ${error.message}`);
      return '[ERROR] Command failed.';
    }
  }
  return data; // Return plain data if not encoded
}

/**
 * Clean up the Docker CLI terminal session.
 */
function cleanUpDockerTerminal() {
    console.log('[INFO] Cleaning up Docker Terminal...');
  
    // Retrieve the required DOM elements
    const dockerTerminalContainer = document.getElementById('docker-terminal-container');
    const dockerTerminalModal = document.getElementById('dockerTerminalModal');
  
    if (!dockerTerminalContainer || !dockerTerminalModal) {
      console.error('[ERROR] Required DOM elements not found for cleaning up the Docker Terminal.');
      return;
    }
  
    // Dispose of the terminal session if it exists
    if (dockerTerminalSession) {
      if (dockerTerminalSession.xterm) {
        dockerTerminalSession.xterm.dispose();
      }
      dockerTerminalSession = null; // Reset the session object
    }
  
    // Clear the terminal content
    dockerTerminalContainer.innerHTML = '';
  
    // Use Bootstrap API to hide the modal
    const modalInstance = bootstrap.Modal.getInstance(dockerTerminalModal);
    if (modalInstance) {
      modalInstance.hide();
    } else {
      console.warn('[WARNING] Modal instance not found. Falling back to manual close.');
      dockerTerminalModal.style.display = 'none';
    }
  
    // Ensure lingering backdrops are removed
    const backdrop = document.querySelector('.modal-backdrop');
    if (backdrop) {
      backdrop.remove();
    }
  
    // Restore the body's scroll behavior
    document.body.classList.remove('modal-open');
    document.body.style.paddingRight = '';
  
    console.log('[INFO] Docker CLI terminal session cleanup completed.');
  }
  

// Attach event listener for Kill Terminal button (redundant safety check)
dockerKillTerminalBtn.onclick = () => {
  cleanUpDockerTerminal();
};

// Export functions
export { startDockerTerminal, cleanUpDockerTerminal, dockerTerminalSession };
