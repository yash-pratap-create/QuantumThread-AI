const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = path.join(__dirname, "quantumthread.db");

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("❌ Failed to connect to SQLite:", err.message);
  else console.log("✅ Connected to SQLite database");
});

function initializeDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          repo_url TEXT,
          source_path TEXT,
          s3_key TEXT,
          status TEXT DEFAULT 'ready',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Migrations for existing tables
      db.run(`ALTER TABLE projects ADD COLUMN repo_url TEXT`, () => { });
      db.run(`ALTER TABLE projects ADD COLUMN source_path TEXT`, () => { });
      db.run(`ALTER TABLE projects ADD COLUMN status TEXT DEFAULT 'ready'`, () => { });
      db.run(`ALTER TABLE projects ADD COLUMN s3_key TEXT`, () => { });
      db.run(`ALTER TABLE time_periods ADD COLUMN commit_hash TEXT`, () => { });
      db.run(`ALTER TABLE time_periods ADD COLUMN author TEXT`, () => { });

      db.run(`
        CREATE TABLE IF NOT EXISTS chat_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER,
          agent TEXT NOT NULL,
          user_message TEXT NOT NULL,
          agent_reply TEXT NOT NULL,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS agent_insights (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER,
          agent TEXT NOT NULL,
          summary TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS impact_analysis (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          risk TEXT NOT NULL,
          affected_services TEXT NOT NULL,
          affected_teams TEXT NOT NULL,
          confidence REAL NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (project_id) REFERENCES projects(id)
        )
      `);

      // ── Intelligence data tables ──────────────────────
      db.run(`
        CREATE TABLE IF NOT EXISTS modules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          risk_score INTEGER DEFAULT 0,
          risk_level TEXT DEFAULT 'low',
          bug_count INTEGER DEFAULT 0,
          dependency_count INTEGER DEFAULT 0,
          impact_radius INTEGER DEFAULT 0,
          last_modified TEXT,
          bugs TEXT DEFAULT '[]',
          ai_summary TEXT,
          repository TEXT DEFAULT ''
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS vulnerabilities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          cve TEXT NOT NULL,
          severity TEXT DEFAULT 'medium',
          exploitability REAL DEFAULT 0,
          affected_versions TEXT,
          library TEXT,
          patch_version TEXT,
          description TEXT,
          affected_modules INTEGER DEFAULT 0,
          dependency_chain TEXT,
          repository TEXT DEFAULT ''
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS dependencies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          module TEXT NOT NULL,
          incoming_count INTEGER DEFAULT 0,
          outgoing_count INTEGER DEFAULT 0,
          gravity INTEGER DEFAULT 0,
          depth INTEGER DEFAULT 0,
          circular_deps INTEGER DEFAULT 0,
          implicit_deps INTEGER DEFAULT 0,
          fan_in INTEGER DEFAULT 0,
          fan_out INTEGER DEFAULT 0,
          volatility REAL DEFAULT 0,
          chain TEXT,
          transitive_exposure INTEGER DEFAULT 0,
          direct_deps TEXT DEFAULT '[]',
          reverse_deps TEXT DEFAULT '[]',
          repository TEXT DEFAULT ''
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS time_periods (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT NOT NULL,
          date TEXT,
          risk_score INTEGER DEFAULT 0,
          vulnerability_accumulation INTEGER DEFAULT 0,
          dependency_count INTEGER DEFAULT 0,
          entropy REAL DEFAULT 0,
          modules_changed INTEGER DEFAULT 0,
          commit_count INTEGER DEFAULT 0,
          avg_commit_size REAL DEFAULT 0,
          code_churn INTEGER DEFAULT 0,
          days_to_release INTEGER DEFAULT 0,
          breaking_changes INTEGER DEFAULT 0,
          bugs_fixed INTEGER DEFAULT 0,
          feature_count INTEGER DEFAULT 0,
          repository TEXT DEFAULT '',
          commit_hash TEXT,
          author TEXT
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS architecture_nodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          node_id TEXT NOT NULL,
          repository TEXT NOT NULL,
          position_x REAL DEFAULT 0,
          position_y REAL DEFAULT 0,
          label TEXT,
          risk TEXT DEFAULT 'low',
          load INTEGER DEFAULT 0,
          risk_score INTEGER DEFAULT 0
        )
      `);

      db.run(
        `
        CREATE TABLE IF NOT EXISTS architecture_edges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          edge_id TEXT NOT NULL,
          repository TEXT NOT NULL,
          source TEXT NOT NULL,
          target TEXT NOT NULL,
          animated INTEGER DEFAULT 0,
          stroke TEXT DEFAULT '#94a3b8',
          stroke_width REAL DEFAULT 1.5
        )
      `,
        (err) => {
          if (err) {
            console.error("❌ Error creating tables:", err.message);
            reject(err);
          } else {
            // Create indexes for faster repository-specific lookups (optimize project switches)
            db.serialize(() => {
              db.run("CREATE INDEX IF NOT EXISTS idx_modules_repo ON modules(repository)");
              db.run("CREATE INDEX IF NOT EXISTS idx_vulnerabilities_repo ON vulnerabilities(repository)");
              db.run("CREATE INDEX IF NOT EXISTS idx_dependencies_repo ON dependencies(repository)");
              db.run("CREATE INDEX IF NOT EXISTS idx_time_periods_repo ON time_periods(repository)");
              db.run("CREATE INDEX IF NOT EXISTS idx_arch_nodes_repo ON architecture_nodes(repository)");
              db.run("CREATE INDEX IF NOT EXISTS idx_arch_edges_repo ON architecture_edges(repository)", (indexErr) => {
                if (indexErr) {
                  console.error("❌ Error creating indexes:", indexErr.message);
                  reject(indexErr);
                } else {
                  console.log("✅ All database tables and indexes ready");
                  resolve();
                }
              });
            });
          }
        }
      );
    });
  });
}

// ── Promisified helpers for async orchestrator ──────
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

module.exports = { db, dbGet, dbAll, dbRun, initializeDatabase };
