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
  killActiveTerminal();
};

// Kill the active terminal session
function killActiveTerminal() {
  const containerId = activeContainerId;

  if (containerId && terminalSessions[containerId]) {
    console.log(`[INFO] Killing terminal session for container: ${containerId}`);

    // Send kill command to server
    window.sendCommand('killTerminal', { containerId });

    // Clean up terminal session
    cleanUpTerminal(containerId);

    // Hide the terminal modal if this was the active session
    if (activeContainerId === containerId) {
      terminalModal.style.display = 'none';
      activeContainerId = null;
    }
  } else {
    console.error('[ERROR] No terminal session found to kill.');
  }
}

// Start terminal session
function startTerminal(containerId, containerName) {
  if (!window.activePeer) {
    console.error('[ERROR] No active peer for terminal.');
    return;
  }

  if (terminalSessions[containerId]) {
    console.log(`[INFO] Terminal session already exists for container: ${containerId}`);
    if (activeContainerId !== containerId || terminalModal.style.display === 'none') {
      switchTerminal(containerId);
    } else {
      console.log(`[INFO] Terminal for container ${containerId} is already active`);
    }
    return;
  }

  console.log(`[INFO] Creating new terminal session for container: ${containerId}`);

  const xterm = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#ffffff' },
  });
  const fitAddon = new FitAddon();
  xterm.loadAddon(fitAddon);

  const terminalDiv = document.createElement('div');
  terminalDiv.style.width = '100%';
  terminalDiv.style.height = '100%';
  terminalDiv.style.display = 'none'; // Initially hidden
  terminalContainer.appendChild(terminalDiv);

  xterm.open(terminalDiv);

  const onDataDisposable = xterm.onData((data) => {
    console.log(`[DEBUG] Sending terminal input for container ${containerId}: ${data}`);
    window.activePeer.write(
      JSON.stringify({
        type: 'terminalInput',
        containerId,
        data: btoa(data),
        encoding: 'base64',
      })
    );
  });

  terminalSessions[containerId] = {
    xterm,
    fitAddon,
    onDataDisposable,
    output: '',
    name: containerName,
    resizeListener: null,
    container: terminalDiv,
  };

  console.log(`[INFO] Starting terminal for container: ${containerId}`);
  window.activePeer.write(
    JSON.stringify({ command: 'startTerminal', args: { containerId } })
  );

  switchTerminal(containerId);
}

// Switch to a terminal session
function switchTerminal(containerId) {
  const session = terminalSessions[containerId];
  if (!session) {
    console.error(`[ERROR] No terminal session found for container: ${containerId}`);
    return;
  }

  if (activeContainerId && activeContainerId !== containerId) {
    const currentSession = terminalSessions[activeContainerId];
    if (currentSession) {
      if (currentSession.resizeListener) {
        window.removeEventListener('resize', currentSession.resizeListener);
        currentSession.resizeListener = null;
      }
      currentSession.container.style.display = 'none';
    }
  }

  session.container.style.display = 'block';
  setTimeout(() => session.fitAddon.fit(), 10);

  terminalTitle.dataset.containerId = containerId;
  terminalTitle.textContent = `Container Terminal: ${session.name}`;
  terminalModal.style.display = 'flex';
  activeContainerId = containerId;

  removeFromTray(containerId);

  console.log(`[INFO] Switched to terminal for container: ${containerId}`);

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

  session.xterm.write(outputData);
}

// Remove terminal from tray
function removeFromTray(containerId) {
  const trayItem = document.querySelector(`.tray-item[data-id="${containerId}"]`);
  if (trayItem) {
    trayItem.remove();
  }
}

// Clean up terminal session
function cleanUpTerminal(containerId) {
  const session = terminalSessions[containerId];
  if (session) {
    session.xterm.dispose();
    session.onDataDisposable.dispose();
    if (session.resizeListener) {
      window.removeEventListener('resize', session.resizeListener);
    }
    session.container.parentNode.removeChild(session.container);
    delete terminalSessions[containerId];
    console.log(`[INFO] Cleaned up terminal for container: ${containerId}`);
  } else {
    console.error(`[ERROR] No terminal session to clean up for container: ${containerId}`);
  }
}

// Clean up all terminals
function cleanUpAllTerminals() {
  Object.keys(terminalSessions).forEach(cleanUpTerminal);
  terminalModal.style.display = 'none';
  activeContainerId = null;
  console.log('[INFO] All terminal sessions cleaned up.');
}

// Expose functions to app.js
export { startTerminal, appendTerminalOutput, cleanUpAllTerminals };
