const express = require("express");
const { dbAll, dbGet, dbRun } = require("../db");
const router = express.Router();

// ── GET /intelligence/modules ──────────────────────────
// Returns all modules, optionally filtered by ?repo=
router.get("/modules", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);
    const rows = await dbAll(
      "SELECT * FROM modules WHERE repository = ? ORDER BY risk_score DESC",
      [repo]
    );
    // Parse JSON bugs field
    const modules = rows.map((r) => ({
      id: r.id,
      name: r.name,
      module: r.name, // alias for BugRisk page
      riskScore: r.risk_score,
      riskLevel: r.risk_level,
      bugCount: r.bug_count,
      dependencyCount: r.dependency_count,
      impactRadius: r.impact_radius,
      lastModified: r.last_modified,
      bugs: JSON.parse(r.bugs || "[]"),
      aiSummary: r.ai_summary,
      repository: r.repository,
    }));
    res.json(modules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/modules/:id ──────────────────────
router.get("/modules/:id", async (req, res) => {
  try {
    const row = await dbGet("SELECT * FROM modules WHERE id = ?", [
      req.params.id,
    ]);
    if (!row) return res.status(404).json({ error: "Module not found" });
    res.json({
      id: row.id,
      name: row.name,
      module: row.name,
      riskScore: row.risk_score,
      riskLevel: row.risk_level,
      bugCount: row.bug_count,
      dependencyCount: row.dependency_count,
      impactRadius: row.impact_radius,
      lastModified: row.last_modified,
      bugs: JSON.parse(row.bugs || "[]"),
      aiSummary: row.ai_summary,
      repository: row.repository,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/modules ─────────────────────────
router.post("/modules", async (req, res) => {
  try {
    const {
      name,
      riskScore = 0,
      riskLevel = "low",
      bugCount = 0,
      dependencyCount = 0,
      impactRadius = 0,
      lastModified = "",
      bugs = [],
      aiSummary = "",
      repository = "",
    } = req.body;
    const result = await dbRun(
      `INSERT INTO modules (name, risk_score, risk_level, bug_count, dependency_count, impact_radius, last_modified, bugs, ai_summary, repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        riskScore,
        riskLevel,
        bugCount,
        dependencyCount,
        impactRadius,
        lastModified,
        JSON.stringify(bugs),
        aiSummary,
        repository,
      ]
    );
    res.status(201).json({ id: result.lastID, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/vulnerabilities ──────────────────
router.get("/vulnerabilities", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);
    const rows = await dbAll(
      "SELECT * FROM vulnerabilities WHERE repository = ? ORDER BY exploitability DESC",
      [repo]
    );
    const vulns = rows.map((r) => ({
      id: r.id,
      cve: r.cve,
      severity: r.severity,
      exploitability: r.exploitability,
      affectedVersions: r.affected_versions,
      library: r.library,
      patchVersion: r.patch_version,
      description: r.description,
      affectedModules: r.affected_modules,
      dependencyChain: r.dependency_chain,
      repository: r.repository,
    }));
    res.json(vulns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/vulnerabilities ─────────────────
router.post("/vulnerabilities", async (req, res) => {
  try {
    const {
      cve,
      severity = "medium",
      exploitability = 0,
      affectedVersions = "",
      library = "",
      patchVersion = "",
      description = "",
      affectedModules = 0,
      dependencyChain = "",
      repository = "",
    } = req.body;
    const result = await dbRun(
      `INSERT INTO vulnerabilities (cve, severity, exploitability, affected_versions, library, patch_version, description, affected_modules, dependency_chain, repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        cve,
        severity,
        exploitability,
        affectedVersions,
        library,
        patchVersion,
        description,
        affectedModules,
        dependencyChain,
        repository,
      ]
    );
    res.status(201).json({ id: result.lastID, cve });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/dependencies ─────────────────────
router.get("/dependencies", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);
    const rows = await dbAll(
      "SELECT * FROM dependencies WHERE repository = ? ORDER BY gravity DESC",
      [repo]
    );
    const deps = rows.map((r) => ({
      id: r.id,
      module: r.module,
      incomingCount: r.incoming_count,
      outgoingCount: r.outgoing_count,
      inDegree: r.incoming_count,
      outDegree: r.outgoing_count,
      gravity: r.gravity,
      depth: r.depth,
      circularDeps: r.circular_deps,
      circularInvolvement: r.circular_deps > 0,
      implicitDeps: r.implicit_deps,
      fans: { in: r.fan_in, out: r.fan_out },
      volatility: r.volatility,
      chain: r.chain,
      transitiveExposure: r.transitive_exposure,
      directDeps: JSON.parse(r.direct_deps || '[]'),
      reverseDeps: JSON.parse(r.reverse_deps || '[]'),
      repository: r.repository,
    }));
    res.json(deps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/dependencies ────────────────────
router.post("/dependencies", async (req, res) => {
  try {
    const {
      module: modName,
      incomingCount = 0,
      outgoingCount = 0,
      gravity = 0,
      depth = 0,
      circularDeps = 0,
      implicitDeps = 0,
      fans = {},
      volatility = 0,
      chain = "",
      transitiveExposure = 0,
      directDeps = [],
      reverseDeps = [],
      repository = "",
    } = req.body;
    const result = await dbRun(
      `INSERT INTO dependencies (module, incoming_count, outgoing_count, gravity, depth, circular_deps, implicit_deps, fan_in, fan_out, volatility, chain, transitive_exposure, direct_deps, reverse_deps, repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        modName,
        incomingCount,
        outgoingCount,
        gravity,
        depth,
        circularDeps,
        implicitDeps,
        fans.in || 0,
        fans.out || 0,
        volatility,
        chain,
        transitiveExposure,
        JSON.stringify(directDeps),
        JSON.stringify(reverseDeps),
        repository,
      ]
    );
    res.status(201).json({ id: result.lastID, module: modName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/evolution ────────────────────────
router.get("/evolution", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);
    const rows = await dbAll(
      "SELECT * FROM time_periods WHERE repository = ? ORDER BY id ASC",
      [repo]
    );
    const periods = rows.map((r) => ({
      id: r.id,
      version: r.version,
      date: r.date,
      riskScore: r.risk_score,
      vulnerability_accumulation: r.vulnerability_accumulation,
      dependency_count: r.dependency_count,
      entropy: r.entropy,
      modulesChanged: r.modules_changed,
      commitCount: r.commit_count,
      avgCommitSize: r.avg_commit_size,
      codeChurn: r.code_churn,
      daysToRelease: r.days_to_release,
      breakingChanges: r.breaking_changes,
      bugsFixed: r.bugs_fixed,
      featureCount: r.feature_count,
      repository: r.repository,
    }));
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/evolution ───────────────────────
router.post("/evolution", async (req, res) => {
  try {
    const {
      version,
      date = "",
      riskScore = 0,
      vulnerability_accumulation = 0,
      dependency_count = 0,
      entropy = 0,
      modulesChanged = 0,
      commitCount = 0,
      avgCommitSize = 0,
      codeChurn = 0,
      daysToRelease = 0,
      breakingChanges = 0,
      bugsFixed = 0,
      featureCount = 0,
      repository = "",
    } = req.body;
    const result = await dbRun(
      `INSERT INTO time_periods (version, date, risk_score, vulnerability_accumulation, dependency_count, entropy, modules_changed, commit_count, avg_commit_size, code_churn, days_to_release, breaking_changes, bugs_fixed, feature_count, repository)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        version,
        date,
        riskScore,
        vulnerability_accumulation,
        dependency_count,
        entropy,
        modulesChanged,
        commitCount,
        avgCommitSize,
        codeChurn,
        daysToRelease,
        breakingChanges,
        bugsFixed,
        featureCount,
        repository,
      ]
    );
    res.status(201).json({ id: result.lastID, version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/architecture ─────────────────────
router.get("/architecture", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json({ nodes: [], edges: [], repository: "" });
    const nodeRows = await dbAll(
      "SELECT * FROM architecture_nodes WHERE repository = ?",
      [repo]
    );
    const edgeRows = await dbAll(
      "SELECT * FROM architecture_edges WHERE repository = ?",
      [repo]
    );

    console.log(`[Architecture API] repo="${repo}" → ${nodeRows.length} nodes, ${edgeRows.length} edges`);

    const nodes = nodeRows.map((r) => ({
      id: r.node_id,
      position: { x: r.position_x, y: r.position_y },
      data: {
        label: r.label,
        risk: r.risk,
        load: r.load,
        riskScore: r.risk_score,
      },
    }));

    const edges = edgeRows.map((r) => ({
      id: r.edge_id,
      source: r.source,
      target: r.target,
      animated: r.animated === 1,
      style: { stroke: r.stroke, strokeWidth: r.stroke_width },
    }));

    res.json({ nodes, edges, repository: repo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/architecture/nodes ──────────────
router.post("/architecture/nodes", async (req, res) => {
  try {
    const {
      nodeId,
      repository = "",
      positionX = 0,
      positionY = 0,
      label = "",
      risk = "low",
      load = 0,
      riskScore = 0,
    } = req.body;
    const result = await dbRun(
      `INSERT INTO architecture_nodes (node_id, repository, position_x, position_y, label, risk, load, risk_score)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nodeId, repository, positionX, positionY, label, risk, load, riskScore]
    );
    res.status(201).json({ id: result.lastID, nodeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /intelligence/architecture/edges ──────────────
router.post("/architecture/edges", async (req, res) => {
  try {
    const {
      edgeId,
      repository = "",
      source,
      target,
      animated = false,
      stroke = "#94a3b8",
      strokeWidth = 1.5,
    } = req.body;
    const result = await dbRun(
      `INSERT INTO architecture_edges (edge_id, repository, source, target, animated, stroke, stroke_width)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [edgeId, repository, source, target, animated ? 1 : 0, stroke, strokeWidth]
    );
    res.status(201).json({ id: result.lastID, edgeId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/summary ──────────────────────────
// Combined dashboard data in one call
router.get("/summary", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json({
      repository: "",
      totalModules: 0,
      highRiskModules: 0,
      totalVulnerabilities: 0,
      criticalVulnerabilities: 0,
      totalDependencies: 0,
      latestVersion: "N/A",
      currentRiskScore: 0,
    });

    const moduleCount = await dbGet(
      "SELECT COUNT(*) as count FROM modules WHERE repository = ?",
      [repo]
    );
    const highRiskCount = await dbGet(
      "SELECT COUNT(*) as count FROM modules WHERE repository = ? AND risk_level = 'high'",
      [repo]
    );
    const vulnCount = await dbGet(
      "SELECT COUNT(*) as count FROM vulnerabilities WHERE repository = ?",
      [repo]
    );
    const criticalVulns = await dbGet(
      "SELECT COUNT(*) as count FROM vulnerabilities WHERE repository = ? AND severity = 'critical'",
      [repo]
    );
    const depCount = await dbGet(
      "SELECT COUNT(*) as count FROM dependencies WHERE repository = ?",
      [repo]
    );
    const latestVersion = await dbGet(
      "SELECT version, risk_score FROM time_periods WHERE repository = ? ORDER BY id DESC LIMIT 1",
      [repo]
    );

    res.json({
      repository: repo,
      totalModules: moduleCount?.count || 0,
      highRiskModules: highRiskCount?.count || 0,
      totalVulnerabilities: vulnCount?.count || 0,
      criticalVulnerabilities: criticalVulns?.count || 0,
      totalDependencies: depCount?.count || 0,
      latestVersion: latestVersion?.version || "N/A",
      currentRiskScore: latestVersion?.risk_score || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
