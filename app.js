import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';
import { startTerminal, appendTerminalOutput } from './libs/terminal.js';

// DOM Elements
const containerList = document.getElementById('container-list');
const connectionList = document.getElementById('connection-list');
const addConnectionForm = document.getElementById('add-connection-form');
const newConnectionTopic = document.getElementById('new-connection-topic');
const connectionTitle = document.getElementById('connection-title');
const dashboard = document.getElementById('dashboard');

// Modal Elements
const duplicateModalElement = document.getElementById('duplicateModal');
const duplicateModal = new bootstrap.Modal(duplicateModalElement);
const duplicateContainerForm = document.getElementById('duplicate-container-form');

// Global variables
const connections = {};
window.openTerminals = {};
let activePeer = null;
window.activePeer = null; // Expose to other modules

// Initialize the app
console.log('[INFO] Client app initialized');

// Collapse Sidebar Functionality
const collapseSidebarBtn = document.getElementById('collapse-sidebar-btn');
collapseSidebarBtn.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  const btn = collapseSidebarBtn;
  btn.innerHTML = sidebar.classList.contains('collapsed') ? '&gt;' : '&lt;';
});

// Add a new connection
addConnectionForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const topicHex = newConnectionTopic.value.trim();
  if (topicHex) {
    addConnection(topicHex);
    newConnectionTopic.value = '';
  }
});

// Function to add a new connection
function addConnection(topicHex) {
    const topic = b4a.from(topicHex, 'hex');
    const topicId = topicHex.substring(0, 12);
  
    console.log(`[INFO] Adding connection with topic: ${topicHex}`);
  
    const connectionItem = document.createElement('li');
    connectionItem.className = 'list-group-item d-flex align-items-center justify-content-between';
    connectionItem.dataset.topicId = topicId;
    connectionItem.innerHTML = `
      <span>
        <span class="connection-status status-disconnected"></span>${topicId}
      </span>
  <button class="btn btn-sm btn-danger disconnect-btn">
  <i class="fas fa-plug"></i>
</button>
    `;
  
    // Add click event to switch connection
    connectionItem.querySelector('span').addEventListener('click', () => switchConnection(topicId));
  
    // Add click event to the disconnect button
    const disconnectBtn = connectionItem.querySelector('.disconnect-btn');
    disconnectBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent triggering the switch connection event
      disconnectConnection(topicId, connectionItem);
    });
  
    connectionList.appendChild(connectionItem);
  
    connections[topicId] = { topic, peer: null, swarm: null };
  
    // Create a new swarm for this connection
    const swarm = new Hyperswarm();
    connections[topicId].swarm = swarm;
  
    swarm.join(topic, { client: true, server: false });
  
    swarm.on('connection', (peer) => {
      console.log(`[INFO] Connected to peer for topic: ${topicHex}`);
  
      // Prevent duplicate connections
      if (connections[topicId].peer) {
        console.warn(`[WARN] Duplicate connection detected for topic: ${topicId}. Closing.`);
        peer.destroy();
        return;
      }
  
      connections[topicId].peer = peer;
      updateConnectionStatus(topicId, true);
  

      function handlePeerData(data, topicId, peer) {
        try {
          const response = JSON.parse(data.toString());
          console.log(`[DEBUG] Received data from peer (topic: ${topicId}): ${JSON.stringify(response)}`);
      
          if (response.type === 'containers') {
            if (window.activePeer === peer) {
              renderContainers(response.data);
            }
          } else if (response.type === 'terminalOutput') {
            appendTerminalOutput(response.data, response.containerId, response.encoding);
          } else if (response.type === 'containerConfig') {
            if (window.inspectContainerCallback) {
              window.inspectContainerCallback(response.data);
              window.inspectContainerCallback = null; // Reset the callback
            }
          } else if (response.type === 'stats') {
            updateContainerStats(response.data);
          } else if (response.error) {
            console.error(`[ERROR] Server error: ${response.error}`);
          }
        } catch (err) {
          console.error(`[ERROR] Failed to parse data from peer (topic: ${topicId}): ${err.message}`);
        }
      }

      peer.on('data', (data) => {
        // Handle incoming data
        handlePeerData(data, topicId, peer);
      });
  
      peer.on('close', () => {
        console.log(`[INFO] Disconnected from peer for topic: ${topicHex}`);
        updateConnectionStatus(topicId, false);
  
        if (window.activePeer === peer) {
          window.activePeer = null;
          connectionTitle.textContent = 'Disconnected';
          dashboard.classList.add('hidden');
          containerList.innerHTML = '';
        }
      });
  
      // If this is the first connection, switch to it
      if (!window.activePeer) {
        switchConnection(topicId);
      }
    });
  }

  function disconnectConnection(topicId, connectionItem) {
    const connection = connections[topicId];
    if (!connection) {
      console.error(`[ERROR] No connection found for topicId: ${topicId}`);
      return;
    }
  
    // Close and kill any open terminals associated with this connection
    if (window.openTerminals[topicId]) {
      console.log(`[INFO] Closing terminals for topic: ${topicId}`);
      window.openTerminals[topicId].forEach((containerId) => {
        try {
          cleanUpTerminal(containerId); // Use the terminal.js cleanup logic
        } catch (err) {
          console.error(`[ERROR] Failed to kill terminal for container ${containerId}: ${err.message}`);
        }
      });
      delete window.openTerminals[topicId];
    }
  
    // Hide the terminal modal if it is active
    const terminalModal = document.getElementById('terminal-modal');
    if (terminalModal.style.display === 'flex') {
      console.log(`[INFO] Hiding terminal modal for disconnected topic: ${topicId}`);
      terminalModal.style.display = 'none';
    }
  
    // Disconnect the peer and destroy the swarm
    if (connection.peer) {
      connection.peer.destroy();
      connection.peer = null;
    }
    if (connection.swarm) {
      connection.swarm.destroy();
      connection.swarm = null;
    }
  
    // Remove the connection from the global connections object
    delete connections[topicId];
  
    // Remove the connection item from the list
    connectionList.removeChild(connectionItem);
  
    console.log(`[INFO] Disconnected and removed connection: ${topicId}`);
  
    // Reset active peer if it was the disconnected connection
    if (window.activePeer === connection.peer) {
      window.activePeer = null;
      connectionTitle.textContent = 'Choose a Connection'; // Reset title
      dashboard.classList.add('hidden');
      containerList.innerHTML = ''; // Clear the container list
    }
  
    // Ensure the container list is cleared regardless of the active connection
    resetContainerList();
  
    // Refresh the connections view
    resetConnectionsView();
  }
  // Function to reset the container list
  function resetContainerList() {
    containerList.innerHTML = ''; // Clear the existing list
    console.log('[INFO] Container list cleared.');
  }
  
  // Function to reset the connections view
  function resetConnectionsView() {
    // Clear the connection list
    connectionList.innerHTML = '';
  
    // Re-populate the connection list from the `connections` object
    Object.keys(connections).forEach((topicId) => {
      const connectionItem = document.createElement('li');
      connectionItem.className = 'list-group-item d-flex align-items-center justify-content-between';
      connectionItem.dataset.topicId = topicId;
      connectionItem.innerHTML = `
        <span>
          <span class="connection-status ${connections[topicId].peer ? 'status-connected' : 'status-disconnected'}"></span>${topicId}
        </span>
        <button class="btn btn-sm btn-danger disconnect-btn">Disconnect</button>
      `;
  
      // Add click event to switch connection
      connectionItem.querySelector('span').addEventListener('click', () => switchConnection(topicId));
  
      // Add click event to the disconnect button
      const disconnectBtn = connectionItem.querySelector('.disconnect-btn');
      disconnectBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering the switch connection event
        disconnectConnection(topicId, connectionItem);
      });
  
      connectionList.appendChild(connectionItem);
    });
  
    console.log('[INFO] Connections view reset.');
  }

// Update connection status
function updateConnectionStatus(topicId, isConnected) {
  const connectionItem = document.querySelector(`[data-topic-id="${topicId}"] .connection-status`);
  if (connectionItem) {
    connectionItem.className = `connection-status ${isConnected ? 'status-connected' : 'status-disconnected'}`;
  }
}

// Switch between connections
function switchConnection(topicId) {
    const connection = connections[topicId];
    if (!connection) {
      console.error(`[ERROR] No connection found for topicId: ${topicId}`);
      connectionTitle.textContent = 'Choose a Connection'; // Default message
      return;
    }
  
    if (!connection.peer) {
      console.error('[ERROR] No active peer for this connection.');
      connectionTitle.textContent = 'Choose a Connection'; // Default message
      return;
    }
  
    window.activePeer = connection.peer;
    connectionTitle.textContent = `Connection: ${topicId}`;
    dashboard.classList.remove('hidden');
  
    console.log('[INFO] Sending "listContainers" command');
    sendCommand('listContainers');
  }

// Attach switchConnection to the global window object
window.switchConnection = switchConnection;

// Send a command to the active peer
function sendCommand(command, args = {}) {
  if (window.activePeer) {
    const message = JSON.stringify({ command, args });
    console.log(`[DEBUG] Sending command to server: ${message}`);
    window.activePeer.write(message);
  } else {
    console.error('[ERROR] No active peer to send command.');
  }
}

// Attach sendCommand to the global window object
window.sendCommand = sendCommand;

// Render the container list
function renderContainers(containers) {
    console.log(`[INFO] Rendering ${containers.length} containers`);
    containerList.innerHTML = ''; // Clear the current list
  
    containers.forEach((container) => {
      const name = container.Names[0].replace(/^\//, ''); // Remove leading slash from container names
      const image = container.Image;
      const containerId = container.Id;
      const row = document.createElement('tr');
      row.dataset.containerId = containerId; // Store container ID for reference
      row.innerHTML = `
        <td>${name}</td>
        <td>${image}</td>
        <td>${container.State}</td>
        <td class="cpu">0</td>
        <td class="memory">0</td>
        <td class="ip-address">-</td>
        <td>
          <button class="btn btn-success btn-sm action-start" ${container.State === 'running' ? 'disabled' : ''}>Start</button>
          <button class="btn btn-warning btn-sm action-stop" ${container.State !== 'running' ? 'disabled' : ''}>Stop</button>
          <button class="btn btn-danger btn-sm action-remove">Remove</button>
          <button class="btn btn-primary btn-sm action-terminal" ${container.State !== 'running' ? 'disabled' : ''}>Terminal</button>
          <button class="btn btn-secondary btn-sm action-duplicate">Duplicate</button>
        </td>
      `;
      containerList.appendChild(row);
  
      // Add event listeners for action buttons
      addActionListeners(row, container);
  
      // Add event listener for duplicate button
      const duplicateBtn = row.querySelector('.action-duplicate');
      duplicateBtn.addEventListener('click', () => openDuplicateModal(container));
    });
  }
  

// Add event listeners to action buttons
function addActionListeners(row, container) {
  const startBtn = row.querySelector('.action-start');
  const stopBtn = row.querySelector('.action-stop');
  const removeBtn = row.querySelector('.action-remove');
  const terminalBtn = row.querySelector('.action-terminal');

  startBtn.addEventListener('click', () => {
    sendCommand('startContainer', { id: container.Id });
  });

  stopBtn.addEventListener('click', () => {
    sendCommand('stopContainer', { id: container.Id });
  });

  removeBtn.addEventListener('click', () => {
    sendCommand('removeContainer', { id: container.Id });
  });

  terminalBtn.addEventListener('click', () => {
    startTerminal(container.Id, container.Names[0] || container.Id);
  });
}

// Function to update container statistics
function updateContainerStats(stats) {
    console.log(`[DEBUG] Updating stats for container ID: ${stats.id}`);
    let row = containerList.querySelector(`tr[data-container-id="${stats.id}"]`);
  
    if (!row) {
      console.warn(`[WARN] No row found for container ID: ${stats.id}. Adding a placeholder.`);
      // Create a placeholder row if it doesn't exist
      row = document.createElement('tr');
      row.dataset.containerId = stats.id;
      row.innerHTML = `
        <td>Unknown</td>
        <td>-</td>
        <td>-</td>
        <td class="cpu">0</td>
        <td class="memory">0</td>
        <td class="ip-address">-</td>
        <td>-</td>
      `;
      containerList.appendChild(row);
    }
  
    row.querySelector('.cpu').textContent = stats.cpu.toFixed(2);
    row.querySelector('.memory').textContent = (stats.memory / (1024 * 1024)).toFixed(2);
    row.querySelector('.ip-address').textContent = stats.ip || '-';
  }

// Function to open the Duplicate Modal with container configurations
function openDuplicateModal(container) {
    console.log(`[INFO] Opening Duplicate Modal for container: ${container.Id}`);
  
    // Send a command to get container configurations
    sendCommand('inspectContainer', { id: container.Id });
  
    // Listen for the response
    window.inspectContainerCallback = (config) => {
      if (!config) {
        alert('Failed to retrieve container configuration.');
        return;
      }
  
      console.log("TESTER: " +  config.HostConfig?.CpusetCpus)
      let CPUs = config.HostConfig?.CpusetCpus.split(",");

      // Populate the modal fields with the current configurations
      document.getElementById('container-name').value = config.Name.replace(/^\//, '');
      document.getElementById('container-hostname').value = config.Config.Hostname.replace(/^\//, '');
      document.getElementById('container-image').value = config.Config.Image;
      document.getElementById('container-netmode').value = config.HostConfig?.NetworkMode;
      document.getElementById('container-cpu').value = CPUs.length;
      document.getElementById('container-memory').value = Math.round(config.HostConfig?.Memory / (1024 * 1024));
      document.getElementById('container-config').value = JSON.stringify(config, null, 2);
  
      // Show the modal
      duplicateModal.show();
    };
  }
  

// Handle the Duplicate Container Form Submission
duplicateContainerForm.addEventListener('submit', (e) => {
    e.preventDefault();
  
    const name = document.getElementById('container-name').value.trim();
    const hostname = document.getElementById('container-hostname').value.trim();
    const image = document.getElementById('container-image').value.trim();
    const netmode = document.getElementById('container-netmode').value.trim();
    const cpu = document.getElementById('container-cpu').value.trim();
    const memory = document.getElementById('container-memory').value.trim();
    const configJSON = document.getElementById('container-config').value.trim();
  
    let config;
    try {
      config = JSON.parse(configJSON);
    } catch (err) {
      alert('Invalid JSON in configuration.');
      return;
    }
  
    console.log(`[INFO] Sending duplicateContainer command for name: ${name}`);
   
    // Send the duplicate command to the server
    sendCommand('duplicateContainer', { name, image, hostname, netmode, cpu, memory, config });
  
    // Close the modal
    duplicateModal.hide();
  
    // Trigger container list update after a short delay
    setTimeout(() => {
      console.log('[INFO] Fetching updated container list after duplication');
      sendCommand('listContainers');
    }, 2000); // Wait for duplication to complete
  });
  
  
// Attach startTerminal to the global window object
window.startTerminal = startTerminal;

// Handle window unload to clean up swarms and peers
window.addEventListener('beforeunload', () => {
  for (const topicId in connections) {
    const connection = connections[topicId];
    if (connection.peer) {
      connection.peer.destroy();
    }
    if (connection.swarm) {
      connection.swarm.destroy();
    }
  }
});