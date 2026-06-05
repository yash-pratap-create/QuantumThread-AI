const { execSync } = require('child_process');
const https = require('https');

/**
 * Evolution Timeline Generator
 * 
 * Real data from GitHub API (when repoUrl provided):
 *   - commit_count per week (from /stats/participation)
 *   - commit hash, date, author (from /commits)
 *   - code_churn (additions + deletions per week from /stats/code_frequency)
 * 
 * Falls back to local git log, then to deterministic estimation.
 */

// ── Helpers ────────────────────────────────────────────────────────────────

function httpsGet(options) {
  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      if (res.statusCode === 202) {
        // GitHub returns 202 when stats are being computed; treat as unavailable
        return resolve(null);
      }
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function githubOptions(path) {
  const headers = { 'User-Agent': 'QuantumThread-AI' };
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT;
  if (token) {
    headers['Authorization'] = `token ${token}`;
  }
  return {
    hostname: 'api.github.com',
    path,
    method: 'GET',
    headers
  };
}

// ── GitHub API fetchers ────────────────────────────────────────────────────

/**
 * Fetch the last N commits with real hashes, dates, authors.
 */
async function fetchGitHubCommits(owner, repo, count = 6) {
  const data = await httpsGet(githubOptions(`/repos/${owner}/${repo}/commits?per_page=${count}`));
  if (!Array.isArray(data) || data.length === 0) return null;
  return data.map(c => ({
    hash: c.sha,
    date: c.commit.author.date,
    author: c.commit.author.name,
    message: c.commit.message.split('\n')[0]
  }));
}

/**
 * Fetch weekly commit counts for the last 52 weeks (owner + all contributors).
 * Returns an array of 52 integers, one per week (oldest → newest).
 * Returns null if unavailable.
 */
async function fetchWeeklyCommitCounts(owner, repo) {
  const data = await httpsGet(githubOptions(`/repos/${owner}/${repo}/stats/participation`));
  if (!data || !Array.isArray(data.all)) return null;
  return data.all; // 52-element array, each = commit count for that week
}

/**
 * Fetch weekly code frequency (additions/deletions) for up to 52 weeks.
 * Returns array of [timestamp, additions, deletions] tuples.
 */
async function fetchWeeklyCodeFrequency(owner, repo) {
  const data = await httpsGet(githubOptions(`/repos/${owner}/${repo}/stats/code_frequency`));
  if (!Array.isArray(data) || data.length === 0) return null;
  return data; // each: [unix_timestamp, additions, -deletions]
}

/**
 * Fetch total repository stats (size, stars, open_issues, etc.)
 */
async function fetchRepoMeta(owner, repo) {
  const data = await httpsGet(githubOptions(`/repos/${owner}/${repo}`));
  return data;
}

/**
 * Fetch total commit count using the GitHub Link header trick.
 * Makes ONE request with per_page=1 and reads the "last" page number
 * from the Link response header — that page number IS the total commit count.
 * 100x faster than paginating through all commits.
 */
function fetchTotalCommitCount(owner, repo) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/commits?per_page=1`,
      method: 'GET',
      headers: { 'User-Agent': 'QuantumThread-AI' }
    };
    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      res.resume(); // drain body — we only need the header
      const link = res.headers['link'] || '';
      // Link header format: <...?page=1234>; rel="last"
      const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
      resolve(match ? parseInt(match[1], 10) : null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ── Local Git fallback ─────────────────────────────────────────────────────

function fetchGitHistory(projectDir) {
  if (!projectDir) return null;
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'ignore' });
    const logOutput = execSync(
      'git log -n 6 --pretty=format:"%H|%cI|%an|%s" --first-parent',
      { cwd: projectDir, encoding: 'utf-8' }
    );
    if (!logOutput.trim()) return null;
    return logOutput.trim().split('\n').filter(Boolean).map(line => {
      const parts = line.split('|');
      return { hash: parts[0], date: parts[1], author: parts[2], message: parts.slice(3).join('|') };
    });
  } catch {
    return null;
  }
}

function fetchGitWeeklyCommits(projectDir) {
  if (!projectDir) return null;
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'ignore' });
    // Count commits per week for the last 12 weeks
    const weeks = [];
    for (let w = 11; w >= 0; w--) {
      const after = new Date(Date.now() - (w + 1) * 7 * 24 * 3600 * 1000);
      const before = new Date(Date.now() - w * 7 * 24 * 3600 * 1000);
      const out = execSync(
        `git log --oneline --after="${after.toISOString()}" --before="${before.toISOString()}"`,
        { cwd: projectDir, encoding: 'utf-8' }
      );
      weeks.push(out.trim().split('\n').filter(Boolean).length);
    }
    return weeks;
  } catch {
    return null;
  }
}

// ── Main generator ─────────────────────────────────────────────────────────

async function generateEvolutionTimeline(
  repoName, modulesCount, vulnsCount, depsCount,
  avgRiskScore, avgEntropyScore,
  projectDir = null, repoUrl = null
) {
  const clamp = (val, min, max) => Math.max(min, Math.min(max, Number(val) || 0));

  // Deterministic seed (fallback for estimated values)
  let seed = 0;
  for (let i = 0; i < repoName.length; i++) {
    seed = repoName.charCodeAt(i) + ((seed << 5) - seed);
  }
  seed = Math.abs(seed);
  const scaleMultiplier = clamp(modulesCount / 5, 0.4, 5.0);

  // ── Fetch real data ────────────────────────────────────────────────────
  let recentCommits = null;   // last 6 commit objects
  let weeklyCommits = null;   // 52-element weekly counts array
  let weeklyChurn = null;     // [[ts, +lines, -lines], …]
  let repoMeta = null;
  let realTotalCommits = null; // total commit count via Link header trick

  if (repoUrl) {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/\.]+)/i);
    if (match) {
      const [, owner, repo] = match;
      console.log(`[Timeline] Fetching real GitHub stats for ${owner}/${repo}…`);
      [recentCommits, weeklyCommits, weeklyChurn, repoMeta, realTotalCommits] = await Promise.all([
        fetchGitHubCommits(owner, repo),
        fetchWeeklyCommitCounts(owner, repo),
        fetchWeeklyCodeFrequency(owner, repo),
        fetchRepoMeta(owner, repo),
        fetchTotalCommitCount(owner, repo)
      ]);
      console.log(`[Timeline] commits=${recentCommits?.length ?? 'null'}, weeklyCommits=${weeklyCommits ? 'ok' : 'null'}, churn=${weeklyChurn ? 'ok' : 'null'}, totalCommits=${realTotalCommits ?? 'null'}`);
    }
  }

  // Local git fallback
  if (!recentCommits) recentCommits = fetchGitHistory(projectDir);
  if (!weeklyCommits) weeklyCommits = fetchGitWeeklyCommits(projectDir);

  // ── Slice weekly data into 6 time windows ─────────────────────────────
  // We split the last 6 weeks (or last 6 month-buckets) of the 52-week array
  // into 6 slots that map to our 6 timeline entries (oldest → newest).

  const NUM_PERIODS = 6;

  // Group the 52-week array into 6 buckets of ~8-9 weeks each
  function bucketizeWeekly(arr, buckets) {
    if (!arr || arr.length === 0) return null;
    const result = [];
    const chunkSize = Math.ceil(arr.length / buckets);
    for (let b = 0; b < buckets; b++) {
      const start = b * chunkSize;
      const chunk = arr.slice(start, start + chunkSize);
      result.push(chunk.reduce((s, v) => s + Math.abs(v), 0));
    }
    return result;
  }

  const realCommitCounts = bucketizeWeekly(weeklyCommits, NUM_PERIODS); // [oldest…newest]
  const realChurnTotals = weeklyChurn
    ? bucketizeWeekly(weeklyChurn.map(([, add, del]) => Math.abs(add) + Math.abs(del)), NUM_PERIODS)
    : null;

  // ── Build 6 periods ───────────────────────────────────────────────────
  // versions[0] = oldest (35 days ago), versions[5] = newest (Current)
  const versionLabels = ["v1.0", "v1.1", "v1.2", "v1.3", "v1.4", "Current"];
  const offsetDays    = [35, 28, 21, 14, 7, 0];
  const riskMult      = [1.30, 1.20, 1.15, 1.05, 1.02, 1.00];
  const vulnMult      = [0.50, 0.70, 0.80, 1.10, 0.90, 1.00];
  const depMult       = [0.60, 0.70, 0.80, 0.90, 0.95, 1.00];
  const entropyMult   = [0.70, 0.80, 0.95, 1.10, 1.05, 1.00];
  // Fallback commit bases (only used when GitHub API and git are unavailable)
  const commitBases   = [120, 95, 140, 80, 110, 70];
  const churnBases    = [12000, 8500, 15000, 6000, 9800, 5000];
  const featureBases  = [12, 8, 15, 6, 10, 5];
  const bugBases      = [22, 15, 30, 12, 18, 8];

  const now = new Date();

  return versionLabels.map((label, index) => {
    const versionSeed = seed + index * 107;
    const noise = (versionSeed % 100) / 100;
    const fluctuation = 0.85 + noise * 0.3;

    // ── Real commit count (from GitHub weekly stats) ─────────────────
    let commit_count;
    if (realCommitCounts && realCommitCounts[index] != null) {
      // Real count from GitHub participation API
      commit_count = clamp(realCommitCounts[index], 0, 10000);
    } else {
      // Estimated from hardcoded base × project scale
      commit_count = clamp(Math.round(commitBases[index] * scaleMultiplier * fluctuation), 1, 10000);
    }

    // ── Real code churn ──────────────────────────────────────────────
    let code_churn;
    if (realChurnTotals && realChurnTotals[index] != null) {
      code_churn = clamp(realChurnTotals[index], 0, 5000000);
    } else {
      code_churn = clamp(Math.round(churnBases[index] * scaleMultiplier * fluctuation), 10, 1000000);
    }

    // ── Real commit metadata (hash, date, author) ────────────────────
    let commit_hash = null;
    let author = null;
    let dateStr = new Date(now.getTime() - offsetDays[index] * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    let versionLabel = label;

    // Map: index 0 = oldest → use recentCommits[5], index 5 = newest → use recentCommits[0]
    if (recentCommits && recentCommits.length > 0) {
      const commitIndex = Math.min(NUM_PERIODS - 1 - index, recentCommits.length - 1);
      const commit = recentCommits[commitIndex];
      if (commit) {
        commit_hash = commit.hash;
        author = commit.author;
        dateStr = commit.date.split('T')[0];
        versionLabel = commit.hash.substring(0, 7);
      }
    }

    // ── Risk/vuln/dep/entropy (AI-derived, scaled) ───────────────────
    const risk_score = clamp(Math.round(avgRiskScore * riskMult[index] * (0.95 + noise * 0.1)), 0, 100);
    const vulnerability_accumulation = clamp(Math.round(vulnsCount * vulnMult[index] * (0.9 + noise * 0.2)), 0, 1000);
    const dependency_count = clamp(Math.round(depsCount * depMult[index] * (0.95 + noise * 0.1)), 0, 10000);
    const entropy = Number((avgEntropyScore * entropyMult[index] * (0.9 + noise * 0.2)).toFixed(2));
    const modules_changed = clamp(Math.round(modulesCount * (0.2 + noise * 0.3)), 1, modulesCount);

    // features/bugs are still estimated (GitHub doesn't expose per-period breakdowns)
    const featureCount = clamp(Math.round(featureBases[index] * scaleMultiplier * fluctuation), 1, 500);
    const bugsFixed = clamp(Math.round(bugBases[index] * scaleMultiplier * fluctuation), 0, 500);
    const avg_commit_size = commit_count > 0 ? Math.round(code_churn / commit_count) : 0;

    // ── For the "Current" period (index 5, newest), prefer the real total commit count
    // realTotalCommits = exact count from Link header (all-time, whole repo)
    let finalCommitCount = commit_count;
    if (index === NUM_PERIODS - 1 && realTotalCommits != null) {
      finalCommitCount = realTotalCommits;
    }

    return {
      version: versionLabel,
      date: dateStr,
      risk_score,
      vulnerability_accumulation,
      dependency_count,
      entropy,
      modules_changed,
      commit_count: finalCommitCount,
      avg_commit_size: finalCommitCount > 0 ? Math.round(code_churn / finalCommitCount) : 0,
      code_churn,
      days_to_release: Math.max(1, Math.round(offsetDays[index] / 5) + 3),
      breaking_changes: Math.round(featureCount * 0.2),
      bugs_fixed: bugsFixed,
      feature_count: featureCount,
      commit_hash,
      author,
      total_commits: realTotalCommits,   // real all-time total (null if unavailable)
      data_source: realCommitCounts ? 'github_api' : (weeklyCommits ? 'git_local' : 'estimated')
    };
  });
}

module.exports = { generateEvolutionTimeline };
