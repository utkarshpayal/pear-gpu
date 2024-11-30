const rdp = require('node-rdp');

// Open the RDP Modal
function openRdpModal(containerId, containerName, ip) {
  console.log(`[INFO] Opening RDP modal for container: ${containerId}`);
  const rdpModal = document.getElementById('rdp-modal');
  const rdpTitle = document.getElementById('rdp-title');
  const rdpInputIP = document.getElementById('rdp-input-ip');
  const rdpInputPort = document.getElementById('rdp-input-port');

  rdpTitle.textContent = `RDP Session: ${containerName}`;
  rdpInputIP.value = ip || '';
  rdpInputPort.value = '3389'; // Default RDP port

  rdpModal.style.display = 'flex';

  // Save container details for later use
  window.activeRdpSession = { containerId, containerName };
}

// Start the RDP session
function startRdpSession() {
  const rdpInputIP = document.getElementById('rdp-input-ip').value.trim();
  const rdpInputPort = document.getElementById('rdp-input-port').value.trim();
  const rdpUsername = document.getElementById('rdp-username').value.trim();
  const rdpPassword = document.getElementById('rdp-password').value.trim();

  if (!rdpInputIP || !rdpUsername || !rdpPassword) {
    alert('Please fill in all required fields (IP, Username, Password).');
    return;
  }

  const address = `${rdpInputIP}:${rdpInputPort}`;
  console.log(`[INFO] Starting RDP session to ${address}`);

  rdp({
    address,
    username: rdpUsername,
    password: rdpPassword,
    fullscreen: true, // Default to fullscreen
  })
    .then(() => {
      console.log('[INFO] RDP session terminated.');
      alert('RDP session ended.');
    })
    .catch((err) => {
      console.error('[ERROR] RDP session error:', err);
      alert(`Failed to start RDP session: ${err.message}`);
    });
}

// Close the RDP Modal
function closeRdpModal() {
  console.log('[INFO] Closing RDP modal');
  const rdpModal = document.getElementById('rdp-modal');
  rdpModal.style.display = 'none';
  window.activeRdpSession = null;
}

// Export functions
export { openRdpModal, startRdpSession, closeRdpModal };
