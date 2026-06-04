import { create } from "zustand";
import {
  fetchModules,
  fetchVulnerabilities,
  fetchDependencies,
  fetchEvolution,
  fetchArchitecture,
  fetchSummary,
} from "../api";

// PHASE 8: Global Intelligence Engine State
// Centralized data layer — fetches from REST API backend

const useIntelligenceStore = create((set, get) => ({
  // ==================== DATA (loaded from API) ====================
  modules: [],
  vulnerabilities: [],
  dependencies: [],
  timePeriods: [],
  architecture: { nodes: [], edges: [] },
  summary: null,
  cache: {},

  // ==================== LOADING STATE ====================
  loading: false,
  error: null,
  initialized: false,

  // ==================== UI STATE ====================
  selectedRepository: null,
  selectedBranch: "main",
  selectedVersion: "Current",

  // ==================== DATA FETCHING ====================
  fetchAll: async (repo, isSilent = false) => {
    const repository = repo || get().selectedRepository;
    if (!repository) return;
    if (!isSilent) {
      set({ loading: true, error: null });
    }
    try {
      const [modules, vulnerabilities, dependencies, timePeriods, architecture, summary] =
        await Promise.all([
          fetchModules(repository),
          fetchVulnerabilities(repository),
          fetchDependencies(repository),
          fetchEvolution(repository),
          fetchArchitecture(repository),
          fetchSummary(repository),
        ]);

      const updatedCache = {
        ...get().cache,
        [repository]: {
          modules,
          vulnerabilities,
          dependencies,
          timePeriods,
          architecture,
          summary,
        }
      };

      set({
        modules,
        vulnerabilities,
        dependencies,
        timePeriods,
        architecture,
        summary,
        cache: updatedCache,
        loading: false,
        initialized: true,
      });
    } catch (err) {
      console.error("Failed to fetch intelligence data:", err);
      if (!isSilent) {
        set({ error: err.message, loading: false });
      }
    }
  },

  fetchModulesData: async (repo) => {
    const repository = repo || get().selectedRepository;
    try {
      const modules = await fetchModules(repository);
      set({ modules });
    } catch (err) {
      console.error("Failed to fetch modules:", err);
    }
  },

  fetchVulnerabilitiesData: async (repo) => {
    const repository = repo || get().selectedRepository;
    try {
      const vulnerabilities = await fetchVulnerabilities(repository);
      set({ vulnerabilities });
    } catch (err) {
      console.error("Failed to fetch vulnerabilities:", err);
    }
  },

  fetchDependenciesData: async (repo) => {
    const repository = repo || get().selectedRepository;
    try {
      const dependencies = await fetchDependencies(repository);
      set({ dependencies });
    } catch (err) {
      console.error("Failed to fetch dependencies:", err);
    }
  },

  fetchEvolutionData: async (repo) => {
    const repository = repo || get().selectedRepository;
    try {
      const timePeriods = await fetchEvolution(repository);
      set({ timePeriods });
    } catch (err) {
      console.error("Failed to fetch evolution:", err);
    }
  },

  fetchArchitectureData: async (repo) => {
    const repository = repo || get().selectedRepository;
    try {
      const architecture = await fetchArchitecture(repository);
      set({ architecture });
    } catch (err) {
      console.error("Failed to fetch architecture:", err);
    }
  },

  // ==================== MEMOIZED SELECTORS ====================

  // Bug & Risk selectors
  getModuleById: (moduleId) => {
    const { modules } = get();
    return modules.find((m) => m.id === moduleId);
  },

  calculateEntropy: () => {
    const { modules } = get();
    const bugCounts = modules.map((m) => m.bugCount);
    const total = bugCounts.reduce((sum, count) => sum + count, 0);
    const probabilities = bugCounts.map(
      (count) => (count + 1) / (total + bugCounts.length),
    );
    const entropy = -probabilities.reduce(
      (sum, p) => sum + (p > 0 ? p * Math.log2(p) : 0),
      0,
    );
    const maxEntropy = Math.log2(bugCounts.length);
    const normalized = (entropy / maxEntropy) * 100;
    return {
      raw: entropy.toFixed(3),
      normalized: Math.round(normalized),
      maxEntropy: maxEntropy.toFixed(3),
      interpretation:
        normalized > 66
          ? "distributed"
          : normalized > 33
            ? "balanced"
            : "concentrated",
    };
  },

  calculateGravity: (moduleId) => {
    const { modules } = get();
    const module = modules.find((m) => m.id === moduleId);
    if (!module) return 0;
    const baseGravity = module.riskScore;
    const cascadeEffect = module.dependencyCount * 2;
    return baseGravity + cascadeEffect;
  },

  // Security Scanner selectors
  getSecurityScore: () => {
    const { vulnerabilities } = get();
    const criticalCount = vulnerabilities.filter(
      (v) => v.severity === "critical",
    ).length;
    const highCount = vulnerabilities.filter(
      (v) => v.severity === "high",
    ).length;
    const mediumCount = vulnerabilities.filter(
      (v) => v.severity === "medium",
    ).length;
    const criticalWeight = criticalCount * 30;
    const highWeight = highCount * 15;
    const mediumWeight = mediumCount * 8;
    const totalWeight = criticalWeight + highWeight + mediumWeight;
    const maxWeight = 100;
    const normalizedRisk = Math.min((totalWeight / maxWeight) * 100, 100);
    return Math.max(0, 100 - normalizedRisk);
  },

  // Dependency Intelligence selectors
  getHubModules: () => {
    const { dependencies } = get();
    const maxHubScore = Math.max(
      ...dependencies.map((d) => (d.fans.in + d.fans.out) / 2),
    );
    return dependencies.filter(
      (d) => (d.fans.in + d.fans.out) / 2 > maxHubScore * 0.7,
    );
  },

  // Evolution selectors
  getRiskTrend: () => {
    const { timePeriods } = get();
    if (timePeriods.length < 2) return 0;
    return (
      timePeriods[timePeriods.length - 1].riskScore - timePeriods[0].riskScore
    );
  },

  // ==================== ACTIONS ====================
  setSelectedRepository: (repo) => {
    set({ selectedRepository: repo });
    
    // Check if we have cached data for this repository
    const cachedData = get().cache[repo];
    if (cachedData) {
      // Immediately set the state to cached data so UI doesn't show a loader
      set({
        modules: cachedData.modules || [],
        vulnerabilities: cachedData.vulnerabilities || [],
        dependencies: cachedData.dependencies || [],
        timePeriods: cachedData.timePeriods || [],
        architecture: cachedData.architecture || { nodes: [], edges: [] },
        summary: cachedData.summary || null,
      });
    } else {
      // No cache, we must show a loader and clear old data
      set({
        modules: [],
        vulnerabilities: [],
        dependencies: [],
        timePeriods: [],
        architecture: { nodes: [], edges: [] },
        summary: null,
        loading: true,
      });
    }

    // Always fetch in the background to sync with the backend
    get().fetchAll(repo, !!cachedData);
  },
  setSelectedBranch: (branch) => set({ selectedBranch: branch }),
  setSelectedVersion: (version) => set({ selectedVersion: version }),
}));

export default useIntelligenceStore;
