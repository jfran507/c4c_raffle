/**
 * Migration script to import existing JSON data into SQLite database.
 * Run with: npm run migrate
 *
 * This script:
 * 1. Creates the SQLite database with schema
 * 2. Imports existing data from JSON files
 * 3. Keeps original JSON files as backup
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'raffle.db');

// JSON file paths
const RAFFLES_FILE = path.join(DATA_DIR, 'raffles.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const SPONSORS_FILE = path.join(DATA_DIR, 'sponsors.json');

function readJsonFile(filepath) {
    try {
        if (fs.existsSync(filepath)) {
            return JSON.parse(fs.readFileSync(filepath, 'utf8'));
        }
    } catch (error) {
        console.error(`Error reading ${filepath}:`, error.message);
    }
    return null;
}

async function migrate() {
    console.log('Starting migration to SQLite...');
    console.log(`Database path: ${DB_PATH}`);

    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Initialize SQL.js
    const SQL = await initSqlJs();

    // Create new database
    const db = new SQL.Database();
    console.log('Created new database');

    // Load and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.run(schema);
    console.log('Schema created successfully');

    // Helper function to run parameterized queries
    function run(sql, params = []) {
        db.run(sql, params);
    }

    // Migrate raffles
    const raffles = readJsonFile(RAFFLES_FILE);
    if (raffles && Array.isArray(raffles) && raffles.length > 0) {
        console.log(`Migrating ${raffles.length} raffles...`);

        for (const r of raffles) {
            run(`
                INSERT OR REPLACE INTO raffles
                (id, number, name, description, donated_by, image, winning_number, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                r.id,
                r.number || null,
                r.name,
                r.description,
                r.donatedBy || null,
                r.image,
                r.winningNumber || null,
                r.createdAt || new Date().toISOString(),
                r.updatedAt || null
            ]);
        }
        console.log(`Migrated ${raffles.length} raffles`);
    } else {
        console.log('No raffles to migrate');
    }

    // Migrate users
    const users = readJsonFile(USERS_FILE);
    if (users && typeof users === 'object' && Object.keys(users).length > 0) {
        console.log(`Migrating ${Object.keys(users).length} users...`);

        for (const [username, passwordHash] of Object.entries(users)) {
            run(`
                INSERT OR REPLACE INTO users (username, password_hash, created_at)
                VALUES (?, ?, ?)
            `, [username, passwordHash, new Date().toISOString()]);
        }
        console.log(`Migrated ${Object.keys(users).length} users`);
    } else {
        console.log('No users to migrate');
    }

    // Migrate rules
    const rulesData = readJsonFile(RULES_FILE);
    if (rulesData && rulesData.rules) {
        console.log('Migrating rules...');

        run(`
            INSERT INTO rules (id, rules, updated_at) VALUES (1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at
        `, [rulesData.rules, new Date().toISOString()]);
        console.log('Migrated rules');
    } else {
        console.log('No rules to migrate');
    }

    // Migrate sponsors
    const sponsors = readJsonFile(SPONSORS_FILE);
    if (sponsors && Array.isArray(sponsors) && sponsors.length > 0) {
        console.log(`Migrating ${sponsors.length} sponsors...`);

        for (const s of sponsors) {
            run(`
                INSERT OR REPLACE INTO sponsors (id, name, logo, website_url, created_at)
                VALUES (?, ?, ?, ?, ?)
            `, [
                s.id,
                s.name,
                s.logo,
                s.websiteUrl || null,
                s.createdAt || new Date().toISOString()
            ]);
        }
        console.log(`Migrated ${sponsors.length} sponsors`);
    } else {
        console.log('No sponsors to migrate');
    }

    // Save database to file
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);

    // Close database
    db.close();

    console.log('\nMigration complete!');
    console.log('Original JSON files have been kept as backup.');
    console.log(`Database created at: ${DB_PATH}`);

    // Verify migration
    console.log('\nVerifying migration...');
    const fileBuffer = fs.readFileSync(DB_PATH);
    const verifyDb = new SQL.Database(fileBuffer);

    function count(table) {
        const stmt = verifyDb.prepare(`SELECT COUNT(*) as count FROM ${table}`);
        stmt.step();
        const result = stmt.getAsObject();
        stmt.free();
        return result.count;
    }

    console.log('Record counts:');
    console.log(`  Raffles: ${count('raffles')}`);
    console.log(`  Users: ${count('users')}`);
    console.log(`  Rules: ${count('rules')}`);
    console.log(`  Sponsors: ${count('sponsors')}`);

    verifyDb.close();
}

// Run migration
migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
