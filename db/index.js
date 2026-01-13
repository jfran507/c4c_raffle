const initSqlJs = require('sql.js');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'raffle.db');

let db = null;
let SQL = null;
let initialized = false;
let saveTimeout = null;

// Write lock to prevent concurrent async writes
let isWriting = false;
let pendingWrite = false;

// Debounced save to reduce disk writes
function scheduleSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveDatabase();
    }, 1000); // Save 1 second after last write
}

// Async database save - doesn't block the event loop
async function saveDatabase() {
    if (!db) return;

    // If already writing, mark pending and return
    if (isWriting) {
        pendingWrite = true;
        return;
    }

    isWriting = true;

    try {
        const data = db.export();
        const buffer = Buffer.from(data);
        const dataDir = path.dirname(DB_PATH);

        // Ensure directory exists (async)
        await fsPromises.mkdir(dataDir, { recursive: true }).catch(() => {});

        // Write atomically using temp file to prevent corruption
        const tempPath = DB_PATH + '.tmp';
        await fsPromises.writeFile(tempPath, buffer);
        await fsPromises.rename(tempPath, DB_PATH);

    } catch (error) {
        console.error('Error saving database:', error);
    } finally {
        isWriting = false;

        // If write was requested during this operation, do it now
        if (pendingWrite) {
            pendingWrite = false;
            setImmediate(() => saveDatabase());
        }
    }
}

async function initDb() {
    if (initialized) return db;

    // Initialize SQL.js
    SQL = await initSqlJs();

    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing database or create new
    try {
        if (fs.existsSync(DB_PATH)) {
            const fileBuffer = fs.readFileSync(DB_PATH);
            db = new SQL.Database(fileBuffer);
            console.log('Loaded existing database from:', DB_PATH);
        } else {
            db = new SQL.Database();
            console.log('Created new database');
        }
    } catch (error) {
        console.error('Error loading database, creating new:', error);
        db = new SQL.Database();
    }

    // Initialize schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        db.run(schema);
        scheduleSave();
    }

    initialized = true;
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return db;
}

// Helper to run a query that returns rows
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

// Helper to run a query that returns one row
function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

// Helper to run an update/insert query
function run(sql, params = []) {
    db.run(sql, params);
    scheduleSave();
    return { changes: db.getRowsModified() };
}

// Prepared statement-like interface for compatibility
const statements = {
    // Raffle statements
    getAllRaffles: {
        all: () => queryAll(`
            SELECT id, number, name, description, donated_by as donatedBy,
                   image, winning_number as winningNumber, created_at as createdAt, updated_at as updatedAt
            FROM raffles
            ORDER BY COALESCE(number, 999999), id
        `)
    },

    getRaffleById: {
        get: (id) => queryOne(`
            SELECT id, number, name, description, donated_by as donatedBy,
                   image, winning_number as winningNumber, created_at as createdAt, updated_at as updatedAt
            FROM raffles WHERE id = ?
        `, [id])
    },

    getMaxNumber: {
        get: () => queryOne(`SELECT MAX(number) as maxNum FROM raffles`)
    },

    insertRaffle: {
        run: (id, number, name, description, donatedBy, image, winningNumber, createdAt) => {
            return run(`
                INSERT INTO raffles (id, number, name, description, donated_by, image, winning_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [id, number, name, description, donatedBy, image, winningNumber, createdAt]);
        }
    },

    updateRaffle: {
        run: (name, description, donatedBy, updatedAt, id) => {
            return run(`
                UPDATE raffles SET name = ?, description = ?, donated_by = ?, updated_at = ?
                WHERE id = ?
            `, [name, description, donatedBy, updatedAt, id]);
        }
    },

    updateRaffleImage: {
        run: (image, updatedAt, id) => {
            return run(`UPDATE raffles SET image = ?, updated_at = ? WHERE id = ?`, [image, updatedAt, id]);
        }
    },

    updateWinner: {
        run: (winningNumber, updatedAt, id) => {
            return run(`UPDATE raffles SET winning_number = ?, updated_at = ? WHERE id = ?`, [winningNumber, updatedAt, id]);
        }
    },

    updateRaffleNumber: {
        run: (number, id) => {
            return run(`UPDATE raffles SET number = ? WHERE id = ?`, [number, id]);
        }
    },

    deleteRaffle: {
        run: (id) => {
            return run(`DELETE FROM raffles WHERE id = ?`, [id]);
        }
    },

    // User statements
    getUserByUsername: {
        get: (username) => queryOne(`
            SELECT username, password_hash as passwordHash, created_at as createdAt
            FROM users WHERE username = ?
        `, [username])
    },

    insertUser: {
        run: (username, passwordHash, createdAt) => {
            return run(`INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)`,
                [username, passwordHash, createdAt]);
        }
    },

    updateUserPassword: {
        run: (passwordHash, username) => {
            return run(`UPDATE users SET password_hash = ? WHERE username = ?`, [passwordHash, username]);
        }
    },

    getAllUsers: {
        all: () => queryAll(`SELECT username FROM users`)
    },

    // Rules statements
    getRules: {
        get: () => queryOne(`SELECT rules, updated_at as updatedAt FROM rules WHERE id = 1`)
    },

    upsertRules: {
        run: (rules, updatedAt) => {
            return run(`
                INSERT INTO rules (id, rules, updated_at) VALUES (1, ?, ?)
                ON CONFLICT(id) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at
            `, [rules, updatedAt]);
        }
    },

    // Sponsor statements
    getAllSponsors: {
        all: () => queryAll(`
            SELECT id, name, logo, website_url as websiteUrl, created_at as createdAt
            FROM sponsors ORDER BY created_at
        `)
    },

    getSponsorById: {
        get: (id) => queryOne(`SELECT * FROM sponsors WHERE id = ?`, [id])
    },

    insertSponsor: {
        run: (id, name, logo, websiteUrl, createdAt) => {
            return run(`INSERT INTO sponsors (id, name, logo, website_url, created_at) VALUES (?, ?, ?, ?, ?)`,
                [id, name, logo, websiteUrl, createdAt]);
        }
    },

    deleteSponsor: {
        run: (id) => {
            return run(`DELETE FROM sponsors WHERE id = ?`, [id]);
        }
    },

    // Version statements for cache invalidation
    getVersion: {
        get: (key) => queryOne(`SELECT version FROM data_versions WHERE key = ?`, [key])
    },

    incrementVersion: {
        run: (updatedAt, key) => {
            return run(`UPDATE data_versions SET version = version + 1, updated_at = ? WHERE key = ?`,
                [updatedAt, key]);
        }
    }
};

// Transaction helper (sql.js doesn't have built-in transaction support like better-sqlite3)
function transaction(fn) {
    return () => {
        db.run('BEGIN TRANSACTION');
        try {
            fn();
            db.run('COMMIT');
            scheduleSave();
        } catch (error) {
            db.run('ROLLBACK');
            throw error;
        }
    };
}

// Increment version and return new version
function bumpVersion(key) {
    statements.incrementVersion.run(new Date().toISOString(), key);
    return statements.getVersion.get(key)?.version || 0;
}

// Close database connection gracefully
function closeDb() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
        saveDatabase(); // Final save
    }
    if (db) {
        db.close();
        db = null;
        initialized = false;
    }
}

// Handle process termination
process.on('exit', closeDb);
process.on('SIGINT', () => {
    closeDb();
    process.exit(0);
});
process.on('SIGTERM', () => {
    closeDb();
    process.exit(0);
});

module.exports = {
    initDb,
    getDb,
    get statements() {
        return statements;
    },
    transaction,
    bumpVersion,
    closeDb,
    saveDatabase
};
