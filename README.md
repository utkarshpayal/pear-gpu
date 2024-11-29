# Peartainer

## Overview

Peartainer is a decentralized, peer-to-peer application designed to streamline Docker container management using Hyperswarm. The application connects multiple peers over a distributed hash table (DHT) network and provides full control over Docker containers, including starting, stopping, removing, duplicating, and monitoring real-time metrics. With its robust server key-based architecture, Peartainer ensures secure and persistent peer-to-peer communication.

The **server key** forms the foundation of the connection. It is automatically generated, saved, and reused unless explicitly refreshed, making it easy to maintain consistent access while allowing for manual key regeneration when needed.

In addition to a development environment, the client app can be run in **production mode** directly via Pear with the following command:

```bash
pear run pear://7to8bzrk53ab5ufwauqcw57s1kxmuykc9b8cdnjicaqcgoefa4wo
```

---

## Key Features

### Server-Side

- **Persistent Server Key**:
  - Generates a `SERVER_KEY` for each instance.
  - The key is saved to `.env` for consistent re-use.
  - Supports manual key regeneration by deleting `.env`.

- **Real-Time Docker Management**:
  - List all containers across peers with statuses.
  - Start, stop, and remove containers remotely.

- **Dynamic Terminal Sessions**:
  - Open and manage multiple terminals for running containers.
  - Real-time shell sessions streamed to connected peers.

- **Container Duplication**:
  - Clone containers with custom configurations for CPUs, memory, network mode, and hostname.

- **Live Statistics Streaming**:
  - Broadcast CPU, memory, and network stats in real-time to connected peers.

### Client-Side

- **Peer-to-Peer Networking**:
  - Connects to servers using unique server keys via Hyperswarm.
  - Fully decentralized; no central server is required.

- **Interactive User Interface**:
  - Modern, responsive UI built with **Bootstrap**.
  - Integrated terminal viewer powered by **Xterm.js**.
  - Real-time container stats displayed for each container.

- **Production Deployment**:
  - Ready-to-use client app available via Pear runtime:
    ```bash
    pear run pear://7to8bzrk53ab5ufwauqcw57s1kxmuykc9b8cdnjicaqcgoefa4wo
    ```

---

## How It Works

### Server Key Architecture

The server is initialized with a `SERVER_KEY` that uniquely identifies the network. This key is essential for peers to connect and interact with the server.

- **Key Generation**:
  - On the first run, the server checks for an existing `SERVER_KEY` in the `.env` file. If absent, a new key is generated:
    ```javascript
    function generateNewKey() {
      const newKey = crypto.randomBytes(32);
      fs.appendFileSync('.env', `SERVER_KEY=${newKey.toString('hex')}\n`, { flag: 'a' });
      return newKey;
    }
    ```
  - The key is saved to `.env` for persistence.

- **Key Usage**:
  - The server uses the key to generate a topic buffer for Hyperswarm:
    ```javascript
    const topic = Buffer.from(keyHex, 'hex');
    swarm.join(topic, { server: true, client: false });
    ```

- **Key Refresh**:
  - To regenerate the key, delete the `.env` file and restart the server.

### Peer Connections

Peers connect to the server using the unique topic derived from the `SERVER_KEY`. The Hyperswarm network ensures secure, low-latency connections.

- **Connecting**:
  - Each client app connects to the server by joining the topic buffer:
    ```javascript
    const topicBuffer = b4a.from(topicHex, 'hex');
    swarm.join(topicBuffer, { client: true, server: true });
    ```

- **Communication**:
  - Commands (e.g., `listContainers`, `startContainer`) are sent as JSON over the connection.
  - Responses and real-time updates are broadcast back to peers.

### Docker Integration

The server interacts with Docker using **Dockerode**:

- List containers:
  ```javascript
  const containers = await docker.listContainers({ all: true });
  ```
- Start a container:
  ```javascript
  await docker.getContainer(containerId).start();
  ```
- Stream statistics:
  ```javascript
  container.stats({ stream: true }, (err, stream) => {
    stream.on('data', (data) => {
      const stats = JSON.parse(data.toString());
      broadcastToPeers({ type: 'stats', data: stats });
    });
  });
  ```

---

## Installation

### Prerequisites

1. **Docker**:
   - Install Docker and ensure it is running.
   - For Linux, add your user to the Docker group:
     ```bash
     sudo usermod -aG docker $USER
     ```
     Log out and back in for changes to take effect.

2. **Node.js**:
   - Install Node.js v16 or higher:
     ```bash
     sudo apt install nodejs npm
     ```

3. **Pear**:
   - Install the Pear runtime for running the client and server:
     ```bash
     npm install -g pear
     ```

---

### Server Setup

1. Clone the repository:
   ```bash
   git clone https://git.ssh.surf/snxraven/peartainer.git
   cd peartainer
   ```

2. Change to server Dir:
   ```bash
   cd server
   ```

3. npm install:
   ```bash
   npm install hyperswarm dockerode hypercore-crypto stream dotenv
   ```

4. Run Server:
   ```bash
   node server.js
   ```
---

### Client Setup

1. For development, run:
   ```bash
   pear run --dev .
   ```

2. For production, use the pre-deployed Pear app:
   ```bash
   pear run pear://7to8bzrk53ab5ufwauqcw57s1kxmuykc9b8cdnjicaqcgoefa4wo
   ```

---

## Usage

### Connecting to a Server

1. Launch the client app.
2. Enter the server's `SERVER_KEY` in the connection form to join its topic.

### Managing Containers

- **Listing Containers**:
  - View all containers (running and stopped) with their statuses.

- **Starting/Stopping Containers**:
  - Use the action buttons in the container list.

- **Removing Containers**:
  - Click the trash icon to delete a container.

- **Duplicating Containers**:
  - Click the clone icon and customize the duplication form.

### Terminal Access

- Open terminals for running containers.
- Switch between sessions using the tray at the bottom.

---

## Customization

### UI Customization

- Modify the layout and styling in `index.html` and the embedded CSS.

### Terminal Behavior

- Adjust terminal settings in `libs/terminal.js`:
  ```javascript
  const xterm = new Terminal({
    cursorBlink: true,
    theme: { background: '#1a1a1a', foreground: '#ffffff' },
  });
  ```

### Docker Commands

Add new commands in `server/server.js` under the `switch` statement for additional Docker functionalities.

---

## Security

- The `SERVER_KEY` is sensitive and should be stored securely.
- Refresh the key periodically to enhance security, especially in untrusted environments.

---

## Troubleshooting

### Common Issues

1. **Unable to Connect**:
   - Verify the `SERVER_KEY` matches on both server and client.
   - Ensure the server is running and accessible.

2. **Docker Errors**:
   - Ensure Docker is running and properly configured.
   - Check permissions to manage Docker.

3. **Terminal Issues**:
   - Verify the container has a valid shell (e.g., `/bin/bash`).

---

## Contributing

Contributions are welcome! Fork the repository, make your changes, and submit a pull request.