/**
 * Server-Sent Events (SSE) manager for real-time updates.
 * Optimized for 1000+ concurrent connections with centralized heartbeat.
 */

class SSEManager {
    constructor() {
        this.clients = new Set();
        this.maxConnections = 2000;
        this.heartbeatInterval = null;

        // Start centralized heartbeat (single timer for all clients)
        this.startHeartbeat();
    }

    /**
     * Start a single centralized heartbeat for all clients.
     * This is much more memory-efficient than per-client intervals.
     */
    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.sendHeartbeatToAll();
        }, 30000);
    }

    /**
     * Send heartbeat to all connected clients.
     * Collects failed clients and removes them after iteration (safe).
     */
    sendHeartbeatToAll() {
        const failedClients = [];

        for (const client of this.clients) {
            try {
                client.write(':\n\n');
            } catch (err) {
                failedClients.push(client);
            }
        }

        // Remove failed clients after iteration (not during)
        for (const client of failedClients) {
            this.clients.delete(client);
        }
    }

    /**
     * Add a new SSE client connection.
     * @param {Response} res - Express response object
     * @returns {boolean} - Whether the client was added successfully
     */
    addClient(res) {
        // Check connection limit
        if (this.clients.size >= this.maxConnections) {
            return false;
        }

        // Configure SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
            'Access-Control-Allow-Origin': '*'
        });

        // Send initial heartbeat
        res.write(':\n\n');

        // Track the client
        this.clients.add(res);

        // Remove client on disconnect
        res.on('close', () => {
            this.clients.delete(res);
        });

        res.on('error', () => {
            this.clients.delete(res);
        });

        // No per-client interval needed - centralized heartbeat handles all clients

        return true;
    }

    /**
     * Broadcast an event to all connected clients.
     * Collects failed clients and removes them after iteration (safe).
     * @param {string} event - Event name
     * @param {object} data - Data to send
     */
    broadcast(event, data) {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        const failedClients = [];

        for (const client of this.clients) {
            try {
                client.write(message);
            } catch (err) {
                failedClients.push(client);
            }
        }

        // Remove failed clients after iteration (not during)
        for (const client of failedClients) {
            this.clients.delete(client);
        }
    }

    /**
     * Send an event to a specific client.
     * @param {Response} client - Client response object
     * @param {string} event - Event name
     * @param {object} data - Data to send
     */
    sendToClient(client, event, data) {
        if (this.clients.has(client)) {
            try {
                const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
                client.write(message);
            } catch (err) {
                this.clients.delete(client);
            }
        }
    }

    /**
     * Get the number of connected clients.
     */
    getClientCount() {
        return this.clients.size;
    }

    /**
     * Check if at capacity.
     */
    isAtCapacity() {
        return this.clients.size >= this.maxConnections;
    }

    /**
     * Get connection statistics.
     */
    getStats() {
        return {
            connected: this.clients.size,
            maxConnections: this.maxConnections,
            utilization: (this.clients.size / this.maxConnections * 100).toFixed(1) + '%'
        };
    }

    /**
     * Stop the centralized heartbeat.
     */
    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    /**
     * Close all client connections (for graceful shutdown).
     */
    closeAll() {
        // Stop the heartbeat first
        this.stopHeartbeat();

        for (const client of this.clients) {
            try {
                client.end();
            } catch (err) {
                // Ignore errors during shutdown
            }
        }
        this.clients.clear();
    }
}

// Singleton instance
const sseManager = new SSEManager();

// Handle process termination
process.on('SIGINT', () => {
    sseManager.closeAll();
});
process.on('SIGTERM', () => {
    sseManager.closeAll();
});

module.exports = sseManager;
