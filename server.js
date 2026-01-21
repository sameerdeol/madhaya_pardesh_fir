import express from 'express';
import bodyParser from 'body-parser';
import { checkConnection } from './db.js';
import apiRoutes from './src/routes/api.js';
import { initBrowser } from './src/services/puppeteerService.js';

const app = express();
const PORT = 3000;

app.use(bodyParser.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');

// Check DB Connection
checkConnection();

// Initialize Browser Service
initBrowser().catch(err => {
  console.error('Failed to launch browser:', err);
});

// API Routes
app.use('/api', apiRoutes);

// View Route
app.get('/', (req, res) => res.render('index'));

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
