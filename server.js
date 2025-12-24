const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')));

const DATA_FILE = path.join(__dirname, 'data', 'raffles.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const RULES_FILE = path.join(__dirname, 'data', 'rules.json');
const SPONSORS_FILE = path.join(__dirname, 'data', 'sponsors.json');

// Admin usernames (case-insensitive)
const ADMIN_USERS = ['admin', 'joanne'];

function isAdmin(username) {
  return ADMIN_USERS.includes(username.toLowerCase());
}

if (!fs.existsSync('data')) {
  fs.mkdirSync('data');
}

if (!fs.existsSync(path.join(__dirname, 'data', 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'data', 'uploads'), { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'data', 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb('Error: Images only (jpeg, jpg, png, gif)');
    }
  }
});

function readData(file) {
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data);
    }
    // Return empty array for raffles and sponsors, empty object for others
    return (file === DATA_FILE || file === SPONSORS_FILE) ? [] : {};
  } catch (error) {
    console.error('Error reading data:', error);
    return (file === DATA_FILE || file === SPONSORS_FILE) ? [] : {};
  }
}

function writeData(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing data:', error);
    return false;
  }
}

function downloadImageFromUrl(url, callback) {
  console.log('Attempting to download image from URL:', url);

  const protocol = url.startsWith('https') ? https : http;
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const filename = uniqueSuffix + '.jpg';
  const filepath = path.join(__dirname, 'data', 'uploads', filename);
  const file = fs.createWriteStream(filepath);

  // Set a timeout of 15 seconds
  const timeout = setTimeout(() => {
    console.error('Download timeout after 15 seconds');
    file.close();
    fs.unlink(filepath, () => {});
    callback(new Error('Download timeout - URL took too long to respond'), null);
  }, 15000);

  const request = protocol.get(url, (response) => {
    console.log('Response status code:', response.statusCode);

    // Handle redirects (301, 302, 307, 308)
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      console.log('Following redirect to:', response.headers.location);
      clearTimeout(timeout);
      file.close();
      fs.unlink(filepath, () => {});
      downloadImageFromUrl(response.headers.location, callback);
      return;
    }

    if (response.statusCode !== 200) {
      console.error('Failed to download image, status code:', response.statusCode);
      clearTimeout(timeout);
      file.close();
      fs.unlink(filepath, () => {});
      callback(new Error(`Failed to download image: HTTP ${response.statusCode}`), null);
      return;
    }

    response.pipe(file);

    file.on('finish', () => {
      clearTimeout(timeout);
      file.close();
      console.log('Image downloaded successfully:', filename);
      callback(null, filename);
    });

    file.on('error', (err) => {
      console.error('File write error:', err);
      clearTimeout(timeout);
      fs.unlink(filepath, () => {});
      callback(err, null);
    });
  }).on('error', (err) => {
    console.error('Download error:', err);
    clearTimeout(timeout);
    fs.unlink(filepath, () => {});
    callback(err, null);
  });

  // Handle request timeout
  request.setTimeout(15000, () => {
    console.error('Request timeout');
    request.destroy();
    clearTimeout(timeout);
    file.close();
    fs.unlink(filepath, () => {});
    callback(new Error('Request timeout'), null);
  });
}

if (!fs.existsSync(USERS_FILE)) {
  const defaultPassword = bcrypt.hashSync('#livelikebrent123!', 10);
  writeData(USERS_FILE, {
    admin: defaultPassword,
    volunteer: defaultPassword
  });
  console.log('Default credentials created - username: admin/volunteer');
}

if (!fs.existsSync(RULES_FILE)) {
  const defaultRules = `Raffle closes at 4:30 PM

Winning tickets will be posted below at 5:30PM

You do NOT have to be here during the drawing

Unclaimed prizes will be in Wilkes-Barre FOR PICKUP ONLY after the event

Email Info@carve4cancer.com to coordinate pickup

Thank you for helping us SHRED CANCER!`;
  writeData(RULES_FILE, { rules: defaultRules });
  console.log('Default raffle rules created');
}

function authenticate(username, password) {
  const users = readData(USERS_FILE);
  // Case-insensitive username lookup
  const lowerUsername = username.toLowerCase();
  if (users[lowerUsername]) {
    return bcrypt.compareSync(password, users[lowerUsername]);
  }
  return false;
}

app.get('/api/raffles', (req, res) => {
  const raffles = readData(DATA_FILE);
  // Sort by number, then by id for items without numbers
  raffles.sort((a, b) => {
    if (a.number && b.number) return a.number - b.number;
    if (a.number) return -1;
    if (b.number) return 1;
    return a.id - b.id;
  });
  res.json(raffles);
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (authenticate(username, password)) {
    res.json({ success: true, role: isAdmin(username) ? 'admin' : 'volunteer', username: username.toLowerCase() });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/api/raffles', upload.single('image'), (req, res) => {
  const { username, password, name, description, imageUrl, donatedBy } = req.body;

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!name || !description) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const handleRaffleCreation = (imageFilename) => {
    const raffles = readData(DATA_FILE);
    const maxNumber = raffles.length > 0 ? Math.max(...raffles.map(r => r.number || 0)) : 0;
    const newRaffle = {
      id: Date.now(),
      number: maxNumber + 1,
      name,
      description,
      donatedBy: donatedBy || null,
      image: '/uploads/' + imageFilename,
      winningNumber: null,
      createdAt: new Date().toISOString()
    };

    raffles.push(newRaffle);

    if (writeData(DATA_FILE, raffles)) {
      res.json({ success: true, raffle: newRaffle });
    } else {
      res.status(500).json({ success: false, message: 'Error saving raffle' });
    }
  };

  if (imageUrl) {
    downloadImageFromUrl(imageUrl, (err, filename) => {
      if (err) {
        console.error('Error downloading image:', err);
        return res.status(400).json({
          success: false,
          message: `Failed to download image from URL: ${err.message}. Please try a direct image link or upload a file instead.`
        });
      }
      handleRaffleCreation(filename);
    });
  } else if (req.file) {
    handleRaffleCreation(req.file.filename);
  } else {
    return res.status(400).json({ success: false, message: 'Image file or URL required' });
  }
});

app.put('/api/raffles/reorder', (req, res) => {
  const { username, password, orderedIds } = req.body;

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ success: false, message: 'orderedIds must be an array' });
  }

  const raffles = readData(DATA_FILE);

  // Create a map of id to raffle
  const raffleMap = new Map();
  raffles.forEach(raffle => raffleMap.set(raffle.id, raffle));

  // Update only the numbers for the reordered items
  orderedIds.forEach((id, index) => {
    const raffle = raffleMap.get(id);
    if (raffle) {
      raffle.number = index + 1;
    }
  });

  // Convert map back to array (preserves all items, even those not in orderedIds)
  const allRaffles = Array.from(raffleMap.values());

  if (writeData(DATA_FILE, allRaffles)) {
    res.json({ success: true, raffles: allRaffles });
  } else {
    res.status(500).json({ success: false, message: 'Error reordering raffles' });
  }
});

app.put('/api/raffles/:id', upload.single('image'), (req, res) => {
  const { username, password, name, description, imageUrl, donatedBy } = req.body;
  const raffleId = parseInt(req.params.id);

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!name || !description) {
    return res.status(400).json({ success: false, message: 'Name and description are required' });
  }

  const raffles = readData(DATA_FILE);
  const raffleIndex = raffles.findIndex(r => r.id === raffleId);

  if (raffleIndex === -1) {
    return res.status(404).json({ success: false, message: 'Raffle not found' });
  }

  raffles[raffleIndex].name = name;
  raffles[raffleIndex].description = description;
  raffles[raffleIndex].donatedBy = donatedBy || null;

  const handleRaffleUpdate = (imageFilename) => {
    if (imageFilename) {
      const oldImage = raffles[raffleIndex].image;
      if (oldImage && fs.existsSync(path.join(__dirname, 'public', oldImage))) {
        fs.unlinkSync(path.join(__dirname, 'public', oldImage));
      }
      raffles[raffleIndex].image = '/uploads/' + imageFilename;
    }

    raffles[raffleIndex].updatedAt = new Date().toISOString();

    if (writeData(DATA_FILE, raffles)) {
      res.json({ success: true, raffle: raffles[raffleIndex] });
    } else {
      res.status(500).json({ success: false, message: 'Error updating raffle' });
    }
  };

  if (imageUrl) {
    downloadImageFromUrl(imageUrl, (err, filename) => {
      if (err) {
        console.error('Error downloading image:', err);
        return res.status(400).json({
          success: false,
          message: `Failed to download image from URL: ${err.message}. Please try a direct image link or upload a file instead.`
        });
      }
      handleRaffleUpdate(filename);
    });
  } else if (req.file) {
    handleRaffleUpdate(req.file.filename);
  } else {
    handleRaffleUpdate(null);
  }
});

app.put('/api/raffles/:id/winner', (req, res) => {
  const { username, password, winningNumber } = req.body;
  const raffleId = parseInt(req.params.id);

  if (!authenticate(username, password)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const raffles = readData(DATA_FILE);
  const raffleIndex = raffles.findIndex(r => r.id === raffleId);

  if (raffleIndex === -1) {
    return res.status(404).json({ success: false, message: 'Raffle not found' });
  }

  // Allow clearing the winning number by setting it to null or empty string
  raffles[raffleIndex].winningNumber = winningNumber && winningNumber.trim() !== '' ? winningNumber : null;

  if (writeData(DATA_FILE, raffles)) {
    res.json({ success: true, raffle: raffles[raffleIndex] });
  } else {
    res.status(500).json({ success: false, message: 'Error updating raffle' });
  }
});

app.delete('/api/raffles/:id', (req, res) => {
  const { username, password } = req.body;
  const raffleId = parseInt(req.params.id);

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const raffles = readData(DATA_FILE);
  const raffleIndex = raffles.findIndex(r => r.id === raffleId);

  if (raffleIndex === -1) {
    return res.status(404).json({ success: false, message: 'Raffle not found' });
  }

  const oldImage = raffles[raffleIndex].image;
  if (oldImage && fs.existsSync(path.join(__dirname, 'public', oldImage))) {
    fs.unlinkSync(path.join(__dirname, 'public', oldImage));
  }

  raffles.splice(raffleIndex, 1);

  if (writeData(DATA_FILE, raffles)) {
    res.json({ success: true, message: 'Raffle deleted successfully' });
  } else {
    res.status(500).json({ success: false, message: 'Error deleting raffle' });
  }
});

app.get('/api/rules', (req, res) => {
  const rules = readData(RULES_FILE);
  res.json(rules);
});

app.put('/api/rules', (req, res) => {
  const { username, password, rules } = req.body;

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!rules) {
    return res.status(400).json({ success: false, message: 'Rules text required' });
  }

  if (writeData(RULES_FILE, { rules })) {
    res.json({ success: true, message: 'Rules updated successfully' });
  } else {
    res.status(500).json({ success: false, message: 'Error updating rules' });
  }
});

app.post('/api/change-password', (req, res) => {
  const { username, currentPassword, newPassword } = req.body;

  if (!authenticate(username, currentPassword)) {
    return res.status(401).json({ success: false, message: 'Invalid current password' });
  }

  const users = readData(USERS_FILE);
  users[username.toLowerCase()] = bcrypt.hashSync(newPassword, 10);

  if (writeData(USERS_FILE, users)) {
    res.json({ success: true, message: 'Password changed successfully' });
  } else {
    res.status(500).json({ success: false, message: 'Error changing password' });
  }
});

app.post('/api/users', (req, res) => {
  const { adminUsername, adminPassword, newUsername, newPassword } = req.body;

  if (!authenticate(adminUsername, adminPassword) || !isAdmin(adminUsername)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!newUsername || !newPassword) {
    return res.status(400).json({ success: false, message: 'Username and password required' });
  }

  const users = readData(USERS_FILE);
  const lowerUsername = newUsername.toLowerCase();

  if (users[lowerUsername]) {
    return res.status(400).json({ success: false, message: 'User already exists' });
  }

  users[lowerUsername] = bcrypt.hashSync(newPassword, 10);

  if (writeData(USERS_FILE, users)) {
    res.json({ success: true, message: `User ${lowerUsername} created successfully` });
  } else {
    res.status(500).json({ success: false, message: 'Error creating user' });
  }
});

// Sponsor endpoints
app.get('/api/sponsors', (req, res) => {
  const sponsors = readData(SPONSORS_FILE);
  res.json(sponsors);
});

app.post('/api/sponsors', upload.single('logo'), (req, res) => {
  const { username, password, name, websiteUrl } = req.body;

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!name) {
    return res.status(400).json({ success: false, message: 'Sponsor name is required' });
  }

  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Logo image is required' });
  }

  const sponsors = readData(SPONSORS_FILE);
  const newSponsor = {
    id: Date.now(),
    name,
    logo: '/uploads/' + req.file.filename,
    websiteUrl: websiteUrl || null,
    createdAt: new Date().toISOString()
  };

  sponsors.push(newSponsor);

  if (writeData(SPONSORS_FILE, sponsors)) {
    res.json({ success: true, sponsor: newSponsor });
  } else {
    res.status(500).json({ success: false, message: 'Error saving sponsor' });
  }
});

app.delete('/api/sponsors/:id', (req, res) => {
  const { username, password } = req.body;
  const sponsorId = parseInt(req.params.id);

  if (!authenticate(username, password) || !isAdmin(username)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const sponsors = readData(SPONSORS_FILE);
  const sponsorIndex = sponsors.findIndex(s => s.id === sponsorId);

  if (sponsorIndex === -1) {
    return res.status(404).json({ success: false, message: 'Sponsor not found' });
  }

  // Delete the logo file
  const logoPath = path.join(__dirname, 'data', sponsors[sponsorIndex].logo);
  if (fs.existsSync(logoPath)) {
    fs.unlinkSync(logoPath);
  }

  sponsors.splice(sponsorIndex, 1);

  if (writeData(SPONSORS_FILE, sponsors)) {
    res.json({ success: true, message: 'Sponsor deleted' });
  } else {
    res.status(500).json({ success: false, message: 'Error deleting sponsor' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
});
