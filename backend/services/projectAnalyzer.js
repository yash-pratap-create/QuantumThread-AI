/**
 * Project Analyzer — Scans uploaded project files and populates
 * intelligence DB tables using AI agents.
 */

const fs = require("fs");
const path = require("path");
const { dbRun, dbAll } = require("../db");
const { callBedrock } = require("./bedrockClient");
const { saveIntelligenceToS3 } = require("./s3Storage");
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
 */
async function analyzeProject(projectDir, projectName, projectId) {
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

  // Clear existing data for this project/repo
  await dbRun("DELETE FROM modules WHERE repository = ?", [projectName]);
  await dbRun("DELETE FROM vulnerabilities WHERE repository = ?", [projectName]);
  await dbRun("DELETE FROM dependencies WHERE repository = ?", [projectName]);
  await dbRun("DELETE FROM architecture_nodes WHERE repository = ?", [projectName]);
  await dbRun("DELETE FROM architecture_edges WHERE repository = ?", [projectName]);
  await dbRun("DELETE FROM time_periods WHERE repository = ?", [projectName]);

  // Build a file summary for the AI prompt (keep it compact)
  const fileSummary = files
    .slice(0, 40) // limit to 40 files for prompt size
    .map((f) => `${f.path} (${f.size}B)`)
    .join("\n");

  // Build code snippets for analysis (first 50 lines of key files)
  const keyFiles = files
    .filter((f) => [".js", ".ts", ".jsx", ".tsx", ".py", ".java", ".go"].includes(f.ext))
    .sort((a, b) => b.size - a.size)
    .slice(0, 10);

  const codeSnippets = keyFiles
    .map((f) => {
      const lines = f.content.split("\n").slice(0, 50).join("\n");
      return `--- ${f.path} ---\n${lines}`;
    })
    .join("\n\n");

  // ── Run all 3 AI analyses in parallel ─────────────────
  console.log("📊 [Analyzer] Running AI analyses (modules + security + deps) in parallel...");

  const modulePrompt = `Analyze this project. Return ONLY a JSON array of modules.
Files: ${fileSummary}
Code: ${codeSnippets.slice(0, 4000)}
Each element: {"name":"module","risk_score":0-100,"risk_level":"low|medium|high","bug_count":0,"dependency_count":0,"impact_radius":0,"ai_summary":"summary"}`;

  const secPrompt = `Security scan this code. Return ONLY a JSON array.
Code: ${codeSnippets.slice(0, 3500)}
Each element: {"cve":"QT-YYYY-NNNN","severity":"critical|high|medium|low","exploitability":0.0-1.0,"library":"lib","description":"issue","affected_modules":0}
If none found, return [].`;

  const depPrompt = `Identify module dependencies. Return ONLY a JSON array.
Structure: ${fileSummary.slice(0, 2000)}
Code: ${codeSnippets.slice(0, 2500)}
Each element: {"module":"name","incoming_count":0,"outgoing_count":0,"gravity":0,"depth":0,"circular_deps":0,"volatility":0.0,"direct_deps":["dep"],"reverse_deps":["dep"]}`;

  const genOpts = { max_gen_len: 768 };
  const [moduleResult, secResult, depResult] = await Promise.allSettled([
    callBedrock(modulePrompt, genOpts),
    callBedrock(secPrompt, genOpts),
    callBedrock(depPrompt, genOpts),
  ]);

  // ── Process modules result ────────────────────────────
  if (moduleResult.status === "fulfilled") {
    try {
      const moduleData = parseJsonFromAI(moduleResult.value);
      if (Array.isArray(moduleData) && moduleData.length > 0) {
        for (const m of moduleData) {
          await dbRun(
            `INSERT INTO modules (name, risk_score, risk_level, bug_count, dependency_count, impact_radius, last_modified, bugs, ai_summary, repository)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              m.name || "unknown",
              clamp(m.risk_score, 0, 100),
              m.risk_level || "low",
              m.bug_count || 0,
              m.dependency_count || 0,
              m.impact_radius || 0,
              new Date().toISOString(),
              JSON.stringify(m.bugs || []),
              m.ai_summary || "",
              projectName,
            ]
          );
        }
        console.log(`📊 [Analyzer] Inserted ${moduleData.length} modules`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Module parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Module analysis failed:", moduleResult.reason?.message);
  }

  // Fallback: insert basic modules from directory structure if none inserted
  const existingModules = await dbAll("SELECT COUNT(*) as cnt FROM modules WHERE repository = ?", [projectName]);
  if (existingModules[0].cnt === 0) {
    for (const [modName, modFiles] of Object.entries(moduleGroups)) {
      await dbRun(
        `INSERT INTO modules (name, risk_score, risk_level, bug_count, dependency_count, impact_radius, last_modified, bugs, ai_summary, repository)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [modName, 0, "low", 0, modFiles.length, 0, new Date().toISOString(), "[]", `${modFiles.length} files`, projectName]
      );
    }
  }

  // ── Process security result ───────────────────────────
  if (secResult.status === "fulfilled") {
    try {
      const secData = parseJsonFromAI(secResult.value);
      if (Array.isArray(secData)) {
        for (const v of secData) {
          await dbRun(
            `INSERT INTO vulnerabilities (cve, severity, exploitability, affected_versions, library, patch_version, description, affected_modules, dependency_chain, repository)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              v.cve || `QT-${Date.now()}`,
              v.severity || "medium",
              Math.min(1, Math.max(0, v.exploitability || 0)),
              v.affected_versions || "",
              v.library || "",
              v.patch_version || "",
              v.description || "",
              v.affected_modules || 0,
              v.dependency_chain || "",
              projectName,
            ]
          );
        }
        console.log(`📊 [Analyzer] Inserted ${secData.length} vulnerabilities`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Security parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Security analysis failed:", secResult.reason?.message);
  }

  // ── Process dependencies result ───────────────────────
  if (depResult.status === "fulfilled") {
    try {
      const depData = parseJsonFromAI(depResult.value);
      if (Array.isArray(depData)) {
        for (const d of depData) {
          await dbRun(
            `INSERT INTO dependencies (module, incoming_count, outgoing_count, gravity, depth, circular_deps, implicit_deps, fan_in, fan_out, volatility, chain, transitive_exposure, direct_deps, reverse_deps, repository)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              d.module || "unknown",
              d.incoming_count || 0,
              d.outgoing_count || 0,
              d.gravity || 0,
              d.depth || 0,
              d.circular_deps || 0,
              d.implicit_deps || 0,
              d.incoming_count || 0,
              d.outgoing_count || 0,
              d.volatility || 0,
              "",
              0,
              JSON.stringify(d.direct_deps || []),
              JSON.stringify(d.reverse_deps || []),
              projectName,
            ]
          );
        }
        console.log(`📊 [Analyzer] Inserted ${depData.length} dependencies`);
      }
    } catch (err) {
      console.error("📊 [Analyzer] Dependency parse failed:", err.message);
    }
  } else {
    console.error("📊 [Analyzer] Dependency analysis failed:", depResult.reason?.message);
  }

  // ── Architecture nodes/edges (AI-generated) ───────────
  console.log("📊 [Analyzer] Generating architecture map with AI...");
  const moduleList = await dbAll("SELECT * FROM modules WHERE repository = ?", [projectName]);
  const depList = await dbAll("SELECT * FROM dependencies WHERE repository = ?", [projectName]);

  const archModuleNames = moduleList.map((m) => m.name);
  const depSummary = depList.map((d) => ({
    module: d.module,
    direct_deps: JSON.parse(d.direct_deps || "[]"),
    reverse_deps: JSON.parse(d.reverse_deps || "[]"),
  }));

  const archPrompt = `You are a software architect. Analyze this project and generate a complete architecture graph for visualization.

Project: ${projectName}
Files:\n${fileSummary}
Code:\n${codeSnippets.slice(0, 3000)}
Detected modules: ${archModuleNames.join(", ")}
Dependencies: ${JSON.stringify(depSummary).slice(0, 1500)}

Return ONLY a JSON object with "nodes" and "edges" arrays.
- nodes: Each node represents a logical component/module/layer. Include 5-15 nodes.
  Format: {"id":"node-0","label":"ComponentName","risk":"low|medium|high","risk_score":0-100,"load":0-100,"x":number,"y":number}
  Position nodes in a meaningful layout: entry points at top (y~50-150), core logic in middle (y~200-400), data/storage at bottom (y~450-600). Spread x from 50 to 700. Group related modules closer together.
- edges: Each edge represents a dependency/data flow between nodes.
  Format: {"id":"edge-0","source":"node-0","target":"node-1","animated":false}
  animated=true for high-risk connections.

Create edges that reflect real imports, data flow, and dependencies in the code. Every node should have at least one edge. Make the graph connected.`;

  let archNodes = [];
  let archEdges = [];

  try {
    const archResult = await callBedrock(archPrompt, { max_gen_len: 2048 });
    const archData = parseJsonFromAI(archResult);

    if (archData && !Array.isArray(archData) && archData.nodes) {
      archNodes = archData.nodes;
      archEdges = archData.edges || [];
    } else if (Array.isArray(archData)) {
      // AI returned just nodes array — treat as nodes
      archNodes = archData;
    }
  } catch (err) {
    console.error("📊 [Analyzer] AI architecture generation failed:", err.message);
  }

  // Fallback: if AI didn't produce valid nodes, build from **actual code analysis**
  if (!archNodes.length && moduleList.length > 0) {
    console.log("📊 [Analyzer] AI arch failed — building from code analysis fallback");
    const spacing = 200;
    const cols = Math.ceil(Math.sqrt(moduleList.length));

    // Estimate risk from file sizes and code patterns in each module
    archNodes = moduleList.map((m, i) => {
      const modFiles = moduleGroups[m.name] || [];
      const totalSize = modFiles.reduce((s, f) => s + f.size, 0);
      const totalLines = modFiles.reduce((s, f) => s + f.content.split("\n").length, 0);
      // Heuristic risk: larger/complex modules = higher risk
      const sizeRisk = Math.min(100, Math.round((totalSize / 5000) * 30));
      const lineRisk = Math.min(100, Math.round((totalLines / 500) * 25));
      const codePatternRisk = modFiles.some(f =>
        /catch\s*\(|throw\s|TODO|FIXME|HACK|unsafe|eval\(|exec\(/i.test(f.content)
      ) ? 20 : 0;
      const riskScore = Math.min(100, sizeRisk + lineRisk + codePatternRisk);
      const risk = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";

      return {
        id: `node-${i}`,
        label: m.name,
        risk,
        risk_score: riskScore,
        load: Math.min(100, Math.round(totalLines / 10)),
        x: (i % cols) * spacing + 100,
        y: Math.floor(i / cols) * spacing + 100,
      };
    });

    // Build edges by scanning actual import/require statements across modules
    archEdges = [];
    let eIdx = 0;
    const modNameToIdx = {};
    moduleList.forEach((m, i) => { modNameToIdx[m.name] = i; });

    for (const [modName, modFiles] of Object.entries(moduleGroups)) {
      const srcIdx = modNameToIdx[modName];
      if (srcIdx === undefined) continue;
      for (const f of modFiles) {
        // Scan for import/require patterns that reference other modules
        const importMatches = f.content.match(/(?:import\s+.*from\s+['"]|require\s*\(\s*['"])(\.\.?\/[^'"]+)/g) || [];
        for (const imp of importMatches) {
          const pathMatch = imp.match(/['"]\.\.?\/([^'"]+)/);
          if (!pathMatch) continue;
          const importedPath = pathMatch[1];
          // Match against other module names
          for (const [otherMod, otherIdx] of Object.entries(modNameToIdx)) {
            if (otherIdx !== srcIdx && importedPath.toLowerCase().includes(otherMod.toLowerCase())) {
              const edgeKey = `${srcIdx}->${otherIdx}`;
              if (!archEdges.some(e => e._key === edgeKey)) {
                const isHighRisk = archNodes[srcIdx].risk === "high" || archNodes[otherIdx].risk === "high";
                archEdges.push({ id: `edge-${eIdx++}`, source: `node-${srcIdx}`, target: `node-${otherIdx}`, animated: isHighRisk, _key: edgeKey });
              }
            }
          }
        }
      }
    }

    // Also add edges from dependency data if available
    for (const dep of depList) {
      const directDeps = JSON.parse(dep.direct_deps || "[]");
      const srcIdx = moduleList.findIndex((m) => m.name === dep.module);
      for (const tgt of directDeps) {
        const tgtIdx = moduleList.findIndex((m) => m.name === tgt);
        if (srcIdx >= 0 && tgtIdx >= 0 && srcIdx !== tgtIdx) {
          const edgeKey = `${srcIdx}->${tgtIdx}`;
          if (!archEdges.some((e) => e._key === edgeKey)) {
            archEdges.push({ id: `edge-${eIdx++}`, source: `node-${srcIdx}`, target: `node-${tgtIdx}`, animated: false, _key: edgeKey });
          }
        }
      }
    }

    // Guarantee edges - if fewer than 1 edge per 2 nodes, add proximity chain
    // so Architecture Map is never blank even when import scanning finds nothing.
    const minExpectedEdges = Math.max(1, Math.floor(archNodes.length / 2));
    if (archEdges.length < minExpectedEdges && archNodes.length > 1) {
      console.log('[Analyzer] Only ' + archEdges.length + ' edges - adding proximity-chain edges');
      const existingPairs = new Set(archEdges.map(e => e.source + '->' + e.target));
      for (let i = 0; i < archNodes.length - 1; i++) {
        const pair = archNodes[i].id + '->' + archNodes[i + 1].id;
        if (!existingPairs.has(pair)) {
          archEdges.push({ id: 'edge-' + (eIdx++), source: archNodes[i].id, target: archNodes[i + 1].id, animated: false });
          existingPairs.add(pair);
        }
      }
      if (archNodes.length >= 4) {
        const mid = Math.floor(archNodes.length / 2);
        const pair = archNodes[0].id + '->' + archNodes[mid].id;
        if (!existingPairs.has(pair)) {
          archEdges.push({ id: 'edge-' + (eIdx++), source: archNodes[0].id, target: archNodes[mid].id, animated: false });
        }
      }
    }

    archEdges = archEdges.map(({ _key, ...e }) => e);
  }


  // Insert nodes
  for (const n of archNodes) {
    await dbRun(
      `INSERT INTO architecture_nodes (node_id, repository, position_x, position_y, label, risk, load, risk_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        n.id || `node-${archNodes.indexOf(n)}`,
        projectName,
        n.x ?? n.position_x ?? 100,
        n.y ?? n.position_y ?? 100,
        n.label || "Unknown",
        n.risk || "low",
        n.load || 0,
        clamp(n.risk_score, 0, 100),
      ]
    );
  }

  // Insert edges
  for (const e of archEdges) {
    await dbRun(
      `INSERT INTO architecture_edges (edge_id, repository, source, target, animated, stroke, stroke_width) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        e.id || `edge-${archEdges.indexOf(e)}`,
        projectName,
        e.source,
        e.target,
        e.animated ? 1 : 0,
        e.stroke || "#94a3b8",
        e.stroke_width || 1.5,
      ]
    );
  }

  // ── Populate time_periods (Evolution Timeline) ────────────────────
  try {
    console.log("📊 [Analyzer] Generating evolution timeline...");
    const activeModules = await dbAll("SELECT * FROM modules WHERE repository = ?", [projectName]);
    const activeVulns = await dbAll("SELECT * FROM vulnerabilities WHERE repository = ?", [projectName]);
    const activeDeps = await dbAll("SELECT * FROM dependencies WHERE repository = ?", [projectName]);

    const totalRiskScore = activeModules.reduce((sum, m) => sum + (m.risk_score || 0), 0);
    const avgRiskScore = activeModules.length > 0 ? Math.round(totalRiskScore / activeModules.length) : 0;
    const totalVulnsCount = activeVulns.length;
    const totalDepsCount = activeDeps.length;
    const totalBugCount = activeModules.reduce((sum, m) => sum + (m.bug_count || 0), 0);
    const avgEntropyScore = activeModules.length > 0 ? (totalBugCount * 0.1 / activeModules.length) : 0;

    const timeline = generateEvolutionTimeline(
      projectName,
      activeModules.length,
      totalVulnsCount,
      totalDepsCount,
      avgRiskScore,
      avgEntropyScore
    );

    for (const t of timeline) {
      await dbRun(
        `INSERT INTO time_periods (version, date, risk_score, vulnerability_accumulation, dependency_count, entropy, modules_changed, commit_count, avg_commit_size, code_churn, days_to_release, breaking_changes, bugs_fixed, feature_count, repository)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.version,
          t.date,
          t.risk_score,
          t.vulnerability_accumulation,
          t.dependency_count,
          t.entropy,
          t.modules_changed,
          t.commit_count,
          t.avg_commit_size,
          t.code_churn,
          t.days_to_release,
          t.breaking_changes,
          t.bugs_fixed,
          t.feature_count,
          projectName
        ]
      );
    }
    console.log(`📊 [Analyzer] Generated ${timeline.length} evolution time periods`);
  } catch (timelineErr) {
    console.error("📊 [Analyzer] Evolution timeline generation failed:", timelineErr.message);
  }

  console.log(`📊 [Analyzer] Architecture: ${archNodes.length} nodes, ${archEdges.length} edges`);
  console.log(`📊 [Analyzer] ✅ Analysis complete for "${projectName}"\n`);

  // --- CACHE INTELLIGENCE DATA TO S3 ---
  try {
    const modules = await dbAll("SELECT * FROM modules WHERE repository = ?", [projectName]);
    const vulnerabilities = await dbAll("SELECT * FROM vulnerabilities WHERE repository = ?", [projectName]);
    const dependencies = await dbAll("SELECT * FROM dependencies WHERE repository = ?", [projectName]);
    const time_periods = await dbAll("SELECT * FROM time_periods WHERE repository = ?", [projectName]);
    const architecture_nodes = await dbAll("SELECT * FROM architecture_nodes WHERE repository = ?", [projectName]);
    const architecture_edges = await dbAll("SELECT * FROM architecture_edges WHERE repository = ?", [projectName]);

    const cacheData = {
      modules,
      vulnerabilities,
      dependencies,
      time_periods,
      architecture_nodes,
      architecture_edges
    };

    await saveIntelligenceToS3(projectId, cacheData);
    console.log(`📊 [Analyzer] Saved intelligence cache to S3 for "${projectName}" (id=${projectId})`);
  } catch (s3CacheErr) {
    console.error("📊 [Analyzer] S3 intelligence cache failed:", s3CacheErr.message);
  }

  return { modules: moduleList.length, files: files.length };
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
