import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

const swarm = new Hyperswarm();
const connections = {};
let activePeer = null;
let terminalSessions = {}; // Track terminal states per container
let xterm = null; // The current terminal instance
let fitAddon = null; // FitAddon instance

// DOM Elements
const terminalModal = document.getElementById('terminal-modal');
const terminalTitle = document.getElementById('terminal-title');
const terminalContainer = document.getElementById('terminal-container');
const tray = document.getElementById('tray');
const containerList = document.getElementById('container-list');

// Initialize the app
console.log('[INFO] Client app initialized');

// Add a new connection
document.getElementById('add-connection-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const topicHex = document.getElementById('new-connection-topic').value;
  const topic = b4a.from(topicHex, 'hex');
  const topicId = topicHex.substring(0, 12);

  console.log(`[INFO] Adding connection with topic: ${topicHex}`);

  const connectionItem = document.createElement('li');
  connectionItem.className = 'list-group-item d-flex align-items-center';
  connectionItem.dataset.topicId = topicId;
  connectionItem.innerHTML = `
    <span class="connection-status status-disconnected"></span>${topicId}
  `;
  connectionItem.addEventListener('click', () => window.switchConnection(topicId));
  document.getElementById('connection-list').appendChild(connectionItem);

  connections[topicId] = { topic, peer: null };

  swarm.join(topic, { client: true, server: false });
  swarm.on('connection', (peer) => {
    console.log(`[INFO] Connected to peer for topic: ${topicHex}`);
    connections[topicId].peer = peer;
    updateConnectionStatus(topicId, true);

    peer.on('data', (data) => {
      try {
        const response = JSON.parse(data.toString());
        console.log(`[DEBUG] Received data from server: ${JSON.stringify(response)}`);

        if (response.type === 'containers') {
          renderContainers(response.data);
        } else if (response.type === 'terminalOutput') {
          appendTerminalOutput(response.data, response.containerId);
        }
      } catch (err) {
        console.error(`[ERROR] Failed to parse data from server: ${err.message}`);
      }
    });

    peer.on('close', () => {
      console.log(`[INFO] Disconnected from peer for topic: ${topicHex}`);
      updateConnectionStatus(topicId, false);
    });
  });
});

// Collapse/Expand Sidebar
document.getElementById('collapse-sidebar-btn').addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  const btn = document.getElementById('collapse-sidebar-btn');
  btn.textContent = sidebar.classList.contains('collapsed') ? '>' : '<';
});

// Update connection status
function updateConnectionStatus(topicId, isConnected) {
  const connectionItem = document.querySelector(`[data-topic-id="${topicId}"] .connection-status`);
  connectionItem.className = `connection-status ${isConnected ? 'status-connected' : 'status-disconnected'}`;
}

// Switch between connections
function switchConnection(topicId) {
  activePeer = connections[topicId].peer;
  const connectionTitle = document.getElementById('connection-title');
  if (!connectionTitle) {
    console.error('[ERROR] Connection title element is missing.');
    return;
  }
  connectionTitle.textContent = `Connection: ${topicId}`;
  document.getElementById('dashboard').classList.remove('hidden');

  if (activePeer) {
    console.log('[INFO] Sending "listContainers" command');
    window.sendCommand('listContainers');
  } else {
    console.error('[ERROR] No active peer to send command.');
  }
}

// Attach switchConnection to the global window object
window.switchConnection = switchConnection;

// Send a command to the active peer
function sendCommand(command, args = {}) {
  if (activePeer) {
    const message = JSON.stringify({ command, args });
    console.log(`[DEBUG] Sending command to server: ${message}`);
    activePeer.write(message);
  } else {
    console.error('[ERROR] No active peer to send command.');
  }
}

// Attach sendCommand to the global window object
window.sendCommand = sendCommand;

// Render the container list
function renderContainers(containers) {
  console.log(`[INFO] Rendering ${containers.length} containers`);
  containerList.innerHTML = '';

  containers.forEach((container) => {
    const name = container.Names[0].replace(/^\//, ''); // Remove leading slash from container names
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${name}</td>
      <td>${container.State}</td>
      <td>
        <button class="btn btn-success btn-sm" onclick="window.sendCommand('startContainer', { id: '${container.Id}' })">Start</button>
        <button class="btn btn-warning btn-sm" onclick="window.sendCommand('stopContainer', { id: '${container.Id}' })">Stop</button>
        <button class="btn btn-danger btn-sm" onclick="window.sendCommand('removeContainer', { id: '${container.Id}' })">Remove</button>
        <button class="btn btn-info btn-sm" onclick="window.startTerminal('${container.Id}')">Terminal</button>
      </td>
    `;
    containerList.appendChild(row);
  });
}

// Initialize Xterm.js terminal
function initializeTerminal() {
  if (xterm) {
    xterm.dispose(); // Dispose existing terminal instance
  }
  xterm = new Terminal({ cursorBlink: true, theme: { background: '#000000', foreground: '#ffffff' } });
  fitAddon = new FitAddon(); // Create a new FitAddon instance
  xterm.loadAddon(fitAddon);

  xterm.open(terminalContainer);
  setTimeout(() => fitAddon.fit(), 10); // Ensure terminal fits properly after rendering
  xterm.write('\x1b[1;32mWelcome to the Docker Terminal\x1b[0m\r\n');

  // Adjust terminal size dynamically when the window is resized
  window.addEventListener('resize', () => {
    fitAddon.fit();
  });
}

// Start terminal session
function startTerminal(containerId) {
  if (!activePeer) {
    console.error('[ERROR] No active peer for terminal.');
    return;
  }

  if (!terminalSessions[containerId]) {
    terminalSessions[containerId] = { output: '' }; // Initialize terminal state
  }

  const session = terminalSessions[containerId];
  initializeTerminal();
  xterm.write(session.output);

  terminalModal.style.display = 'flex';
  terminalTitle.textContent = `Container Terminal: ${containerId}`;

  console.log(`[INFO] Starting terminal for container: ${containerId}`);
  activePeer.write(JSON.stringify({ command: 'startTerminal', args: { containerId } }));

  xterm.onData((data) => {
    console.log(`[DEBUG] Sending terminal input: ${data}`);
    activePeer.write(JSON.stringify({ type: 'terminalInput', data }));
  });

  document.getElementById('minimize-terminal-btn').onclick = () => {
    terminalModal.style.display = 'none';
    addToTray(containerId); // Minimize to tray
  };
}

// Attach startTerminal to the global window object
window.startTerminal = startTerminal;

// Append terminal output
function appendTerminalOutput(data, containerId) {
  if (!terminalSessions[containerId]) {
    console.error(`[ERROR] No terminal session found for container: ${containerId}`);
    return;
  }

  console.log(`[DEBUG] Appending terminal output: ${data}`);
  const session = terminalSessions[containerId];
  session.output += data;
  if (terminalTitle.textContent.includes(containerId)) {
    xterm.write(data);
  }
}

// Add terminal to tray
function addToTray(containerId) {
  let trayItem = document.querySelector(`.tray-item[data-id="${containerId}"]`);
  if (!trayItem) {
    trayItem = document.createElement('div');
    trayItem.className = 'tray-item';
    trayItem.dataset.id = containerId;
    trayItem.textContent = `Terminal: ${containerId}`;
    trayItem.onclick = () => {
      terminalModal.style.display = 'flex';
      xterm.write(terminalSessions[containerId].output);
      setTimeout(() => fitAddon.fit(), 10); // Ensure proper resize
    };
    tray.appendChild(trayItem);
  }
}
