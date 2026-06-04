require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initializeDatabase, dbGet, dbRun, dbAll } = require("./db");
const { isS3Enabled, listProjectsFromS3, loadIntelligenceFromS3 } = require("./services/s3Storage");
const { generateEvolutionTimeline } = require("./services/evolutionTimeline");

const projectsRouter = require("./routes/projects");
const chatRouter = require("./routes/chat");
const impactRouter = require("./routes/impact");
const intelligenceRouter = require("./routes/intelligence");
const codeRouter = require("./routes/code");

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /\.amplifyapp\.com$/.test(origin) ||
        /^http:\/\/localhost(:\d+)?$/.test(origin)
      ) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));

// ── Root ───────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({ status: "ok", service: "QuantumThread AI Backend" });
});

// ── Health check ───────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "QuantumThread AI Backend",
    timestamp: new Date().toISOString(),
    agents: ["architecture", "bug_detection", "security", "performance", "tutor"],
  });
});

// ── Routes ─────────────────────────────────────────────
app.use("/projects", projectsRouter);
app.use("/chat", chatRouter);
app.use("/impact", impactRouter);
app.use("/intelligence", intelligenceRouter);
app.use("/code", codeRouter);

// ── Catch-all 404 handler for API routes ───────────────
app.use((req, res, next) => {
  res.status(404).json({ error: `API Route ${req.method} ${req.path} not found` });
});

// ── Error handler ──────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

// Helper to restore S3 cached intelligence JSON back into local SQLite tables
async function restoreIntelligenceData(repoName, cache) {
  try {
    // Clear any existing data for safety
    await dbRun("DELETE FROM modules WHERE repository = ?", [repoName]);
    await dbRun("DELETE FROM vulnerabilities WHERE repository = ?", [repoName]);
    await dbRun("DELETE FROM dependencies WHERE repository = ?", [repoName]);
    await dbRun("DELETE FROM time_periods WHERE repository = ?", [repoName]);
    await dbRun("DELETE FROM architecture_nodes WHERE repository = ?", [repoName]);
    await dbRun("DELETE FROM architecture_edges WHERE repository = ?", [repoName]);

    // Restore modules
    if (Array.isArray(cache.modules)) {
      for (const m of cache.modules) {
        await dbRun(
          `INSERT INTO modules (name, risk_score, risk_level, bug_count, dependency_count, impact_radius, last_modified, bugs, ai_summary, repository)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [m.name, m.risk_score, m.risk_level, m.bug_count, m.dependency_count, m.impact_radius, m.last_modified, m.bugs, m.ai_summary, repoName]
        );
      }
    }

    // Restore vulnerabilities
    if (Array.isArray(cache.vulnerabilities)) {
      for (const v of cache.vulnerabilities) {
        await dbRun(
          `INSERT INTO vulnerabilities (cve, severity, exploitability, affected_versions, library, patch_version, description, affected_modules, dependency_chain, repository)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [v.cve, v.severity, v.exploitability, v.affected_versions, v.library, v.patch_version, v.description, v.affected_modules, v.dependency_chain, repoName]
        );
      }
    }

    // Restore dependencies
    if (Array.isArray(cache.dependencies)) {
      for (const d of cache.dependencies) {
        await dbRun(
          `INSERT INTO dependencies (module, incoming_count, outgoing_count, gravity, depth, circular_deps, implicit_deps, fan_in, fan_out, volatility, chain, transitive_exposure, direct_deps, reverse_deps, repository)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.module, d.incoming_count, d.outgoing_count, d.gravity, d.depth, d.circular_deps, d.implicit_deps, d.fan_in, d.fan_out, d.volatility, d.chain, d.transitive_exposure, d.direct_deps, d.reverse_deps, repoName]
        );
      }
    }

    // Restore time_periods (evolution data)
    let timePeriodsToInsert = cache.time_periods;
      timePeriodsToInsert = generateEvolutionTimeline(
        repoName,
        modulesList.length,
        vulnsCount,
        depsCount,
        avgRiskScore,
        avgEntropyScore
      );
    }

    for (const t of timePeriodsToInsert) {
      await dbRun(
        `INSERT INTO time_periods (version, date, risk_score, vulnerability_accumulation, dependency_count, entropy, modules_changed, commit_count, avg_commit_size, code_churn, days_to_release, breaking_changes, bugs_fixed, feature_count, repository)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.version, t.date, t.risk_score, t.vulnerability_accumulation, t.dependency_count, t.entropy, t.modules_changed, t.commit_count, t.avg_commit_size, t.code_churn, t.days_to_release, t.breaking_changes, t.bugs_fixed, t.feature_count, repoName]
      );
    }

    // Restore architecture nodes
    if (Array.isArray(cache.architecture_nodes)) {
      for (const n of cache.architecture_nodes) {
        await dbRun(
          `INSERT INTO architecture_nodes (node_id, repository, position_x, position_y, label, risk, load, risk_score)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [n.node_id, repoName, n.position_x, n.position_y, n.label, n.risk, n.load, n.risk_score]
        );
      }
    }

    // Restore architecture edges
    if (Array.isArray(cache.architecture_edges)) {
      for (const e of cache.architecture_edges) {
        await dbRun(
          `INSERT INTO architecture_edges (edge_id, repository, source, target, animated, stroke, stroke_width)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [e.edge_id, repoName, e.source, e.target, e.animated, e.stroke, e.stroke_width]
        );
      }
    }

    console.log(`☁️  Restored intelligence data from S3 cache for "${repoName}"`);
  } catch (err) {
    console.error(`⚠️  Failed to restore intelligence data cache for ${repoName}:`, err.message);
  }
}

// ── Restore projects from S3 into SQLite on every boot ─
// Render free tier wipes the filesystem on restart, so SQLite is empty each time.
// This scans S3 and re-inserts any missing project rows.
async function restoreProjectsFromS3() {
  if (!isS3Enabled()) {
    console.log("S3 not enabled — skipping project restore");
    return;
  }
  try {
    const s3Projects = await listProjectsFromS3();
    console.log(`☁️  Found ${s3Projects.length} project(s) in S3`);
    let restored = 0;
    for (const p of s3Projects) {
      const existing = await dbGet("SELECT id FROM projects WHERE id = ?", [p.id]);
      if (!existing) {
        await dbRun(
          "INSERT INTO projects (id, name, s3_key, status, created_at) VALUES (?, ?, ?, ?, ?)",
          [p.id, p.name, p.s3Key, "ready", new Date().toISOString()]
        );
        restored++;
        console.log(`☁️  Restored from S3: ${p.name} (id=${p.id})`);

        // Load intelligence cache from S3 and populate SQLite
        const cache = await loadIntelligenceFromS3(p.id).catch(() => null);
        if (cache) {
          await restoreIntelligenceData(p.name, cache);
        } else {
          console.log(`⚠️  No intelligence cache found in S3 for ${p.name} (id=${p.id})`);
        }
      }
    }
    if (restored > 0) {
      await dbRun(
        "UPDATE sqlite_sequence SET seq = (SELECT MAX(id) FROM projects) WHERE name = 'projects'"
      ).catch(() => {});
      console.log(`☁️  Restored ${restored} project(s) from S3`);
    } else {
      console.log("☁️  All S3 projects already in DB");
    }
  } catch (err) {
    console.error("⚠️  S3 project restore failed:", err.message);
  }
}

// ── Start server ───────────────────────────────────────
(async () => {
  try {
    await initializeDatabase();
    console.log("✅ Database initialized");
    await restoreProjectsFromS3();
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  }
})();