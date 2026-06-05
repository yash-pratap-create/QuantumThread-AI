const express = require("express");
const s3Store = require("../services/s3Store");
const router = express.Router();

// Helper: Get project ID from repo name
async function getProjectIdByName(name) {
  const projects = await s3Store.getProjects();
  const p = projects.find((x) => x.name === name);
  return p ? p.id : null;
}

// Helper: Get intelligence for a repo name
async function getIntelligenceByRepoName(repoName) {
  if (!repoName) return null;
  const projectId = await getProjectIdByName(repoName);
  if (!projectId) return null;
  return await s3Store.getIntelligence(projectId);
}

// ── GET /intelligence/modules ──────────────────────────
// Returns all modules, optionally filtered by ?repo=
router.get("/modules", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel || !Array.isArray(intel.modules)) return res.json([]);

    const modules = intel.modules.map((r, index) => ({
      id: r.id || index + 1,
      name: r.name,
      module: r.name, // alias for BugRisk page
      riskScore: r.risk_score,
      riskLevel: r.risk_level,
      bugCount: r.bug_count,
      dependencyCount: r.dependency_count,
      impactRadius: r.impact_radius,
      lastModified: r.last_modified,
      bugs: typeof r.bugs === "string" ? JSON.parse(r.bugs) : r.bugs || [],
      aiSummary: r.ai_summary,
      repository: r.repository || repo,
    }));
    res.json(modules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/modules/:id ──────────────────────
router.get("/modules/:id", async (req, res) => {
  try {
    const projects = await s3Store.getProjects();
    for (const p of projects) {
      const intel = await s3Store.getIntelligence(p.id);
      if (intel && Array.isArray(intel.modules)) {
        const foundIndex = intel.modules.findIndex((m, index) => String(m.id || index + 1) === String(req.params.id));
        if (foundIndex >= 0) {
          const found = intel.modules[foundIndex];
          return res.json({
            id: found.id || foundIndex + 1,
            name: found.name,
            module: found.name,
            riskScore: found.risk_score,
            riskLevel: found.risk_level,
            bugCount: found.bug_count,
            dependencyCount: found.dependency_count,
            impactRadius: found.impact_radius,
            lastModified: found.last_modified,
            bugs: typeof found.bugs === "string" ? JSON.parse(found.bugs) : found.bugs || [],
            aiSummary: found.ai_summary,
            repository: found.repository || p.name,
          });
        }
      }
    }
    res.status(404).json({ error: "Module not found" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/vulnerabilities ──────────────────
router.get("/vulnerabilities", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel || !Array.isArray(intel.vulnerabilities)) return res.json([]);

    const vulns = intel.vulnerabilities.map((r, index) => ({
      id: r.id || index + 1,
      cve: r.cve,
      severity: r.severity,
      exploitability: r.exploitability,
      affectedVersions: r.affected_versions,
      library: r.library,
      patchVersion: r.patch_version,
      description: r.description,
      affectedModules: r.affected_modules,
      dependencyChain: r.dependency_chain,
      repository: r.repository || repo,
    }));
    res.json(vulns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/dependencies ─────────────────────
router.get("/dependencies", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel || !Array.isArray(intel.dependencies)) return res.json([]);

    const deps = intel.dependencies.map((r, index) => ({
      id: r.id || index + 1,
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
      directDeps: typeof r.direct_deps === "string" ? JSON.parse(r.direct_deps) : r.direct_deps || [],
      reverseDeps: typeof r.reverse_deps === "string" ? JSON.parse(r.reverse_deps) : r.reverse_deps || [],
      repository: r.repository || repo,
    }));
    res.json(deps);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/evolution ────────────────────────
router.get("/evolution", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json([]);

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel || !Array.isArray(intel.time_periods)) return res.json([]);

    const periods = intel.time_periods.map((r, index) => ({
      id: r.id || index + 1,
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
      repository: r.repository || repo,
      commit_hash: r.commit_hash,
      author: r.author,
      total_commits: r.total_commits ?? null,
      data_source: r.data_source || 'estimated'
    }));
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /intelligence/architecture ─────────────────────
router.get("/architecture", async (req, res) => {
  try {
    const repo = req.query.repo;
    if (!repo) return res.json({ nodes: [], edges: [], repository: "" });

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel) return res.json({ nodes: [], edges: [], repository: repo });

    const nodeRows = intel.architecture_nodes || [];
    const edgeRows = intel.architecture_edges || [];

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
      animated: r.animated === 1 || r.animated === true,
      style: { stroke: r.stroke, strokeWidth: r.stroke_width },
    }));

    res.json({ nodes, edges, repository: repo });
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

    const intel = await getIntelligenceByRepoName(repo);
    if (!intel) return res.json({
      repository: repo,
      totalModules: 0,
      highRiskModules: 0,
      totalVulnerabilities: 0,
      criticalVulnerabilities: 0,
      totalDependencies: 0,
      latestVersion: "N/A",
      currentRiskScore: 0,
    });

    const modules = intel.modules || [];
    const vulnerabilities = intel.vulnerabilities || [];
    const dependencies = intel.dependencies || [];
    const timePeriods = intel.time_periods || [];

    const totalModules = modules.length;
    const highRiskModules = modules.filter(m => m.risk_level === "high").length;
    const totalVulnerabilities = vulnerabilities.length;
    const criticalVulnerabilities = vulnerabilities.filter(v => v.severity === "critical").length;
    const totalDependencies = dependencies.length;
    const latestPeriod = timePeriods[timePeriods.length - 1];

    res.json({
      repository: repo,
      totalModules,
      highRiskModules,
      totalVulnerabilities,
      criticalVulnerabilities,
      totalDependencies,
      latestVersion: latestPeriod?.version || "N/A",
      currentRiskScore: latestPeriod?.risk_score || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
