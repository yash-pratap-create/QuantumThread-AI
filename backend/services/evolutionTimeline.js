const { execSync } = require('child_process');

/**
 * Unique Evolution Timeline Generator
 * Generates deterministic, unique timeline records based on a repository name.
 * If projectDir is provided and is a valid Git repository, extracts real
 * commit history (hashes, authors, and dates) instead of simulated dates.
 */

function fetchGitHistory(projectDir) {
  if (!projectDir) return null;
  try {
    // Check if it's a valid git repo
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'ignore' });
    
    // Get last 6 commits (first-parent to simplify history)
    const logOutput = execSync('git log -n 6 --pretty=format:"%H|%cI|%an|%s" --first-parent', { cwd: projectDir, encoding: 'utf-8' });
    if (!logOutput.trim()) return null;

    const lines = logOutput.trim().split('\n').filter(Boolean);
    const commits = lines.map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0],
        date: parts[1],
        author: parts[2],
        message: parts.slice(3).join('|')
      };
    });
    return commits;
  } catch (err) {
    return null;
  }
}

function generateEvolutionTimeline(repoName, modulesCount, vulnsCount, depsCount, avgRiskScore, avgEntropyScore, projectDir = null) {
  // 1. Generate a deterministic seed from repoName
  let seed = 0;
  for (let i = 0; i < repoName.length; i++) {
    seed = repoName.charCodeAt(i) + ((seed << 5) - seed);
  }
  seed = Math.abs(seed);

  // Helper to clamp values
  const clamp = (val, min, max) => Math.max(min, Math.min(max, Number(val) || 0));

  // 2. Base metrics scaled by project size (modulesCount)
  const scaleMultiplier = clamp(modulesCount / 5, 0.4, 5.0);

  // 3. Define the base versions
  const versions = [
    { version: "v1.0.0", offsetDays: 35, riskMultiplier: 1.3, vulnMultiplier: 0.5, depMultiplier: 0.6, entropyMultiplier: 0.7, commitBase: 120, churnBase: 12000, features: 12, bugs: 22 },
    { version: "v1.1.0", offsetDays: 28, riskMultiplier: 1.2, vulnMultiplier: 0.7, depMultiplier: 0.7, entropyMultiplier: 0.8, commitBase: 95,  churnBase: 8500,  features: 8,  bugs: 15 },
    { version: "v1.2.0", offsetDays: 21, riskMultiplier: 1.15, vulnMultiplier: 0.8, depMultiplier: 0.8, entropyMultiplier: 0.95, commitBase: 140, churnBase: 15000, features: 15, bugs: 30 },
    { version: "v1.3.0", offsetDays: 14, riskMultiplier: 1.05, vulnMultiplier: 1.1, depMultiplier: 0.9, entropyMultiplier: 1.1, commitBase: 80,  churnBase: 6000,  features: 6,  bugs: 12 },
    { version: "v1.4.0", offsetDays: 7,  riskMultiplier: 1.02, vulnMultiplier: 0.9, depMultiplier: 0.95, entropyMultiplier: 1.05, commitBase: 110, churnBase: 9800,  features: 10, bugs: 18 },
    { version: "Current", offsetDays: 0,  riskMultiplier: 1.0,  vulnMultiplier: 1.0, depMultiplier: 1.0,  entropyMultiplier: 1.0,  commitBase: 70,  churnBase: 5000,  features: 5,  bugs: 8 }
  ];

  const now = new Date();
  const realCommits = fetchGitHistory(projectDir);

  return versions.map((v, index) => {
    let periodDate = new Date(now.getTime() - v.offsetDays * 24 * 60 * 60 * 1000);
    let dateStr = periodDate.toISOString().split("T")[0];
    let commit_hash = null;
    let author = null;
    let versionLabel = v.version;

    // Use real git history if available
    // realCommits[0] is newest. versions[5] is newest ("Current").
    // So index maps to realCommits[5 - index].
    if (realCommits && realCommits.length > 0) {
      const commitIndex = Math.min(5 - index, realCommits.length - 1);
      const commit = realCommits[commitIndex];
      if (commit) {
        commit_hash = commit.hash;
        author = commit.author;
        dateStr = commit.date.split("T")[0]; // use real date
        versionLabel = commit.hash.substring(0, 7); // Use short hash as version
      }
    }

    // Introduce deterministic fluctuation using seed and version index
    const versionSeed = seed + index * 107;
    const noise = (versionSeed % 100) / 100; // 0.0 - 0.99
    const fluctuation = 0.85 + noise * 0.3; // 0.85 - 1.15

    const commitCount = clamp(Math.round(v.commitBase * scaleMultiplier * fluctuation), 1, 10000);
    const codeChurn = clamp(Math.round(v.churnBase * scaleMultiplier * fluctuation), 10, 1000000);
    const featureCount = clamp(Math.round(v.features * scaleMultiplier * fluctuation), 1, 500);
    const bugsFixed = clamp(Math.round(v.bugs * scaleMultiplier * fluctuation), 0, 500);

    const risk_score = clamp(Math.round(avgRiskScore * v.riskMultiplier * (0.95 + noise * 0.1)), 0, 100);
    const vulnerability_accumulation = clamp(Math.round(vulnsCount * v.vulnMultiplier * (0.9 + noise * 0.2)), 0, 1000);
    const dependency_count = clamp(Math.round(depsCount * v.depMultiplier * (0.95 + noise * 0.1)), 0, 10000);
    const entropy = Number((avgEntropyScore * v.entropyMultiplier * (0.9 + noise * 0.2)).toFixed(2));
    const modules_changed = clamp(Math.round(modulesCount * (0.2 + noise * 0.3)), 1, modulesCount);

    return {
      version: versionLabel,
      date: dateStr,
      risk_score,
      vulnerability_accumulation,
      dependency_count,
      entropy,
      modules_changed,
      commit_count: commitCount,
      avg_commit_size: Math.round(codeChurn / commitCount),
      code_churn: codeChurn,
      days_to_release: Math.max(1, Math.round(v.offsetDays / 5) + 3),
      breaking_changes: Math.round(featureCount * 0.2),
      bugs_fixed: bugsFixed,
      feature_count: featureCount,
      commit_hash,
      author
    };
  });
}

module.exports = { generateEvolutionTimeline };
