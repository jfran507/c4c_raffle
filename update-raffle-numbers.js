const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'raffles.json');

function readData(file) {
  try {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf8');
      return JSON.parse(data);
    }
    return [];
  } catch (error) {
    console.error('Error reading data:', error);
    return [];
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

console.log('Updating raffle numbers...');

const raffles = readData(DATA_FILE);

if (raffles.length === 0) {
  console.log('No raffles found.');
  process.exit(0);
}

let updated = 0;
raffles.forEach((raffle, index) => {
  if (!raffle.number) {
    raffle.number = index + 1;
    updated++;
  }
});

if (updated > 0) {
  if (writeData(DATA_FILE, raffles)) {
    console.log(`✓ Successfully updated ${updated} raffle(s) with numbers.`);
    console.log(`Total raffles: ${raffles.length}`);
  } else {
    console.error('Error saving updated raffles.');
    process.exit(1);
  }
} else {
  console.log('All raffles already have numbers assigned.');
}
