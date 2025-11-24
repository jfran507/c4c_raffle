const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const DATA_FILE = path.join(__dirname, 'data', 'raffles.json');
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const RULES_FILE = path.join(__dirname, 'data', 'rules.json');

if (!fs.existsSync('data')) {
  fs.mkdirSync('data');
}

if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
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
    return file === DATA_FILE ? [] : {};
  } catch (error) {
    console.error('Error reading data:', error);
    return file === DATA_FILE ? [] : {};
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
  const protocol = url.startsWith('https') ? https : http;
  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
  const filename = uniqueSuffix + '.jpg';
  const filepath = path.join(__dirname, 'uploads', filename);
  const file = fs.createWriteStream(filepath);

  protocol.get(url, (response) => {
    if (response.statusCode !== 200) {
      callback(new Error(`Failed to download image: ${response.statusCode}`), null);
      return;
    }

    response.pipe(file);

    file.on('finish', () => {
      file.close();
      callback(null, filename);
    });

    file.on('error', (err) => {
      fs.unlink(filepath, () => {});
      callback(err, null);
    });
  }).on('error', (err) => {
    fs.unlink(filepath, () => {});
    callback(err, null);
  });
}

if (!fs.existsSync(USERS_FILE)) {
  const defaultPassword = bcrypt.hashSync('carve4cancer', 10);
  writeData(USERS_FILE, {
    admin: defaultPassword,
    volunteer: defaultPassword
  });
  console.log('Default credentials created - username: admin/volunteer, password: carve4cancer');
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
  if (users[username]) {
    return bcrypt.compareSync(password, users[username]);
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
    res.json({ success: true, role: username });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/api/raffles', upload.single('image'), (req, res) => {
  const { username, password, name, description, imageUrl } = req.body;

  if (!authenticate(username, password) || username !== 'admin') {
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
        return res.status(400).json({ success: false, message: 'Failed to download image from URL' });
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

  if (!authenticate(username, password) || username !== 'admin') {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ success: false, message: 'orderedIds must be an array' });
  }

  const raffles = readData(DATA_FILE);

  // Create a map of id to raffle
  const raffleMap = new Map();
  raffles.forEach(raffle => raffleMap.set(raffle.id, raffle));

  // Reorder raffles and update numbers
  const reorderedRaffles = orderedIds.map((id, index) => {
    const raffle = raffleMap.get(id);
    if (raffle) {
      raffle.number = index + 1;
      return raffle;
    }
    return null;
  }).filter(r => r !== null);

  if (writeData(DATA_FILE, reorderedRaffles)) {
    res.json({ success: true, raffles: reorderedRaffles });
  } else {
    res.status(500).json({ success: false, message: 'Error reordering raffles' });
  }
});

app.put('/api/raffles/:id', upload.single('image'), (req, res) => {
  const { username, password, name, description, imageUrl } = req.body;
  const raffleId = parseInt(req.params.id);

  if (!authenticate(username, password) || username !== 'admin') {
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
        return res.status(400).json({ success: false, message: 'Failed to download image from URL' });
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

  if (!winningNumber) {
    return res.status(400).json({ success: false, message: 'Winning number required' });
  }

  const raffles = readData(DATA_FILE);
  const raffleIndex = raffles.findIndex(r => r.id === raffleId);

  if (raffleIndex === -1) {
    return res.status(404).json({ success: false, message: 'Raffle not found' });
  }

  raffles[raffleIndex].winningNumber = winningNumber;

  if (writeData(DATA_FILE, raffles)) {
    res.json({ success: true, raffle: raffles[raffleIndex] });
  } else {
    res.status(500).json({ success: false, message: 'Error updating raffle' });
  }
});

app.delete('/api/raffles/:id', (req, res) => {
  const { username, password } = req.body;
  const raffleId = parseInt(req.params.id);

  if (!authenticate(username, password) || username !== 'admin') {
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

  if (!authenticate(username, password) || username !== 'admin') {
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
  users[username] = bcrypt.hashSync(newPassword, 10);

  if (writeData(USERS_FILE, users)) {
    res.json({ success: true, message: 'Password changed successfully' });
  } else {
    res.status(500).json({ success: false, message: 'Error changing password' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Default login - username: admin or volunteer, password: carve4cancer');
});
