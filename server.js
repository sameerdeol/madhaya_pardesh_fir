import express from 'express';
import bodyParser from 'body-parser';
import { checkConnection, resetProcessingRequests } from './db.js';
import apiRoutes from './src/routes/api.js';
import { initBrowser } from './src/services/puppeteerService.js';

const app = express();
const PORT = 4002;

app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Check DB Connection & Reset State
checkConnection().then(() => resetProcessingRequests());

// Initialize Browser Service
initBrowser().catch(err => {
  console.error('Failed to launch browser:', err);
});

// API Routes
app.use('/api', apiRoutes);

// View Route
app.get('/', (req, res) => res.render('index'));

// Connection Tracker
const connections = new Set();

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

server.on('connection', (socket) => {
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));
});

// Graceful Shutdown
import { closeBrowser } from './src/services/puppeteerService.js';

const gracefulShutdown = async (signal) => {
  console.log(`\n\nReceived ${signal}. Shutting down gracefully...`);

  // Force exit after 3 seconds if cleanup hangs
  setTimeout(() => {
    console.error('🛑 Shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 3000);

  try {
    // 0. Close HTTP Server & destroy connections
    if (server) {
      console.log('🛑 Closing HTTP server...');

      // Force destroy all open sockets
      for (const socket of connections) {
        socket.destroy();
      }

      server.close(() => {
        console.log('✅ HTTP server closed.');
      });
    }

    // 1. Reset pending requests to stopped immediately
    await resetProcessingRequests();

    // 2. Close Browser
    await closeBrowser();

    console.log('👋 Goodbye!');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
};

// process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
