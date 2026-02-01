const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const compression = require('compression');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const rateLimit = require('express-rate-limit');

// Import custom modules
const { initDb, getDb, statements, bumpVersion, transaction } = require('./db');
const cache = require('./cache');
const sseManager = require('./sse');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for Railway deployment (accurate IP detection for rate limiting)
app.set('trust proxy', 1);

// Enable gzip compression for responses (60-80% bandwidth reduction)
app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static assets with browser caching
app.use(express.static('public', {
    maxAge: '1h',        // Cache public assets for 1 hour
    etag: true,
    lastModified: true
}));

// Uploaded images with longer caching (filenames are unique timestamps)
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads'), {
    maxAge: '1d',        // Cache uploads for 1 day
    immutable: true      // Filenames never change, content is immutable
}));

// Admin usernames (case-insensitive)
const ADMIN_USERS = ['admin', 'joanne'];

function isAdmin(username) {
    return ADMIN_USERS.includes(username.toLowerCase());
}

// Ensure upload directory exists
const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Rate limiting configuration for high-traffic event (1000+ concurrent users)

// Read endpoints - generous limits for attendees checking tickets/viewing prizes
const readLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 600, // 600 requests per minute per IP (10/sec)
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// General limiter for non-read operations
const generalLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 300, // 300 requests per minute per IP
    message: { success: false, message: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 login attempts per 15 minutes
    message: { success: false, message: 'Too many login attempts, please try again later' },
    skipSuccessfulRequests: true,
});

const writeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 write operations per minute
    message: { success: false, message: 'Too many operations, please slow down' },
});

// Apply general rate limiter (read endpoints will use readLimiter specifically)
app.use('/api/', generalLimiter);
app.use('/api/login', authLimiter);

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB for high-res phone photos
    fileFilter: (req, file, cb) => {
        // Accept common image extensions including HEIC from iPhones and webp
        const allowedExtensions = /\.(jpeg|jpg|png|gif|heic|heif|webp)$/i;
        const allowedMimetypes = /^image\/(jpeg|jpg|png|gif|heic|heif|webp)$/i;

        const extOk = allowedExtensions.test(file.originalname);
        const mimeOk = allowedMimetypes.test(file.mimetype) || file.mimetype.startsWith('image/');

        // Accept if extension OR mimetype indicates an image
        if (extOk || mimeOk) {
            return cb(null, true);
        } else {
            cb('Error: Images only (jpeg, jpg, png, gif, heic)');
        }
    }
});

// Download image from URL (promisified)
function downloadImageFromUrl(url) {
    return new Promise((resolve, reject) => {
        console.log('Attempting to download image from URL:', url);

        const protocol = url.startsWith('https') ? https : http;
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const filename = uniqueSuffix + '.jpg';
        const filepath = path.join(UPLOADS_DIR, filename);
        const file = fs.createWriteStream(filepath);

        const timeout = setTimeout(() => {
            console.error('Download timeout after 15 seconds');
            file.close();
            fs.unlink(filepath, () => {});
            reject(new Error('Download timeout - URL took too long to respond'));
        }, 15000);

        const request = protocol.get(url, (response) => {
            console.log('Response status code:', response.statusCode);

            // Handle redirects (301, 302, 307, 308)
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                console.log('Following redirect to:', response.headers.location);
                clearTimeout(timeout);
                file.close();
                fs.unlink(filepath, () => {});
                resolve(downloadImageFromUrl(response.headers.location));
                return;
            }

            if (response.statusCode !== 200) {
                console.error('Failed to download image, status code:', response.statusCode);
                clearTimeout(timeout);
                file.close();
                fs.unlink(filepath, () => {});
                reject(new Error(`Failed to download image: HTTP ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                clearTimeout(timeout);
                file.close();
                console.log('Image downloaded successfully:', filename);
                resolve(filename);
            });

            file.on('error', (err) => {
                console.error('File write error:', err);
                clearTimeout(timeout);
                fs.unlink(filepath, () => {});
                reject(err);
            });
        }).on('error', (err) => {
            console.error('Download error:', err);
            clearTimeout(timeout);
            fs.unlink(filepath, () => {});
            reject(err);
        });

        request.setTimeout(15000, () => {
            console.error('Request timeout');
            request.destroy();
            clearTimeout(timeout);
            file.close();
            fs.unlink(filepath, () => {});
            reject(new Error('Request timeout'));
        });
    });
}

// Authentication cache to reduce bcrypt overhead
// bcrypt is intentionally slow (~100ms) - caching avoids repeated calls
const authCache = new Map();
const AUTH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const AUTH_CACHE_MAX = 100; // Max cached sessions

function getAuthCacheKey(username, password) {
    // Hash credentials as cache key (don't store password directly)
    return crypto.createHash('sha256')
        .update(username.toLowerCase() + ':' + password)
        .digest('hex');
}

function cleanupAuthCache() {
    const now = Date.now();
    for (const [key, entry] of authCache.entries()) {
        if (now > entry.expiresAt) {
            authCache.delete(key);
        }
    }
}

// Cleanup auth cache every minute
setInterval(cleanupAuthCache, 60000);

// Async authentication with caching
async function authenticate(username, password) {
    const cacheKey = getAuthCacheKey(username, password);

    // Check cache first
    const cached = authCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return true;
    }

    // Cache miss - do actual bcrypt compare
    const user = statements.getUserByUsername.get(username.toLowerCase());
    if (!user) return false;

    const isValid = await bcrypt.compare(password, user.passwordHash);

    if (isValid) {
        // Cache successful auth
        if (authCache.size >= AUTH_CACHE_MAX) {
            // Evict oldest entry
            const oldestKey = authCache.keys().next().value;
            authCache.delete(oldestKey);
        }

        authCache.set(cacheKey, {
            expiresAt: Date.now() + AUTH_CACHE_TTL
        });
    }

    return isValid;
}

// Notify connected clients of data changes
function notifyClients(type) {
    const version = statements.getVersion.get(type)?.version || 0;
    sseManager.broadcast('update', { type, version });
}

// ============================================
// HEALTH CHECK ENDPOINT
// ============================================

app.get('/api/health', readLimiter, (req, res) => {
    try {
        const version = statements.getVersion.get('raffles');
        res.json({
            status: 'healthy',
            sseClients: sseManager.getClientCount(),
            dbVersion: version?.version || 0,
            cacheStats: cache.getStats()
        });
    } catch (error) {
        res.status(503).json({ status: 'unhealthy', error: error.message });
    }
});

// ============================================
// SSE ENDPOINT FOR REAL-TIME UPDATES
// ============================================

app.get('/api/events', readLimiter, (req, res) => {
    if (sseManager.isAtCapacity()) {
        return res.status(503).json({
            success: false,
            message: 'Server at capacity, please try again'
        });
    }

    sseManager.addClient(res);

    // Send current versions on connect
    const versions = {
        raffles: statements.getVersion.get('raffles')?.version || 0,
        rules: statements.getVersion.get('rules')?.version || 0,
        sponsors: statements.getVersion.get('sponsors')?.version || 0
    };
    sseManager.sendToClient(res, 'version', versions);
});

// ============================================
// RAFFLE ENDPOINTS
// ============================================

app.get('/api/raffles', readLimiter, (req, res) => {
    // Check for conditional request (ETag)
    const clientVersion = req.headers['if-none-match'];
    const currentVersion = statements.getVersion.get('raffles')?.version || 0;

    if (clientVersion && parseInt(clientVersion) === currentVersion) {
        return res.status(304).end();
    }

    // Check cache
    let raffles = cache.get('raffles');

    if (!raffles) {
        raffles = statements.getAllRaffles.all();
        cache.set('raffles', raffles, currentVersion);
    }

    res.setHeader('ETag', String(currentVersion));
    res.setHeader('Cache-Control', 'private, max-age=5');
    res.json(raffles);
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (await authenticate(username, password)) {
            res.json({
                success: true,
                role: isAdmin(username) ? 'admin' : 'volunteer',
                username: username.toLowerCase()
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.post('/api/raffles', writeLimiter, upload.single('image'), async (req, res) => {
    try {
        const { username, password, name, description, imageUrl, donatedBy } = req.body;

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!name || !description) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        let imageFilename;

        if (imageUrl) {
            try {
                imageFilename = await downloadImageFromUrl(imageUrl);
            } catch (err) {
                console.error('Error downloading image:', err);
                return res.status(400).json({
                    success: false,
                    message: `Failed to download image from URL: ${err.message}. Please try a direct image link or upload a file instead.`
                });
            }
        } else if (req.file) {
            imageFilename = req.file.filename;
        } else {
            return res.status(400).json({ success: false, message: 'Image file or URL required' });
        }

        const maxNumber = statements.getMaxNumber.get()?.maxNum || 0;
        const id = Date.now();
        const now = new Date().toISOString();

        statements.insertRaffle.run(
            id,
            maxNumber + 1,
            name,
            description,
            donatedBy || null,
            '/uploads/' + imageFilename,
            null,
            now
        );

        const newRaffle = statements.getRaffleById.get(id);

        // Invalidate cache and notify clients
        cache.invalidate('raffles');
        bumpVersion('raffles');
        notifyClients('raffles');

        res.json({ success: true, raffle: newRaffle });
    } catch (error) {
        console.error('Error creating raffle:', error);
        res.status(500).json({ success: false, message: 'Error creating raffle' });
    }
});

app.put('/api/raffles/reorder', writeLimiter, async (req, res) => {
    try {
        const { username, password, orderedIds } = req.body;

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!Array.isArray(orderedIds)) {
            return res.status(400).json({ success: false, message: 'orderedIds must be an array' });
        }

        const updateMany = transaction(() => {
            orderedIds.forEach((id, index) => {
                statements.updateRaffleNumber.run(index + 1, id);
            });
        });

        updateMany();

        // Invalidate cache and notify clients
        cache.invalidate('raffles');
        bumpVersion('raffles');
        notifyClients('raffles');

        const allRaffles = statements.getAllRaffles.all();
        res.json({ success: true, raffles: allRaffles });
    } catch (error) {
        console.error('Error reordering raffles:', error);
        res.status(500).json({ success: false, message: 'Error reordering raffles' });
    }
});

app.put('/api/raffles/:id', writeLimiter, upload.single('image'), async (req, res) => {
    try {
        const { username, password, name, description, imageUrl, donatedBy } = req.body;
        const raffleId = parseInt(req.params.id);

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!name || !description) {
            return res.status(400).json({ success: false, message: 'Name and description are required' });
        }

        const existingRaffle = statements.getRaffleById.get(raffleId);
        if (!existingRaffle) {
            return res.status(404).json({ success: false, message: 'Raffle not found' });
        }

        const now = new Date().toISOString();

        // Update basic fields
        statements.updateRaffle.run(name, description, donatedBy || null, now, raffleId);

        // Handle image update
        let newImageFilename = null;

        if (imageUrl) {
            try {
                newImageFilename = await downloadImageFromUrl(imageUrl);
            } catch (err) {
                console.error('Error downloading image:', err);
                return res.status(400).json({
                    success: false,
                    message: `Failed to download image from URL: ${err.message}. Please try a direct image link or upload a file instead.`
                });
            }
        } else if (req.file) {
            newImageFilename = req.file.filename;
        }

        if (newImageFilename) {
            // Delete old image if it exists
            if (existingRaffle.image) {
                const oldImagePath = path.join(__dirname, 'data', existingRaffle.image);
                if (fs.existsSync(oldImagePath)) {
                    fs.unlink(oldImagePath, () => {});
                }
            }
            statements.updateRaffleImage.run('/uploads/' + newImageFilename, now, raffleId);
        }

        const updatedRaffle = statements.getRaffleById.get(raffleId);

        // Invalidate cache and notify clients
        cache.invalidate('raffles');
        bumpVersion('raffles');
        notifyClients('raffles');

        res.json({ success: true, raffle: updatedRaffle });
    } catch (error) {
        console.error('Error updating raffle:', error);
        res.status(500).json({ success: false, message: 'Error updating raffle' });
    }
});

app.put('/api/raffles/:id/winner', writeLimiter, async (req, res) => {
    try {
        const { username, password, winningNumber } = req.body;
        const raffleId = parseInt(req.params.id);

        if (!await authenticate(username, password)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const existingRaffle = statements.getRaffleById.get(raffleId);
        if (!existingRaffle) {
            return res.status(404).json({ success: false, message: 'Raffle not found' });
        }

        const now = new Date().toISOString();
        const winner = winningNumber && winningNumber.trim() !== '' ? winningNumber : null;

        statements.updateWinner.run(winner, now, raffleId);

        const updatedRaffle = statements.getRaffleById.get(raffleId);

        // Invalidate cache and notify clients
        cache.invalidate('raffles');
        bumpVersion('raffles');
        notifyClients('raffles');

        res.json({ success: true, raffle: updatedRaffle });
    } catch (error) {
        console.error('Error updating winner:', error);
        res.status(500).json({ success: false, message: 'Error updating raffle' });
    }
});

app.delete('/api/raffles/:id', writeLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const raffleId = parseInt(req.params.id);

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const existingRaffle = statements.getRaffleById.get(raffleId);
        if (!existingRaffle) {
            return res.status(404).json({ success: false, message: 'Raffle not found' });
        }

        // Delete the image file
        if (existingRaffle.image) {
            const imagePath = path.join(__dirname, 'data', existingRaffle.image);
            if (fs.existsSync(imagePath)) {
                fs.unlink(imagePath, () => {});
            }
        }

        statements.deleteRaffle.run(raffleId);

        // Invalidate cache and notify clients
        cache.invalidate('raffles');
        bumpVersion('raffles');
        notifyClients('raffles');

        res.json({ success: true, message: 'Raffle deleted successfully' });
    } catch (error) {
        console.error('Error deleting raffle:', error);
        res.status(500).json({ success: false, message: 'Error deleting raffle' });
    }
});

// ============================================
// RULES ENDPOINTS
// ============================================

app.get('/api/rules', readLimiter, (req, res) => {
    // Check for conditional request (ETag)
    const clientVersion = req.headers['if-none-match'];
    const currentVersion = statements.getVersion.get('rules')?.version || 0;

    if (clientVersion && parseInt(clientVersion) === currentVersion) {
        return res.status(304).end();
    }

    // Check cache
    let rulesData = cache.get('rules');

    if (!rulesData) {
        const result = statements.getRules.get();
        rulesData = result ? { rules: result.rules } : { rules: '' };
        cache.set('rules', rulesData, currentVersion);
    }

    res.setHeader('ETag', String(currentVersion));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(rulesData);
});

app.put('/api/rules', writeLimiter, async (req, res) => {
    try {
        const { username, password, rules } = req.body;

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!rules) {
            return res.status(400).json({ success: false, message: 'Rules text required' });
        }

        const now = new Date().toISOString();
        statements.upsertRules.run(rules, now);

        // Invalidate cache and notify clients
        cache.invalidate('rules');
        bumpVersion('rules');
        notifyClients('rules');

        res.json({ success: true, message: 'Rules updated successfully' });
    } catch (error) {
        console.error('Error updating rules:', error);
        res.status(500).json({ success: false, message: 'Error updating rules' });
    }
});

// ============================================
// USER ENDPOINTS
// ============================================

app.post('/api/change-password', writeLimiter, async (req, res) => {
    try {
        const { username, currentPassword, newPassword } = req.body;

        if (!await authenticate(username, currentPassword)) {
            return res.status(401).json({ success: false, message: 'Invalid current password' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        statements.updateUserPassword.run(hashedPassword, username.toLowerCase());

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ success: false, message: 'Error changing password' });
    }
});

app.post('/api/users', writeLimiter, async (req, res) => {
    try {
        const { adminUsername, adminPassword, newUsername, newPassword } = req.body;

        if (!await authenticate(adminUsername, adminPassword) || !isAdmin(adminUsername)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!newUsername || !newPassword) {
            return res.status(400).json({ success: false, message: 'Username and password required' });
        }

        const lowerUsername = newUsername.toLowerCase();
        const existingUser = statements.getUserByUsername.get(lowerUsername);

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        const now = new Date().toISOString();
        statements.insertUser.run(lowerUsername, hashedPassword, now);

        res.json({ success: true, message: `User ${lowerUsername} created successfully` });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: 'Error creating user' });
    }
});

// ============================================
// SPONSOR ENDPOINTS
// ============================================

app.get('/api/sponsors', readLimiter, (req, res) => {
    // Check for conditional request (ETag)
    const clientVersion = req.headers['if-none-match'];
    const currentVersion = statements.getVersion.get('sponsors')?.version || 0;

    if (clientVersion && parseInt(clientVersion) === currentVersion) {
        return res.status(304).end();
    }

    // Check cache
    let sponsors = cache.get('sponsors');

    if (!sponsors) {
        sponsors = statements.getAllSponsors.all();
        cache.set('sponsors', sponsors, currentVersion);
    }

    res.setHeader('ETag', String(currentVersion));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json(sponsors);
});

app.post('/api/sponsors', writeLimiter, upload.single('logo'), async (req, res) => {
    try {
        const { username, password, name, websiteUrl } = req.body;

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        if (!name) {
            return res.status(400).json({ success: false, message: 'Sponsor name is required' });
        }

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Logo image is required' });
        }

        const id = Date.now();
        const now = new Date().toISOString();

        statements.insertSponsor.run(
            id,
            name,
            '/uploads/' + req.file.filename,
            websiteUrl || null,
            now
        );

        const newSponsor = statements.getSponsorById.get(id);

        // Invalidate cache and notify clients
        cache.invalidate('sponsors');
        bumpVersion('sponsors');
        notifyClients('sponsors');

        res.json({ success: true, sponsor: newSponsor });
    } catch (error) {
        console.error('Error creating sponsor:', error);
        res.status(500).json({ success: false, message: 'Error saving sponsor' });
    }
});

app.delete('/api/sponsors/:id', writeLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        const sponsorId = parseInt(req.params.id);

        if (!await authenticate(username, password) || !isAdmin(username)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const existingSponsor = statements.getSponsorById.get(sponsorId);
        if (!existingSponsor) {
            return res.status(404).json({ success: false, message: 'Sponsor not found' });
        }

        // Delete the logo file
        if (existingSponsor.logo) {
            const logoPath = path.join(__dirname, 'data', existingSponsor.logo);
            if (fs.existsSync(logoPath)) {
                fs.unlink(logoPath, () => {});
            }
        }

        statements.deleteSponsor.run(sponsorId);

        // Invalidate cache and notify clients
        cache.invalidate('sponsors');
        bumpVersion('sponsors');
        notifyClients('sponsors');

        res.json({ success: true, message: 'Sponsor deleted' });
    } catch (error) {
        console.error('Error deleting sponsor:', error);
        res.status(500).json({ success: false, message: 'Error deleting sponsor' });
    }
});

// ============================================
// REQUEST LOGGING (for monitoring)
// ============================================

app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        // Log slow requests or errors
        if (duration > 1000 || res.statusCode >= 500) {
            console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
        }
    });
    next();
});

// ============================================
// START SERVER
// ============================================

async function startServer() {
    try {
        // Initialize database before starting server
        console.log('Initializing database...');
        await initDb();
        console.log('Database initialized successfully');

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running at http://0.0.0.0:${PORT}`);
            console.log(`SSE endpoint: /api/events`);
            console.log(`Health check: /api/health`);

            // Log SSE connection counts periodically
            setInterval(() => {
                const count = sseManager.getClientCount();
                if (count > 0) {
                    console.log(`[SSE] Active connections: ${count}`);
                }
            }, 60000);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
