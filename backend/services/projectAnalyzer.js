/**
 * Project Analyzer — Scans uploaded project files and populates
 * intelligence DB tables using AI agents.
 */

const fs = require("fs");
const path = require("path");
const s3Store = require("./s3Store");
const { callBedrock } = require("./bedrockClient");
const { generateEvolutionTimeline } = require("./evolutionTimeline");

const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rs",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".vue", ".svelte", ".html", ".css", ".scss",
  ".json", ".yaml", ".yml", ".toml", ".xml", ".sql", ".sh", ".bat",
  ".md", ".txt", ".env.example", ".gitignore", ".dockerfile",
]);

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "__pycache__",
  ".venv", "venv", "target", "bin", "obj", ".idea", ".vscode",
  "coverage", ".cache", ".turbo",
]);

/**
 * Walk directory and collect source files.
 */
function collectFiles(dir, baseDir = dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectFiles(fullPath, baseDir));
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) || entry.name === "Dockerfile" || entry.name === "Makefile") {
          const relativePath = path.relative(baseDir, fullPath);
          try {
            const stat = fs.statSync(fullPath);
            if (stat.size < 200000) { // skip files > 200KB
              results.push({
                path: relativePath,
                fullPath,
                ext,
                size: stat.size,
                get content() {
                  if (this._content === undefined) {
                    try {
                      this._content = fs.readFileSync(this.fullPath, "utf-8");
                    } catch {
                      this._content = "";
                    }
                  }
                  return this._content;
                }
              });
            }
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch { /* skip unreadable */ }
  return results;
}

/**
 * Group files into logical modules (by top-level folder).
 */
function groupIntoModules(files) {
  const modules = {};
  for (const file of files) {
    const parts = file.path.split(/[\\/]/);
    const moduleName = parts.length > 1 ? parts[0] : "(root)";
    if (!modules[moduleName]) modules[moduleName] = [];
    modules[moduleName].push(file);
  }
  return modules;
}

/**
 * Analyze a project directory and populate the DB.
 * @param {string} projectDir - Path to the extracted project folder
 * @param {string} projectName - Name to use as repository key
 * @param {number} projectId - DB project ID
 * @param {string} repoUrl - GitHub repository URL (optional)
 */
async function analyzeProject(projectDir, projectName, projectId, repoUrl = null) {
  console.log(`\n📊 [Analyzer] Starting analysis of "${projectName}" from ${projectDir}`);

  const files = collectFiles(projectDir);
  console.log(`📊 [Analyzer] Found ${files.length} source files`);

  if (files.length === 0) {
    console.log("📊 [Analyzer] No source files found — nothing to analyze");
    return { modules: 0, files: 0 };
  }

  const moduleGroups = groupIntoModules(files);
  const moduleNames = Object.keys(moduleGroups);
  console.log(`📊 [Analyzer] Detected ${moduleNames.length} modules: ${moduleNames.join(", ")}`);

  // Build a hierarchical tree of files to give deep folder structure details
  const fileTreeText = buildFileTree(files);

  // Find and parse dependency files
  const dependencyFiles = files.filter(f => {
    const name = path.basename(f.path).toLowerCase();
    return [
      "package.json",
      "requirements.txt",
      "go.mod",
      "cargo.toml",
      "pom.xml",
      "build.gradle",
      "pipfile",
      "pyproject.toml"
    ].includes(name);
  });

  let dependencyFilesSummary = "";
  for (const f of dependencyFiles) {
    dependencyFilesSummary += `=== File: ${f.path} ===\n${(f.content || "").slice(0, 4000)}\n\n`;
  }

  // Gather code snippets (key files per module group)
  const moduleSnippets = [];
  for (const [modName, modFiles] of Object.entries(moduleGroups)) {
    const codeFiles = modFiles.filter(f => 
      [".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".kt", ".swift", ".vue", ".svelte"].includes(f.ext)
    ).sort((a, b) => b.size - a.size);

    // Take top 2 files of this module, up to 100 lines each
    const selected = codeFiles.slice(0, 2);
    for (const f of selected) {
      const lines = f.content.split("\n").slice(0, 100).join("\n");
      moduleSnippets.push(`--- Module: ${modName} | File: ${f.path} ---\n${lines}`);
    }
  }
  const codeSnippets = moduleSnippets.slice(0, 15).join("\n\n");

  // ── Run all 3 AI analyses in parallel ─────────────────
  console.log("📊 [Analyzer] Running AI analyses (modules + security + deps) in parallel...");

  const modulePrompt = `Analyze the modules in this software project.
You MUST evaluate and use the exact module names from this list:
${JSON.stringify(moduleNames)}

PROJECT: ${projectName}
PROJECT DIRECTORY STRUCTURE:
${fileTreeText.slice(0, 10000)}

CONFIGURATION & DEPENDENCIES:
${dependencyFilesSummary.slice(0, 8000)}

KEY CODE SNIPPETS:
${codeSnippets.slice(0, 16000)}

Return ONLY a JSON array containing one object per module in the list. Follow these exact keys and types:
[
  {
    "name": "string (MUST be one of the exact names from the module list above)",
    "risk_score": integer (0 to 100, indicating complexity and risk of bugs),
    "risk_level": "string (low|medium|high)",
    "bug_count": integer (estimated active bugs in this module based on complexity),
    "dependency_count": integer (number of unique packages/libraries used here),
    "impact_radius": integer (number of other modules that would be affected if this module fails, 0 to 10),
    "ai_summary": "string (1-2 sentences summarizing the module's main purpose)",
    "bugs": [
      {
        "severity": "critical|high|medium|low",
        "count": integer
      }
    ]
  }
]
Do not include any explanation, markdown, backticks, or other text outside the JSON.`;

  const secPrompt = `Perform a security scan on this project. Identify vulnerabilities, insecure code patterns, insecure configurations, or outdated/insecure packages.

PROJECT: ${projectName}
PROJECT DIRECTORY STRUCTURE:
${fileTreeText.slice(0, 10000)}

CONFIGURATION & DEPENDENCIES:
${dependencyFilesSummary.slice(0, 10000)}

KEY CODE SNIPPETS:
${codeSnippets.slice(0, 16000)}

Return ONLY a JSON array of found vulnerabilities. Follow these exact keys and types:
[
  {
    "cve": "string (e.g. CVE-YYYY-NNNN if matching an actual package, or QT-YYYY-NNNN for custom code flaws)",
    "severity": "string (critical|high|medium|low)",
    "exploitability": float (0.0 to 1.0, likelihood and ease of exploit),
    "library": "string (the package name, file path, or 'Custom Code')",
    "description": "string (details of the security issue, risk, and threat vector)",
    "affected_modules": integer (number of modules affected by this flaw),
    "dependency_chain": "string (e.g., package-a -> package-b -> vulnerable-package, or file path)",
    "affected_versions": "string (e.g., < 4.17.2 or 'All versions')",
    "patch_version": "string (e.g., 4.17.2 or 'Upgrade code structure')"
  }
]
If no security risks or vulnerabilities are found, return a JSON empty array [].
Do not include any explanation, markdown, backticks, or other text outside the JSON.`;

  const depPrompt = `Analyze the internal dependencies of this project.
You MUST map the dependencies between the exact module names in this list:
${JSON.stringify(moduleNames)}

PROJECT: ${projectName}
PROJECT DIRECTORY STRUCTURE:
${fileTreeText.slice(0, 10000)}

CONFIGURATION & DEPENDENCIES:
${dependencyFilesSummary.slice(0, 8000)}

KEY CODE SNIPPETS:
${codeSnippets.slice(0, 16000)}

Determine which modules in the list import/use other modules in the list.
Return ONLY a JSON array. Each element represents a module and its direct internal dependencies.
Follow these exact keys and types:
[
  {
    "module": "string (MUST be one of the exact names from the module list above)",
    "direct_deps": ["string (array of other module names from the module list above that this module directly imports/uses)"]
  }
]
Do not include any explanation, markdown, backticks, or other text outside the JSON.`;

  const genOpts = { max_gen_len: 3000 };
  const [moduleResult, secResult, depResult] = await Promise.allSettled([
    callBedrock(modulePrompt, genOpts),
    callBedrock(secPrompt, genOpts),
    callBedrock(depPrompt, genOpts),
  ]);

  // ── Process modules result ────────────────────────────
  const moduleList = [];
  if (moduleResult.status === "fulfilled") {
    try {
      const moduleData = parseJsonFromAI(moduleResult.value);
      if (Array.isArray(moduleData) && moduleData.length > 0) {
        for (const m of moduleData) {
          moduleList.push({
            name: m.name || "unknown",
            risk_score: clamp(m.risk_score, 0, 100),
            risk_level: m.risk_level || "low",
            bug_count: m.bug_count || 0,
            dependency_count: m.dependency_count || 0,
            impact_radius: m.impact_radius || 0,
            last_modified: new Date().toISOString(),
            bugs: JSON.stringify(m.bugs || []),
            ai_summary: m.ai_summary || "",
            repository: projectName,
          });
        }
        console.log(`📊 [Analyzer] Processed ${moduleList.length} modules`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Module parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Module analysis failed:", moduleResult.reason?.message);
  }

  // Fallback: insert basic modules from directory structure if none inserted
  if (moduleList.length === 0) {
    for (const [modName, modFiles] of Object.entries(moduleGroups)) {
      moduleList.push({
        name: modName,
        risk_score: 20,
        risk_level: "low",
        bug_count: 0,
        dependency_count: modFiles.length,
        impact_radius: 0,
        last_modified: new Date().toISOString(),
        bugs: "[]",
        ai_summary: `${modFiles.length} files`,
        repository: projectName,
      });
    }
    console.log(`📊 [Analyzer] Fallback processed ${moduleList.length} modules`);
  }

  // ── Process security result ───────────────────────────
  const vulnerabilitiesList = [];
  if (secResult.status === "fulfilled") {
    try {
      const secData = parseJsonFromAI(secResult.value);
      if (Array.isArray(secData)) {
        for (const v of secData) {
          vulnerabilitiesList.push({
            cve: v.cve || `QT-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
            severity: v.severity || "medium",
            exploitability: Math.min(1, Math.max(0, v.exploitability || 0.5)),
            affected_versions: v.affected_versions || "All versions",
            library: v.library || "Custom Code",
            patch_version: v.patch_version || "Upgrade code",
            description: v.description || "Security scanner warning",
            affected_modules: v.affected_modules || 1,
            dependency_chain: v.dependency_chain || "Custom Code",
            repository: projectName,
          });
        }
        console.log(`📊 [Analyzer] Processed ${vulnerabilitiesList.length} vulnerabilities`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Security parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Security analysis failed:", secResult.reason?.message);
  }

  // ── Process dependencies result ───────────────────────
  const depList = [];
  const rawAIElements = [];
  if (depResult.status === "fulfilled") {
    try {
      const depData = parseJsonFromAI(depResult.value);
      if (Array.isArray(depData)) {
        rawAIElements.push(...depData);
        console.log(`📊 [Analyzer] Received ${depData.length} raw AI dependencies`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Dependency parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Dependency analysis failed:", depResult.reason?.message);
  }

  // ── Programmatic Graph Metrics Processor ───────────────
  const moduleNamesSet = new Set(moduleList.map(m => m.name));
  const depMap = {};
  
  for (const m of moduleList) {
    depMap[m.name] = {
      module: m.name,
      direct_deps: [],
      reverse_deps: [],
      incoming_count: 0,
      outgoing_count: 0,
      gravity: 0,
      depth: 1,
      circular_deps: 0,
      implicit_deps: 0,
      fan_in: 0,
      fan_out: 0,
      volatility: 0.1,
      transitive_exposure: 0,
      repository: projectName
    };
  }

  // Populate direct dependencies from AI response
  for (const d of rawAIElements) {
    const modName = d.module;
    if (modName && depMap[modName]) {
      const validDeps = (d.direct_deps || []).filter(name => moduleNamesSet.has(name) && name !== modName);
      depMap[modName].direct_deps = validDeps;
    }
  }

  // Compute reverse dependencies
  for (const [name, data] of Object.entries(depMap)) {
    for (const d of data.direct_deps) {
      if (depMap[d]) {
        depMap[d].reverse_deps.push(name);
      }
    }
  }

  // Calculate in/out degree counts
  for (const data of Object.values(depMap)) {
    data.outgoing_count = data.direct_deps.length;
    data.incoming_count = data.reverse_deps.length;
    data.fan_out = data.outgoing_count;
    data.fan_in = data.incoming_count;
  }

  // Calculate cycles / circular dependencies using DFS
  const hasPath = (start, target, visited = new Set()) => {
    if (start === target) return true;
    visited.add(start);
    const neighbors = depMap[start]?.direct_deps || [];
    for (const n of neighbors) {
      if (!visited.has(n)) {
        if (hasPath(n, target, visited)) return true;
      }
    }
    return false;
  };

  for (const [name, data] of Object.entries(depMap)) {
    let isCircular = 0;
    for (const d of data.direct_deps) {
      if (hasPath(d, name)) {
        isCircular = 1;
        break;
      }
    }
    data.circular_deps = isCircular;
  }

  // Calculate transitive exposure (reachable dependents in reverse graph)
  const getTransitiveDependents = (start) => {
    const visited = new Set();
    const q = [start];
    while (q.length > 0) {
      const curr = q.shift();
      const dependents = depMap[curr]?.reverse_deps || [];
      for (const d of dependents) {
        if (!visited.has(d)) {
          visited.add(d);
          q.push(d);
        }
      }
    }
    return visited.size;
  };

  for (const [name, data] of Object.entries(depMap)) {
    data.transitive_exposure = getTransitiveDependents(name);
  }

  // Calculate topological depth
  const depths = {};
  const computeDepth = (name, visited = new Set()) => {
    if (depths[name] !== undefined) return depths[name];
    if (visited.has(name)) return 1; // cycle breaker
    visited.add(name);

    const parents = depMap[name]?.reverse_deps || [];
    if (parents.length === 0) {
      depths[name] = 1;
      return 1;
    }
    let maxParentDepth = 0;
    for (const p of parents) {
      maxParentDepth = Math.max(maxParentDepth, computeDepth(p, visited));
    }
    depths[name] = maxParentDepth + 1;
    return depths[name];
  };

  for (const name of Object.keys(depMap)) {
    depMap[name].depth = computeDepth(name);
  }

  // Calculate gravity and volatility
  for (const [name, data] of Object.entries(depMap)) {
    const mInfo = moduleList.find(m => m.name === name) || {};
    const riskScore = mInfo.risk_score || 20;
    data.gravity = Math.round(riskScore * (1 + 0.5 * data.transitive_exposure));
    data.volatility = Number((0.1 + (data.outgoing_count * 0.15) + (data.circular_deps * 0.3)).toFixed(2));
    
    depList.push(data);
  }

  console.log(`📊 [Analyzer] Programmatically computed and finalized ${depList.length} dependency records`);

  // ── Architecture nodes/edges (AI-generated) ───────────
  console.log("📊 [Analyzer] Generating architecture map with AI...");

  // Build rich import/dependency graph from actual source scanning
  const importGraph = {};
  for (const [modName, modFiles] of Object.entries(moduleGroups)) {
    importGraph[modName] = new Set();
    for (const f of modFiles) {
      const importMatches = f.content.match(/(?:import\s+.*?from\s+['"]|require\s*\(\s*['"])(\.\.?\/[^'"]+)/g) || [];
      for (const imp of importMatches) {
        const pathMatch = imp.match(/['"](\.\.?\/[^'"]+)/);
        if (!pathMatch) continue;
        const importedPath = pathMatch[1].toLowerCase();
        for (const otherMod of Object.keys(moduleGroups)) {
          if (otherMod !== modName && importedPath.includes(otherMod.toLowerCase())) {
            importGraph[modName].add(otherMod);
          }
        }
      }
    }
  }
  const importGraphJson = JSON.stringify(
    Object.fromEntries(Object.entries(importGraph).map(([k, v]) => [k, [...v]])),
    null, 2
  ).slice(0, 2000);

  const moduleRiskMap = Object.fromEntries(
    moduleList.map(m => [m.name, { risk: m.risk_level, score: m.risk_score, bugs: m.bug_count }])
  );

  const archPrompt = `You are a senior software architect performing a deep code analysis. I will give you the structure of a real software project and you must generate a precise architecture graph for interactive visualization.

PROJECT: ${projectName}
FILES SCANNED:
${fileTreeText.slice(0, 5000)}

CODE SAMPLES (top files):
${codeSnippets.slice(0, 4000)}

DETECTED MODULES AND RISK:
${JSON.stringify(moduleRiskMap, null, 2).slice(0, 1500)}

ACTUAL IMPORT/DEPENDENCY GRAPH (scanned from source code):
${importGraphJson}

TASK: Generate a JSON architecture graph that accurately represents this codebase's structure.

RULES (follow exactly):
1. Return ONLY valid JSON — no markdown, no backticks, no explanation text before or after.
2. The JSON must have exactly two keys: "nodes" and "edges".
3. nodes array: 6–14 nodes representing real logical layers/components found in the code.
   Each node: {"id":"node-0","label":"ComponentName","risk":"low|medium|high","risk_score":0-100,"load":0-100,"x":50-900,"y":50-700,"description":"one sentence about what this component does"}
   - Use REAL names from the codebase (not generic names like "Module1").
   - risk_score must match the actual complexity/bug count of that module.
   - Position nodes in layers: API/Routes at top (y 50–150), Services/Logic in middle (y 200–400), Data/Storage at bottom (y 450–650). Spread x across the full width.
4. edges array: Real dependency edges derived from the import graph above.
   Each edge: {"id":"edge-0","source":"node-0","target":"node-1","animated":false,"label":"uses|calls|reads|writes"}
   - animated: true only for high-risk or bidirectional dependencies.
   - Every node must connect to at least one other node. No isolated nodes.
   - Do NOT fabricate edges that don't exist in the import graph.
5. The graph must be fully connected (no isolated components).

Return ONLY the JSON object. Example format:
{"nodes":[{"id":"node-0","label":"API Routes","risk":"medium","risk_score":45,"load":70,"x":400,"y":80,"description":"Express route handlers for REST endpoints"},...],"edges":[{"id":"edge-0","source":"node-0","target":"node-1","animated":false,"label":"calls"},...]}`

  let archNodes = [];
  let archEdges = [];

  try {
    const archResult = await callBedrock(archPrompt, { max_gen_len: 3000 });
    const archData = parseJsonFromAI(archResult);

    if (archData && typeof archData === 'object' && !Array.isArray(archData) && Array.isArray(archData.nodes) && archData.nodes.length > 0) {
      archNodes = archData.nodes;
      archEdges = archData.edges || [];
      console.log(`📊 [Analyzer] AI generated ${archNodes.length} nodes, ${archEdges.length} edges`);
    } else {
      console.warn("📊 [Analyzer] AI arch response invalid shape — will use code-analysis fallback");
    }
  } catch (err) {
    console.error("📊 [Analyzer] AI architecture generation failed:", err.message);
  }

  // Fallback: build entirely from real code scanning (no random data)
  if (!archNodes.length && moduleList.length > 0) {
    console.log("📊 [Analyzer] Building architecture from code analysis (AI fallback)");
    const cols = Math.max(1, Math.ceil(Math.sqrt(moduleList.length)));
    const spacingX = Math.min(250, Math.floor(800 / cols));
    const spacingY = 200;

    archNodes = moduleList.map((m, i) => {
      const modFiles = moduleGroups[m.name] || [];
      const totalLines = modFiles.reduce((s, f) => s + (f.content || "").split("\n").length, 0);
      const load = Math.min(100, Math.round(totalLines / 5));
      return {
        id: `node-${i}`,
        label: m.name,
        risk: m.risk_level || "low",
        risk_score: m.risk_score || 0,
        load,
        x: (i % cols) * spacingX + 80,
        y: Math.floor(i / cols) * spacingY + 80,
        description: m.ai_summary || `${modFiles.length} files`
      };
    });

    // Build edges from real import graph
    archEdges = [];
    let eIdx = 0;
    const nameToNodeId = Object.fromEntries(moduleList.map((m, i) => [m.name, `node-${i}`]));
    const seenEdges = new Set();

    for (const [src, targets] of Object.entries(importGraph)) {
      const srcId = nameToNodeId[src];
      if (!srcId) continue;
      for (const tgt of targets) {
        const tgtId = nameToNodeId[tgt];
        if (!tgtId || tgtId === srcId) continue;
        const key = `${srcId}→${tgtId}`;
        if (!seenEdges.has(key)) {
          seenEdges.add(key);
          const srcNode = archNodes.find(n => n.id === srcId);
          const tgtNode = archNodes.find(n => n.id === tgtId);
          const highRisk = (srcNode?.risk === "high" || tgtNode?.risk === "high");
          archEdges.push({ id: `edge-${eIdx++}`, source: srcId, target: tgtId, animated: highRisk, label: "uses" });
        }
      }
    }

    // Guarantee connectivity — chain nodes that have no edges
    const connectedNodes = new Set(archEdges.flatMap(e => [e.source, e.target]));
    for (let i = 0; i < archNodes.length; i++) {
      if (!connectedNodes.has(archNodes[i].id) && archNodes.length > 1) {
        const targetIdx = i === 0 ? 1 : 0;
        archEdges.push({ id: `edge-${eIdx++}`, source: archNodes[i].id, target: archNodes[targetIdx].id, animated: false, label: "uses" });
        connectedNodes.add(archNodes[i].id);
      }
    }
  }

  const architectureNodesList = archNodes.map((n) => ({
    node_id: n.id || `node-${archNodes.indexOf(n)}`,
    repository: projectName,
    position_x: n.x ?? n.position_x ?? 100,
    position_y: n.y ?? n.position_y ?? 100,
    label: n.label || "Unknown",
    risk: n.risk || "low",
    load: n.load || 0,
    risk_score: clamp(n.risk_score, 0, 100),
    description: n.description || "",
  }));

  const architectureEdgesList = archEdges.map((e) => ({
    edge_id: e.id || `edge-${archEdges.indexOf(e)}`,
    repository: projectName,
    source: e.source,
    target: e.target,
    animated: e.animated ? 1 : 0,
    label: e.label || "",
    stroke: e.stroke || "#94a3b8",
    stroke_width: e.stroke_width || 1.5,
  }));

  // ── Populate time_periods (Evolution Timeline) ────────────────────
  const timePeriodsList = [];
  try {
    console.log("📊 [Analyzer] Generating evolution timeline...");
    const totalRiskScore = moduleList.reduce((sum, m) => sum + (m.risk_score || 0), 0);
    const avgRiskScore = moduleList.length > 0 ? Math.round(totalRiskScore / moduleList.length) : 0;
    const totalVulnsCount = vulnerabilitiesList.length;
    const totalDepsCount = depList.length;
    const totalBugCount = moduleList.reduce((sum, m) => sum + (m.bug_count || 0), 0);
    const avgEntropyScore = moduleList.length > 0 ? (totalBugCount * 0.1 / moduleList.length) : 0;

    const timeline = await generateEvolutionTimeline(
      projectName,
      moduleList.length,
      totalVulnsCount,
      totalDepsCount,
      avgRiskScore,
      avgEntropyScore,
      projectDir,
      repoUrl
    );

    for (const t of timeline) {
      timePeriodsList.push({
        version: t.version,
        date: t.date,
        risk_score: t.risk_score,
        vulnerability_accumulation: t.vulnerability_accumulation,
        dependency_count: t.dependency_count,
        entropy: t.entropy,
        modules_changed: t.modules_changed,
        commit_count: t.commit_count,
        avg_commit_size: t.avg_commit_size,
        code_churn: t.code_churn,
        days_to_release: t.days_to_release,
        breaking_changes: t.breaking_changes,
        bugs_fixed: t.bugs_fixed,
        feature_count: t.feature_count,
        repository: projectName,
        commit_hash: t.commit_hash,
        author: t.author
      });
    }
    console.log(`📊 [Analyzer] Generated ${timePeriodsList.length} evolution time periods`);
  } catch (timelineErr) {
    console.error("📊 [Analyzer] Evolution timeline generation failed:", timelineErr.message);
  }

  console.log(`📊 [Analyzer] Architecture: ${architectureNodesList.length} nodes, ${architectureEdgesList.length} edges`);
  console.log(`📊 [Analyzer] ✅ Analysis complete for "${projectName}"\n`);

  // --- CACHE INTELLIGENCE DATA ---
  try {
    const cacheData = {
      modules: moduleList,
      vulnerabilities: vulnerabilitiesList,
      dependencies: depList,
      time_periods: timePeriodsList,
      architecture_nodes: architectureNodesList,
      architecture_edges: architectureEdgesList
    };

    await s3Store.saveIntelligence(projectId, cacheData);
    console.log(`📊 [Analyzer] Saved intelligence cache via s3Store for "${projectName}" (id=${projectId})`);
  } catch (s3CacheErr) {
    console.error("📊 [Analyzer] Intelligence cache save failed:", s3CacheErr.message);
  }

  return { modules: moduleList.length, files: files.length };
}

/**
 * Render a complete indented text file tree of the project.
 */
function buildFileTree(files) {
  const tree = {};
  for (const f of files) {
    const parts = f.path.split(/[\\/]/);
    let curr = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        curr[part] = `${(f.size / 1024).toFixed(1)}KB`;
      } else {
        if (!curr[part] || typeof curr[part] === 'string') {
          curr[part] = {};
        }
        curr = curr[part];
      }
    }
  }

  function renderTree(node, indent = "") {
    let result = "";
    const keys = Object.keys(node).sort((a, b) => {
      const aIsDir = typeof node[a] === 'object';
      const bIsDir = typeof node[b] === 'object';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });

    for (const key of keys) {
      const val = node[key];
      if (typeof val === 'object') {
        result += `${indent}📁 ${key}/\n${renderTree(val, indent + "  ")}`;
      } else {
        result += `${indent}📄 ${key} (${val})\n`;
      }
    }
    return result;
  }

  return renderTree(tree);
}

/**
 * Try to extract JSON (array or object) from an AI response that may contain markdown/text.
 */
function parseJsonFromAI(text) {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch { /* continue */ }

  // Try to find JSON object (for architecture { nodes, edges } responses)
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const obj = JSON.parse(objMatch[0]);
      // If it has nodes/edges, return as-is (architecture response)
      if (obj.nodes || obj.edges) return obj;
      // Otherwise wrap single objects in array for other prompts
      return Array.isArray(obj) ? obj : [obj];
    } catch { /* continue */ }
  }

  // Try to find JSON array in the response
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return JSON.parse(arrMatch[0]);
    } catch { /* continue */ }
  }

  console.warn("[Analyzer] Could not parse AI response as JSON:", text.slice(0, 200));
  return [];
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, Number(val) || 0));
}

module.exports = { analyzeProject, collectFiles };
