// terminal.js
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// DOM Elements
const terminalModal = document.getElementById('terminal-modal');
const terminalTitle = document.getElementById('terminal-title');
const terminalContainer = document.getElementById('terminal-container');
const tray = document.getElementById('tray');

// Terminal variables
let terminalSessions = {}; // Track terminal sessions per containerId
let activeContainerId = null; // Currently displayed containerId

// Kill Terminal button functionality
document.getElementById('kill-terminal-btn').onclick = () => {
  const containerId = activeContainerId;

  if (containerId && terminalSessions[containerId]) {
    console.log(`[INFO] Killing terminal session for container: ${containerId}`);

    // Send kill command to server
    window.sendCommand('killTerminal', { containerId });

    // Clean up terminal session
    const session = terminalSessions[containerId];
    session.xterm.dispose();
    session.onDataDisposable.dispose();
    if (session.resizeListener) {
      window.removeEventListener('resize', session.resizeListener);
    }
    // Remove the terminal's container div from DOM
    session.container.parentNode.removeChild(session.container);

    delete terminalSessions[containerId];

    // Remove from tray if exists
    removeFromTray(containerId);

    // Hide the terminal modal if this was the active session
    if (activeContainerId === containerId) {
      terminalModal.style.display = 'none';
      activeContainerId = null;
    }
  } else {
    console.error('[ERROR] No terminal session found to kill.');
  }
};

// Start terminal session
function startTerminal(containerId, containerName) {
  if (!window.activePeer) {
    console.error('[ERROR] No active peer for terminal.');
    return;
  }

  if (terminalSessions[containerId]) {
    // Terminal session already exists
    console.log(`[INFO] Terminal session already exists for container: ${containerId}`);

    // If terminal is minimized or not active, switch to it
    if (activeContainerId !== containerId || terminalModal.style.display === 'none') {
      switchTerminal(containerId);
    } else {
      console.log(`[INFO] Terminal for container ${containerId} is already active`);
    }
    return;
  }

  // Create new terminal session
  console.log(`[INFO] Creating new terminal session for container: ${containerId}`);

  // Initialize new terminal session
  const xterm = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#ffffff' },
  });
  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

  // Create a container div for this terminal
  const terminalDiv = document.createElement('div');
  terminalDiv.style.width = '100%';
  terminalDiv.style.height = '100%';
  terminalDiv.style.display = 'none'; // Initially hidden
  terminalContainer.appendChild(terminalDiv);

  // Open the terminal in the container div
  xterm.open(terminalDiv);

  // Set up event listener for terminal input using onData
  const onDataDisposable = xterm.onData((data) => {
    console.log(`[DEBUG] Sending terminal input for container ${containerId}: ${data}`);

    // Base64 encode the data
    window.activePeer.write(
      JSON.stringify({
        type: 'terminalInput',
        containerId,
        data: btoa(data),
        encoding: 'base64',
      })
    );
  });

  // Store the terminal session
  terminalSessions[containerId] = {
    xterm,
    fitAddon,
    onDataDisposable,
    output: '',
    name: containerName,
    resizeListener: null,
    container: terminalDiv,
  };

  // Send startTerminal command to server
  console.log(`[INFO] Starting terminal for container: ${containerId}`);
  window.activePeer.write(
    JSON.stringify({ command: 'startTerminal', args: { containerId } })
  );

  // Switch to the requested terminal session
  switchTerminal(containerId);
}

// Switch to a terminal session
function switchTerminal(containerId) {
  const session = terminalSessions[containerId];
  if (!session) {
    console.error(`[ERROR] No terminal session found for container: ${containerId}`);
    return;
  }

  // Hide the current terminal if any
  if (activeContainerId && activeContainerId !== containerId) {
    const currentSession = terminalSessions[activeContainerId];
    if (currentSession) {
      // Remove resize listener for current session
      if (currentSession.resizeListener) {
        window.removeEventListener('resize', currentSession.resizeListener);
        currentSession.resizeListener = null;
      }
      // Hide current terminal's container
      currentSession.container.style.display = 'none';
    }
  }

  // Show the terminal
  session.container.style.display = 'block';

  setTimeout(() => session.fitAddon.fit(), 10); // Ensure terminal fits properly after rendering

  // Update modal title
  terminalTitle.dataset.containerId = containerId;
  terminalTitle.textContent = `Container Terminal: ${session.name}`;

  // Show the terminal modal
  terminalModal.style.display = 'flex';
  activeContainerId = containerId;

  // Remove from tray if it exists
  removeFromTray(containerId);

  console.log(`[INFO] Switched to terminal for container: ${containerId}`);

  // Adjust resize event listener
  if (session.resizeListener) {
    window.removeEventListener('resize', session.resizeListener);
  }
  session.resizeListener = () => session.fitAddon.fit();
  window.addEventListener('resize', session.resizeListener);
}

// Append terminal output
function appendTerminalOutput(data, containerId, encoding) {
  const session = terminalSessions[containerId];
  if (!session) {
    console.error(`[ERROR] No terminal session found for container: ${containerId}`);
    return;
  }

  let outputData;
  if (encoding === 'base64') {
    outputData = atob(data);
  } else {
    outputData = data;
  }

  // Write the decoded data to the terminal
  session.xterm.write(outputData);
}

// Remove terminal from tray
function removeFromTray(containerId) {
  const trayItem = document.querySelector(`.tray-item[data-id="${containerId}"]`);
  if (trayItem) {
    trayItem.remove();
  }
}

// Expose functions to app.js
export { startTerminal, appendTerminalOutput };