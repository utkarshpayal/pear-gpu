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

hideStatusIndicator();
let statsInterval = null;
let lastStatsUpdate = Date.now();
function stopStatsInterval() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
    console.log('[INFO] Stats interval stopped.');
  }
}


function startStatsInterval() {
  if (statsInterval) {
    clearInterval(statsInterval);
  }

  statsInterval = setInterval(() => {
    if (window.activePeer) {
      const now = Date.now();
      if (now - lastStatsUpdate >= 500) { // Ensure at least 500ms between updates
        sendCommand('stats', {}); // Adjust command if necessary
        lastStatsUpdate = now;
      }
    } else {
      console.warn('[WARN] No active peer; skipping stats request.');
    }
  }, 100); // Poll every 100ms for better reactivity
}
const smoothedStats = {}; // Container-specific smoothing storage

function smoothStats(containerId, newStats, smoothingFactor = 0.2) {
  if (!smoothedStats[containerId]) {
    smoothedStats[containerId] = { cpu: 0, memory: 0, ip: newStats.ip || 'No IP Assigned' };
  }

  smoothedStats[containerId].cpu =
    smoothedStats[containerId].cpu * (1 - smoothingFactor) +
    newStats.cpu * smoothingFactor;

  smoothedStats[containerId].memory =
    smoothedStats[containerId].memory * (1 - smoothingFactor) +
    newStats.memory * smoothingFactor;

  // Preserve the latest IP address
  smoothedStats[containerId].ip = newStats.ip || smoothedStats[containerId].ip;

  return smoothedStats[containerId];
}


function refreshContainerStats() {
  console.log('[INFO] Refreshing container stats...');
  sendCommand('listContainers'); // Request an updated container list
  startStatsInterval(); // Restart stats interval
}

function waitForPeerResponse(expectedMessageFragment, timeout = 900000) {
  console.log(`[DEBUG] Waiting for peer response with fragment: "${expectedMessageFragment}"`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    window.handlePeerResponse = (response) => {
      console.log(`[DEBUG] Received response: ${JSON.stringify(response)}`);
      if (response && response.success && response.message.includes(expectedMessageFragment)) {
        console.log(`[DEBUG] Expected response received: ${response.message}`);
        resolve(response);
      } else if (Date.now() - startTime > timeout) {
        console.warn('[WARN] Timeout while waiting for peer response');
        reject(new Error('Timeout waiting for peer response'));
      }
    };

    // Timeout fallback
    setTimeout(() => {
      console.warn('[WARN] Timed out waiting for response');
      reject(new Error('Timed out waiting for peer response'));
    }, timeout);
  });
}

// Utility functions for managing cookies
function setCookie(name, value, days = 365) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${date.toUTCString()}`;
  document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/`;
}

function getCookie(name) {
  const cookies = document.cookie.split('; ');
  for (let i = 0; i < cookies.length; i++) {
    const [key, value] = cookies[i].split('=');
    if (key === name) return decodeURIComponent(value);
  }
  return null;
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

// Load connections from cookies
function loadConnections() {
  const savedConnections = getCookie('connections');
  const connections = savedConnections ? JSON.parse(savedConnections) : {};

  // Recreate the topic Buffer from the hex string
  for (const topicId in connections) {
    const { topicHex } = connections[topicId];
    connections[topicId] = {
      topic: b4a.from(topicHex, 'hex'),
      topicHex,
      peer: null, // Initialize additional properties
      swarm: null,
    };
  }

  return connections;
}


// Save connections to cookies
function saveConnections() {
  const serializableConnections = {};

  for (const topicId in connections) {
    const { topic, topicHex } = connections[topicId]; // Only serialize simple properties
    serializableConnections[topicId] = {
      topicHex,
      topic: b4a.toString(topic, 'hex'), // Convert Buffer to hex string
    };
  }

  setCookie('connections', JSON.stringify(serializableConnections));
}


// Add Reset Connections Button
// Toggle Reset Connections Button Visibility
function toggleResetButtonVisibility() {
  const resetConnectionsBtn = document.querySelector('#sidebar .btn-danger');
  if (!resetConnectionsBtn) return;

  // Show or hide the button based on active connections
  resetConnectionsBtn.style.display = Object.keys(connections).length > 0 ? 'block' : 'none';
}

// Add Reset Connections Button
const resetConnectionsBtn = document.createElement('button');
resetConnectionsBtn.textContent = 'Reset Connections';
resetConnectionsBtn.className = 'btn btn-danger w-100 mt-2';
resetConnectionsBtn.addEventListener('click', () => {
  console.log('[INFO] Resetting connections and clearing cookies.');
  Object.keys(connections).forEach((topicId) => {
    disconnectConnection(topicId);
  });
  deleteCookie('connections');
  resetConnectionsView();
  showWelcomePage();
  toggleResetButtonVisibility(); // Ensure button visibility is updated
});
document.getElementById('sidebar').appendChild(resetConnectionsBtn);



// Initialize the app
console.log('[INFO] Client app initialized');
// Load connections from cookies and restore them
document.addEventListener('DOMContentLoaded', () => {
  const savedConnections = loadConnections();
  console.log('[INFO] Restoring saved connections:', savedConnections);

  // Restore saved connections
  Object.keys(savedConnections).forEach((topicId) => {
    let topicHex = savedConnections[topicId].topic;

    // Ensure topicHex is a string
    if (typeof topicHex !== 'string') {
      topicHex = b4a.toString(topicHex, 'hex');
    }

    addConnection(topicHex);
  });

  if (Object.keys(connections).length > 0) {
    hideWelcomePage();
  } else {
    showWelcomePage();
  }

  assertVisibility(); // Ensure visibility reflects the restored connections
});

// Show Status Indicator
// Modify showStatusIndicator to recreate it dynamically
function showStatusIndicator(message = 'Processing...') {
  const statusIndicator = document.createElement('div');
  statusIndicator.id = 'status-indicator';
  statusIndicator.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex justify-content-center align-items-center bg-dark bg-opacity-75';
  statusIndicator.innerHTML = `
    <div class="text-center">
      <div class="spinner-border text-light" role="status">
        <span class="visually-hidden">Loading...</span>
      </div>
      <p class="mt-3 text-light">${message}</p>
    </div>
  `;
  document.body.appendChild(statusIndicator);
}

function hideStatusIndicator() {
  const statusIndicator = document.getElementById('status-indicator');
  if (statusIndicator) {
    console.log('[DEBUG] Hiding status indicator');
    statusIndicator.remove();
  } else {
    console.error('[ERROR] Status indicator element not found!');
  }
}
// Show Alert
function showAlert(type, message) {
  const alertContainer = document.getElementById('alert-container');

  // Create alert element
  const alert = document.createElement('div');
  alert.className = `alert ${type}`;
  alert.innerHTML = `
    <span>${message}</span>
    <button class="close-btn" aria-label="Close">&times;</button>
  `;

  // Add close button functionality
  const closeButton = alert.querySelector('.close-btn');
  closeButton.addEventListener('click', () => {
    alert.remove(); // Remove alert on close
  });

  // Append alert to container
  alertContainer.appendChild(alert);

  // Automatically remove alert after 5 seconds
  setTimeout(() => {
    alert.remove();
  }, 5000);
}


// Collapse Sidebar Functionality
const collapseSidebarBtn = document.getElementById('collapse-sidebar-btn');
collapseSidebarBtn.addEventListener('click', () => {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  const btn = collapseSidebarBtn;
  btn.innerHTML = sidebar.classList.contains('collapsed') ? '&gt;' : '&lt;';

  // Toggle Reset Connections Button Visibility
  const resetConnectionsBtn = document.querySelector('#sidebar .btn-danger');
  resetConnectionsBtn.style.display = sidebar.classList.contains('collapsed') ? 'none' : 'block';
});

function handlePeerData(data, topicId, peer) {
  try {
    // Parse the incoming data
    const response = JSON.parse(data.toString());
    console.log(`[DEBUG] Received data from peer (topic: ${topicId}): ${JSON.stringify(response)}`);

    // Ensure the data is for the active connection
    if (!connections[topicId]) {
      console.warn(`[WARN] No connection found for topic: ${topicId}. Ignoring data.`);
      return;
    }

    if (peer !== connections[topicId].peer) {
      console.warn(`[WARN] Ignoring data from a non-active peer for topic: ${topicId}`);
      return;
    }

    // Delegate handling based on the response type
    switch (response.type) {
      case 'stats':
        console.log('[INFO] Updating container stats...');
        
        // Ensure IP is included and passed to updateContainerStats
        const stats = response.data;
        stats.ip = stats.ip || 'No IP Assigned'; // Add a fallback for missing IPs
        console.log(`[DEBUG] Passing stats to updateContainerStats: ${JSON.stringify(stats, null, 2)}`);
        updateContainerStats(stats);
        break;

      case 'containers':
        console.log('[INFO] Processing container list...');
        renderContainers(response.data, topicId); // Render containers specific to this topic
        break;

      case 'terminalOutput':
        console.log('[INFO] Appending terminal output...');
        appendTerminalOutput(response.data, response.containerId, response.encoding);
        break;

      case 'containerConfig':
        console.log('[INFO] Handling container configuration...');
        if (window.inspectContainerCallback) {
          window.inspectContainerCallback(response.data);
          window.inspectContainerCallback = null; // Reset the callback
        }
        break;

      default:
        console.warn(`[WARN] Unhandled response type: ${response.type}`);
        break;
    }

    // Handle peer response callback if defined
    if (typeof window.handlePeerResponse === 'function') {
      window.handlePeerResponse(response);
    }
  } catch (err) {
    // Catch and log any parsing or processing errors
    console.error(`[ERROR] Failed to process peer data: ${err.message}`);
    console.error(`[DEBUG] Raw data received: ${data.toString()}`);
    showAlert('danger', 'Failed to process peer data. Check the console for details.');
  }
}






// Add a new connection
addConnectionForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const topicHex = newConnectionTopic.value.trim();
  if (topicHex) {
    addConnection(topicHex);
    newConnectionTopic.value = '';
  }
});

function addConnection(topicHex) {
  console.log(`[DEBUG] Adding connection with topic: ${topicHex}`);

  if (Object.keys(connections).length === 0) {
    hideWelcomePage();
  }

  const topic = b4a.from(topicHex, 'hex');
  const topicId = topicHex.substring(0, 12);

  connections[topicId] = { topic, peer: null, swarm: null, topicHex };
  saveConnections(); // Save updated connections to cookies

  const connectionItem = document.createElement('li');
  connectionItem.className = 'list-group-item d-flex align-items-center justify-content-between';
  connectionItem.dataset.topicId = topicId;
  connectionItem.innerHTML = `
  <span>
    <span class="connection-status status-disconnected"></span>${topicId}
  </span>
  <div class="btn-group">
    <button class="btn btn-sm btn-primary docker-terminal-btn">
      <i class="fas fa-terminal"></i>
    </button>
    <button class="btn btn-sm btn-danger disconnect-btn">
      <i class="fas fa-plug"></i>
    </button>
  </div>
`;

// Add Docker Terminal button event listener
connectionItem.querySelector('.docker-terminal-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const connection = connections[topicId];
  if (connection && connection.peer) {
    import('./libs/dockerTerminal.js').then(({ startDockerTerminal }) => {
      startDockerTerminal(topicId, connection.peer);
    });
  } else {
    console.error('[ERROR] No active peer for Docker CLI terminal.');
  }
})
  connectionItem.querySelector('span').addEventListener('click', () => switchConnection(topicId));
  connectionItem.querySelector('.disconnect-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    disconnectConnection(topicId, connectionItem);
  });
  refreshContainerStats();

  connectionList.appendChild(connectionItem);

  const swarm = new Hyperswarm();
  connections[topicId].swarm = swarm;

  swarm.join(topic, { client: true, server: false });

  swarm.on('connection', (peer) => {
    console.log(`[INFO] Connected to peer for topic: ${topicHex}`);
    if (connections[topicId].peer) {
      peer.destroy();
      return;
    }
    connections[topicId].peer = peer;
    updateConnectionStatus(topicId, true);

    peer.on('data', (data) => handlePeerData(data, topicId, peer));
    peer.on('close', () => {
      updateConnectionStatus(topicId, false);
      if (window.activePeer === peer) {
        window.activePeer = null;
        dashboard.classList.add('hidden');
        containerList.innerHTML = '';
        stopStatsInterval(); // Stop stats polling
      }
    });
    if (!window.activePeer) {
      switchConnection(topicId);
    }
    startStatsInterval();
  });

  // Collapse the sidebar after adding a connection
  const sidebar = document.getElementById('sidebar');
  const collapseSidebarBtn = document.getElementById('collapse-sidebar-btn');
  if (!sidebar.classList.contains('collapsed')) {
    sidebar.classList.add('collapsed');
    collapseSidebarBtn.innerHTML = '&gt;';
    console.log('[DEBUG] Sidebar collapsed after adding connection');
  }
}


// Initialize connections from cookies on page load
document.addEventListener('DOMContentLoaded', () => {
  const savedConnections = loadConnections();
  console.log('[INFO] Loading saved connections:', savedConnections);

  Object.keys(savedConnections).forEach((topicId) => {
    const topicHex = savedConnections[topicId].topic;
    addConnection(topicHex);
  });

  if (Object.keys(connections).length > 0) {
    hideWelcomePage();
    startStatsInterval(); // Start stats polling for active peers
  } else {
    showWelcomePage();
  }

  assertVisibility();
});


function disconnectConnection(topicId, connectionItem) {
  const connection = connections[topicId];
  if (!connection) {
    console.error(`[ERROR] No connection found for topicId: ${topicId}`);
    return;
  }

  // Clean up terminals
  if (window.openTerminals[topicId]) {
    console.log(`[INFO] Closing terminals for topic: ${topicId}`);
    window.openTerminals[topicId].forEach((terminalId) => {
      try {
        cleanUpTerminal(terminalId);
      } catch (err) {
        console.error(`[ERROR] Failed to clean up terminal ${terminalId}: ${err.message}`);
      }
    });
    delete window.openTerminals[topicId];
  }

  // Destroy the peer and swarm
  if (connection.peer) {
    connection.peer.destroy();
  }
  if (connection.swarm) {
    connection.swarm.destroy();
  }

  // Remove from global connections
  delete connections[topicId];

  // Save the updated connections to cookies
  saveConnections();

  // Remove the connection item from the UI
  if (connectionItem) {
    connectionList.removeChild(connectionItem);
  }

  // Reset the connection title if this was the active peer
  if (window.activePeer === connection.peer) {
    window.activePeer = null;

    const connectionTitle = document.getElementById('connection-title');
    if (connectionTitle) {
      connectionTitle.textContent = 'Choose a Connection'; // Reset the title
    }

    const dashboard = document.getElementById('dashboard');
    if (dashboard) {
      dashboard.classList.add('hidden');
    }

    resetContainerList(); // Clear containers
  }

  // Show welcome page if no connections remain
  if (Object.keys(connections).length === 0) {
    showWelcomePage();
  }

  console.log(`[INFO] Disconnected and removed connection: ${topicId}`);
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

  if (!connection || !connection.peer) {
    console.error('[ERROR] No connection found or no active peer.');
    showWelcomePage();
    stopStatsInterval(); // Stop stats interval if no active peer
    return;
  }

  // Update the active peer
  window.activePeer = connection.peer;

  // Clear container list before loading new data
  resetContainerList();

  console.log(`[INFO] Switched to connection: ${topicId}`);
  
  // Start the stats interval
  startStatsInterval();

  sendCommand('listContainers'); // Request containers for the new connection
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
function renderContainers(containers, topicId) {
  if (!window.activePeer || !connections[topicId] || window.activePeer !== connections[topicId].peer) {
    console.warn('[WARN] Active peer mismatch or invalid connection. Skipping container rendering.');
    return;
  }

  console.log(`[INFO] Rendering ${containers.length} containers for topic: ${topicId}`);
  containerList.innerHTML = ''; // Clear the current list

  containers.forEach((container) => {
    const name = container.Names[0]?.replace(/^\//, '') || 'Unknown'; // Avoid undefined Names
    const image = container.Image || '-';
    const containerId = container.Id;
    const ipAddress = container.ipAddress || 'No IP Assigned';
    if (ipAddress === 'No IP Assigned') {
      console.warn(`[WARN] IP address missing for container ${container.Id}. Retrying...`);
      sendCommand('inspectContainer', { id: container.Id });
    }

    const row = document.createElement('tr');
    row.dataset.containerId = containerId; // Store container ID for reference
    row.innerHTML = `
      <td>${name}</td>
      <td>${image}</td>
      <td>${container.State || 'Unknown'}</td>
      <td class="cpu">0</td>
      <td class="memory">0</td>
      <td class="ip-address">${ipAddress}</td>
      <td>
        <button class="btn btn-success btn-sm action-start" ${container.State === 'running' ? 'disabled' : ''}>
          <i class="fas fa-play"></i>
        </button>
        <button class="btn btn-info btn-sm action-restart" ${container.State !== 'running' ? 'disabled' : ''}>
          <i class="fas fa-redo"></i>
        </button>
        <button class="btn btn-warning btn-sm action-stop" ${container.State !== 'running' ? 'disabled' : ''}>
          <i class="fas fa-stop"></i>
        </button>
        <button class="btn btn-danger btn-sm action-remove">
          <i class="fas fa-trash"></i>
        </button>
        <button class="btn btn-primary btn-sm action-terminal" ${container.State !== 'running' ? 'disabled' : ''}>
          <i class="fas fa-terminal"></i>
        </button>
        <button class="btn btn-secondary btn-sm action-duplicate">
          <i class="fas fa-clone"></i>
        </button>
      </td>
    `;
    containerList.appendChild(row);
    // Add event listener for duplicate button
    const duplicateBtn = row.querySelector('.action-duplicate');
    duplicateBtn.addEventListener('click', () => openDuplicateModal(container));
    // Add event listeners for action buttons
    addActionListeners(row, container);
  });
}



function addActionListeners(row, container) {
  const startBtn = row.querySelector('.action-start');
  const stopBtn = row.querySelector('.action-stop');
  const removeBtn = row.querySelector('.action-remove');
  const terminalBtn = row.querySelector('.action-terminal');
  const restartBtn = row.querySelector('.action-restart');

  // Start Button
  startBtn.addEventListener('click', async () => {
    showStatusIndicator(`Starting container "${container.Names[0]}"...`);
    sendCommand('startContainer', { id: container.Id });
  
    const expectedMessageFragment = `Container ${container.Id} started`;
  
    try {
      const response = await waitForPeerResponse(expectedMessageFragment);
      console.log('[DEBUG] Start container response:', response);
  
      showAlert('success', response.message);
  
      // Refresh the container list to update states
      sendCommand('listContainers');
  
      // Restart stats interval
      startStatsInterval();
    } catch (error) {
      console.error('[ERROR] Failed to start container:', error.message);
      showAlert('danger', error.message || 'Failed to start container.');
    } finally {
      console.log('[DEBUG] Hiding status indicator in startBtn finally block');
      hideStatusIndicator();
    }
  });
  

  stopBtn.addEventListener('click', async () => {
    showStatusIndicator(`Stopping container "${container.Names[0]}"...`);
    sendCommand('stopContainer', { id: container.Id });
  
    const expectedMessageFragment = `Container ${container.Id} stopped`;
  
    try {
      const response = await waitForPeerResponse(expectedMessageFragment);
      console.log('[DEBUG] Stop container response:', response);
  
      showAlert('success', response.message);
  
      // Refresh the container list to update states
      sendCommand('listContainers');
  
      // Restart stats interval
      startStatsInterval();
    } catch (error) {
      console.error('[ERROR] Failed to stop container:', error.message);
      showAlert('danger', error.message || 'Failed to stop container.');
    } finally {
      console.log('[DEBUG] Hiding status indicator in stopBtn finally block');
      hideStatusIndicator();
    }
  });
  


  // Restart Button
  restartBtn.addEventListener('click', async () => {
    showStatusIndicator(`Restarting container "${container.Names[0]}"...`);
    sendCommand('restartContainer', { id: container.Id });

    const expectedMessageFragment = `Container ${container.Id} restarted`;

    try {
      const response = await waitForPeerResponse(expectedMessageFragment);
      console.log('[DEBUG] Restart container response:', response);

      showAlert('success', response.message);

      // Refresh the container list to update states
      sendCommand('listContainers');
    } catch (error) {
      console.error('[ERROR] Failed to restart container:', error.message);
      showAlert('danger', error.message || 'Failed to restart container.');
    } finally {
      console.log('[DEBUG] Hiding status indicator in restartBtn finally block');
      hideStatusIndicator();
    }
  });


  // Remove Button
  removeBtn.addEventListener('click', async () => {
    const deleteModal = new bootstrap.Modal(document.getElementById('deleteModal'));
    deleteModal.show();

    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    confirmDeleteBtn.onclick = async () => {
      deleteModal.hide();

      showStatusIndicator(`Deleting container "${container.Names[0]}"...`);

      // Check if the container has active terminals
      if (window.openTerminals[container.Id]) {
        console.log(`[INFO] Closing active terminals for container: ${container.Id}`);
        window.openTerminals[container.Id].forEach((terminalId) => {
          try {
            cleanUpTerminal(terminalId);
          } catch (err) {
            console.error(`[ERROR] Failed to clean up terminal ${terminalId}: ${err.message}`);
          }
        });
        delete window.openTerminals[container.Id];
      }

      // Hide the terminal modal if it is active
      const terminalModal = document.getElementById('terminal-modal');
      if (terminalModal.style.display === 'flex') {
        console.log(`[INFO] Hiding terminal modal for container: ${container.Id}`);
        terminalModal.style.display = 'none';
      }


      terminalModal.addEventListener('shown.bs.modal', () => {
        terminal.focus();
      });

      sendCommand('removeContainer', { id: container.Id });

      const expectedMessageFragment = `Container ${container.Id} removed`;

      try {
        const response = await waitForPeerResponse(expectedMessageFragment);
        console.log('[DEBUG] Remove container response:', response);

        showAlert('success', response.message);

        // Refresh the container list to update states
        sendCommand('listContainers');
      } catch (error) {
        console.error('[ERROR] Failed to delete container:', error.message);
        showAlert('danger', error.message || `Failed to delete container "${container.Names[0]}".`);
      } finally {
        console.log('[DEBUG] Hiding status indicator in removeBtn finally block');
        hideStatusIndicator();
      }
    };
  });


  terminalBtn.addEventListener('click', () => {
    console.log(`[DEBUG] Opening terminal for container ID: ${container.Id}`);
    try {
      startTerminal(container.Id, container.Names[0] || container.Id);
    } catch (error) {
      console.error(`[ERROR] Failed to start terminal for container ${container.Id}: ${error.message}`);
      showAlert('danger', `Failed to start terminal: ${error.message}`);
    }
  });
}


function updateContainerStats(stats) {
  if (!stats || !stats.id || typeof stats.cpu === 'undefined' || typeof stats.memory === 'undefined') {
    console.error('[ERROR] Invalid stats object:', stats);
    return;
  }

  console.log(`[DEBUG] Updating stats for container ID: ${stats.id}`);

  const row = containerList.querySelector(`tr[data-container-id="${stats.id}"]`);
  if (!row) {
    console.warn(`[WARN] No matching row for container ID: ${stats.id}`);
    return;
  }

  // Ensure the IP address is added or retained from existing row
  const existingIpAddress = row.querySelector('.ip-address')?.textContent || 'No IP Assigned';
  stats.ip = stats.ip || existingIpAddress;

  const smoothed = smoothStats(stats.id, stats);
  updateStatsUI(row, smoothed);
}

function updateStatsUI(row, stats) {
  requestIdleCallback(() => {
    row.querySelector('.cpu').textContent = stats.cpu.toFixed(2) || '0.00';
    row.querySelector('.memory').textContent = (stats.memory / (1024 * 1024)).toFixed(2) || '0.00';
    row.querySelector('.ip-address').textContent = stats.ip;
  });
}


// Function to open the Duplicate Modal with container configurations
function openDuplicateModal(container) {
  console.log(`[INFO] Opening Duplicate Modal for container: ${container.Id}`);

  showStatusIndicator('Fetching container configuration...');

  // Send a command to inspect the container
  sendCommand('inspectContainer', { id: container.Id });

  // Listen for the inspectContainer response
  window.inspectContainerCallback = (config) => {
    hideStatusIndicator();

    if (!config) {
      console.error('[ERROR] Failed to retrieve container configuration.');
      showAlert('danger', 'Failed to retrieve container configuration.');
      return;
    }

    console.log(`[DEBUG] Retrieved container configuration: ${JSON.stringify(config)}`);

    // Parse configuration and populate the modal fields
    try {
      const CPUs = config.HostConfig?.CpusetCpus?.split(',') || [];

      document.getElementById('container-name').value = config.Name.replace(/^\//, '');
      document.getElementById('container-hostname').value = config.Config.Hostname || '';
      document.getElementById('container-image').value = config.Config.Image || '';
      document.getElementById('container-netmode').value = config.HostConfig?.NetworkMode || '';
      document.getElementById('container-cpu').value = CPUs.length || 0;
      document.getElementById('container-memory').value = Math.round(config.HostConfig?.Memory / (1024 * 1024)) || 0;
      document.getElementById('container-config').value = JSON.stringify(config, null, 2);

      // Show the duplicate modal
      duplicateModal.show();
    } catch (error) {
      console.error(`[ERROR] Failed to populate modal fields: ${error.message}`);
      showAlert('danger', 'Failed to populate container configuration fields.');
    }
  };
}


// Handle the Duplicate Container Form Submission
duplicateContainerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  duplicateModal.hide();

  showStatusIndicator('Duplicating container...');

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
    hideStatusIndicator();
    showAlert('danger', 'Invalid JSON in configuration.');
    return;
  }

  sendCommand('duplicateContainer', { name, image, hostname, netmode, cpu, memory, config });

  // Simulate delay for the demo
  setTimeout(() => {
    hideStatusIndicator();
    showAlert('success', 'Container duplicated successfully!');

    // Refresh container list
    sendCommand('listContainers');
  }, 2000); // Simulated processing time
});


function showWelcomePage() {
  const welcomePage = document.getElementById('welcome-page');
  const dashboard = document.getElementById('dashboard');
  const connectionTitle = document.getElementById('connection-title');

  if (welcomePage) {
    welcomePage.classList.remove('hidden');
  }

  if (dashboard) {
    dashboard.classList.add('hidden');
  }

  if (connectionTitle) {
    connectionTitle.textContent = '󠀠';
  } else {
    console.warn('[WARN] Connection title element not found!');
  }
}

function hideWelcomePage() {
  const welcomePage = document.getElementById('welcome-page');
  const dashboard = document.getElementById('dashboard');

  if (welcomePage) {
    console.log('[DEBUG] Hiding welcome page');
    welcomePage.classList.add('hidden'); // Hide the welcome page
  } else {
    console.error('[ERROR] Welcome page element not found!');
  }

  if (dashboard) {
    console.log('[DEBUG] Showing dashboard');
    dashboard.classList.remove('hidden'); // Show the dashboard
  } else {
    console.error('[ERROR] Dashboard element not found!');
  }
}

function assertVisibility() {
  const welcomePage = document.getElementById('welcome-page');
  const dashboard = document.getElementById('dashboard');
  if (Object.keys(connections).length === 0) {
    console.assert(!welcomePage.classList.contains('hidden'), '[ASSERTION FAILED] Welcome page should be visible.');
    console.assert(dashboard.classList.contains('hidden'), '[ASSERTION FAILED] Dashboard should be hidden.');
  } else {
    console.assert(welcomePage.classList.contains('hidden'), '[ASSERTION FAILED] Welcome page should be hidden.');
    console.assert(!dashboard.classList.contains('hidden'), '[ASSERTION FAILED] Dashboard should be visible.');
  }
}
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