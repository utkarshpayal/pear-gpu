// DOM Elements
const templateList = document.getElementById('template-list');
const templateSearchInput = document.getElementById('template-search-input');
const templateDeployModal = new bootstrap.Modal(document.getElementById('templateDeployModalUnique'));
const deployForm = document.getElementById('deploy-form');
let templates = [];

// Function to close all modals
function closeAllModals() {
    const modals = document.querySelectorAll('.modal.show');
    modals.forEach(modal => {
        const modalInstance = bootstrap.Modal.getInstance(modal);
        if (modalInstance) modalInstance.hide();
    });
}

// Show status indicator
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

// Hide status indicator
function hideStatusIndicator() {
    const statusIndicator = document.getElementById('status-indicator');
    if (statusIndicator) {
        console.log('[DEBUG] Hiding status indicator');
        statusIndicator.remove();
    } else {
        console.error('[ERROR] Status indicator element not found!');
    }
}

// Show alert message
function showAlert(type, message) {
    const alertBox = document.createElement('div');
    alertBox.className = `alert alert-${type}`;
    alertBox.textContent = message;

    const container = document.querySelector('#alert-container');
    if (container) {
        container.appendChild(alertBox);

        setTimeout(() => {
            container.removeChild(alertBox);
        }, 5000);
    } else {
        console.warn('[WARN] Alert container not found.');
    }
}

// Fetch templates from the URL
async function fetchTemplates() {
    try {
        const response = await fetch('https://raw.githubusercontent.com/Lissy93/portainer-templates/main/templates.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        templates = data.templates || []; // Update global templates
        displayTemplateList(templates);
    } catch (error) {
        console.error('[ERROR] Failed to fetch templates:', error.message);
        showAlert('danger', 'Failed to load templates.');
    }
}

// Filter templates by search input
templateSearchInput.addEventListener('input', () => {
    const searchQuery = templateSearchInput.value.toLowerCase();
    const filteredTemplates = templates.filter(template =>
        template.title.toLowerCase().includes(searchQuery) ||
        template.description.toLowerCase().includes(searchQuery)
    );
    displayTemplateList(filteredTemplates);
});

// Display templates in the list
function displayTemplateList(templates) {
    templateList.innerHTML = '';
    templates.forEach(template => {
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item d-flex justify-content-between align-items-center';
        listItem.innerHTML = `
      <div>
        <img src="${template.logo || ''}" alt="Logo" class="me-2" style="width: 24px; height: 24px;">
        <span>${template.title}</span>
      </div>
      <button class="btn btn-primary btn-sm deploy-btn">Deploy</button>
    `;
        listItem.querySelector('.deploy-btn').addEventListener('click', () => openDeployModal(template));
        templateList.appendChild(listItem);
    });
}

// Filter templates by search input
templateSearchInput.addEventListener('input', () => {
    const searchQuery = templateSearchInput.value.toLowerCase();
    const filteredTemplates = templates.filter(template =>
        template.title.toLowerCase().includes(searchQuery) ||
        template.description.toLowerCase().includes(searchQuery)
    );
    displayTemplateList(filteredTemplates);
});

// Open deploy modal and populate the form dynamically
function openDeployModal(template) {
    console.log('[DEBUG] Opening deploy modal for:', template);

    // Set the modal title
    const deployTitle = document.getElementById('deploy-title');
    deployTitle.textContent = `Deploy ${template.title}`;

    // Populate the image name
    const deployImage = document.getElementById('deploy-image');
    deployImage.value = template.image || '';

    // Populate ports
    const deployPorts = document.getElementById('deploy-ports');
    deployPorts.value = (template.ports || []).join(', ');

    // Populate volumes
    const deployVolumes = document.getElementById('deploy-volumes');
    deployVolumes.value = (template.volumes || [])
        .map(volume => `${volume.bind}:${volume.container}`)
        .join(', ');

    // Add environment variables
    const deployEnv = document.getElementById('deploy-env');
    deployEnv.innerHTML = '';
    (template.env || []).forEach(env => {
        const envRow = document.createElement('div');
        envRow.className = 'mb-3';
        envRow.innerHTML = `
        <label>${env.label || env.name}</label>
        <input type="text" class="form-control" data-env-name="${env.name}" value="${env.default || ''}">
      `;
        deployEnv.appendChild(envRow);
    });

    // Add Container Name field
    const containerNameField = document.getElementById('deploy-container-name');
    containerNameField.value = ''; // Clear previous value, if any

    // Show the modal
    templateDeployModal.show();
}

// Deploy Docker container
// Deploy Docker container
async function deployDockerContainer(payload) {
    const { containerName, imageName, ports = [], volumes = [], envVars = [] } = payload;

    const validPorts = ports.filter(port => {
        if (!port || !port.includes('/')) {
            console.warn(`[WARN] Invalid port entry skipped: ${port}`);
            return false;
        }
        return true;
    });

    const validVolumes = volumes.filter(volume => {
        if (!volume || !volume.includes(':')) {
            console.warn(`[WARN] Invalid volume entry skipped: ${volume}`);
            return false;
        }
        return true;
    });

    console.log('[INFO] Sending deployment command to the server...');
    sendCommand('deployContainer', {
        containerName,
        image: imageName,
        ports: validPorts,
        volumes: validVolumes,
        env: envVars.map(({ name, value }) => ({ name, value })),
    });
}

// Example of how to dispatch the event when the server response is received
function handleServerResponse(serverResponse) {
    console.log('[DEBUG] Dispatching server response:', serverResponse);
    const responseEvent = new CustomEvent('responseReceived', { detail: serverResponse });
    window.dispatchEvent(responseEvent);
}

// Integration for server response handling
// Ensure this function is called whenever a server response is received
async function processServerMessage(response) {
    if (response.type === 'deployResult') {
        handleServerResponse(response);
    }
}

// Handle form submission for deployment
// Handle form submission for deployment
deployForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const containerName = document.getElementById('deploy-container-name').value.trim();
    const imageName = document.getElementById('deploy-image').value.trim();
    const ports = document.getElementById('deploy-ports').value.split(',').map(port => port.trim());
    const volumes = document.getElementById('deploy-volumes').value.split(',').map(volume => volume.trim());
    const envInputs = document.querySelectorAll('#deploy-env input');
    const envVars = Array.from(envInputs).map(input => ({
        name: input.getAttribute('data-env-name'),
        value: input.value.trim(),
    }));

    const deployPayload = { containerName, imageName, ports, volumes, envVars };

    console.log('[DEBUG] Deploy payload:', deployPayload);

    try {
        showStatusIndicator('Deploying container...');
        closeAllModals();
        // Send the deployment request
        await deployDockerContainer(deployPayload);

        // Wait for a specific response
        // Wait for the specific response

        console.log('[INFO] Deployment success:', successResponse);
        hideStatusIndicator();
        showAlert('success', successResponse.message);
    } catch (error) {
        console.error('[ERROR] Failed to deploy container:', error.message);
        hideStatusIndicator();
        showAlert('danger', error.message);
    }
});
// Initialize templates on load
document.addEventListener('DOMContentLoaded', fetchTemplates);

// Export required functions
export { fetchTemplates, displayTemplateList, openDeployModal };
