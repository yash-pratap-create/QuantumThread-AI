import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { fetchProjects, uploadProject, importGithub, fetchProjectStatus, deleteProject, reanalyzeProject, sendChat } from "../api";
import useIntelligenceStore from "../store/intelligence.store";

/* ═══════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — dark futuristic palette (matches Dashboard)
   ═══════════════════════════════════════════════════════════════════════ */
const darkBg = "#0B0F1A";
const cardBg = "rgba(26,31,46,0.6)";
const glass = {
  background: cardBg,
  backdropFilter: "blur(16px) saturate(120%)",
  WebkitBackdropFilter: "blur(16px) saturate(120%)",
};
const sidebarGlass = {
  background: "rgba(11,15,26,0.95)",
  backdropFilter: "blur(20px) saturate(130%)",
  WebkitBackdropFilter: "blur(20px) saturate(130%)",
};
const glowShadow = "0 0 0 1px rgba(255,255,255,0.03), 0 6px 24px rgba(0,0,0,0.3)";

const Icon = ({ name, className = "", style = {} }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>
    {name}
  </span>
);

const navItemsProject = [
  { label: "Dashboard", icon: "dashboard", path: "/project" },
  { label: "Architecture Map", icon: "map", path: "/project/architecture" },
  { label: "Bug & Risk Analysis", icon: "bug_report", path: "/project/bug-risk" },
  { label: "Security Scanner", icon: "shield", path: "/project/security" },
  { label: "Dependency Intelligence", icon: "share", path: "/project/dependencies" },
  { label: "Repository Evolution", icon: "history", path: "/project/evolution" },
];

const navItemsAssistant = [
  { label: "AI Query Console", icon: "smart_toy", path: "/assistant" },
];

function Layout({ mode = "project" }) {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState("main");
  const [showNewProject, setShowNewProject] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const navItems = mode === "assistant" ? navItemsAssistant : navItemsProject;
  const isAssistant = mode === "assistant";

  // Fetch projects on mount
  useEffect(() => {
    if (isAssistant) return;
    fetchProjects()
      .then((rows) => {
        setProjects(rows);
        if (rows.length > 0 && !selectedProjectId) {
          setSelectedProjectId(rows[0].id);
        }
        setLoadingProjects(false);
      })
      .catch(() => setLoadingProjects(false));
  }, [isAssistant]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  // Sync selected project to the global intelligence store
  const setSelectedRepository = useIntelligenceStore((s) => s.setSelectedRepository);
  useEffect(() => {
    if (selectedProject?.name) {
      setSelectedRepository(selectedProject.name);
    }
  }, [selectedProject?.name, setSelectedRepository]);

  const handleProjectCreated = useCallback((newProject) => {
    setProjects((prev) => [newProject, ...prev]);
    setSelectedProjectId(newProject.id);
    setShowNewProject(false);
  }, []);

  return (
    <div className="qt-dark flex h-screen overflow-hidden" style={{ background: darkBg }}>
      {/* Sidebar */}
      <motion.aside
        className="w-64 border-r border-white/[0.06] flex flex-col shrink-0"
        style={{ ...sidebarGlass }}
        initial={{ x: -20, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <div className="p-6 flex items-center gap-3">
          <motion.div
            className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white"
            style={{ boxShadow: "0 0 20px rgba(99,102,241,0.35)" }}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}>
            <Icon
              name="hub"
              style={{
                fontVariationSettings:
                  "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48",
              }}
              className="text-2xl"
            />
          </motion.div>
          <motion.h1
            className="font-bold text-lg tracking-tight text-white leading-none"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.3 }}
          >
            QuantumThread AI
          </motion.h1>
        </div>

        {/* Mode indicator + switch */}
        <div className="px-3 mb-2">
          <button
            onClick={() => navigate("/")}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-semibold border border-white/[0.06] hover:bg-white/[0.04] transition-colors text-slate-400"
          >
            <Icon
              name={isAssistant ? "smart_toy" : "folder_open"}
              className="text-base"
            />
            <span className="flex-1 text-left truncate">
              {isAssistant ? "AI Assistant Mode" : "Project Analysis Mode"}
            </span>
            <Icon name="swap_horiz" className="text-sm text-slate-500" />
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item, idx) => {
            const isActive = item.path === location.pathname;
            const isLink = item.path !== "#";

            if (isLink) {
              return (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.2 + idx * 0.04, duration: 0.25 }}
                >
                  <Link
                    to={item.path}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isActive
                        ? "text-indigo-400"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                    }`}
                    style={
                      isActive
                        ? {
                            background: "rgba(99,102,241,0.12)",
                            boxShadow: "0 0 12px rgba(99,102,241,0.1), inset 0 0 0 1px rgba(99,102,241,0.2)",
                          }
                        : {}
                    }
                  >
                    <Icon name={item.icon} className="text-[20px]" />
                    {item.label}
                    {isActive && (
                      <motion.div
                        className="ml-auto w-1.5 h-1.5 bg-indigo-400 rounded-full"
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        style={{ boxShadow: "0 0 6px rgba(99,102,241,0.6)" }}
                      />
                    )}
                  </Link>
                </motion.div>
              );
            }

            return (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + idx * 0.04, duration: 0.25 }}
              >
                <a
                  href={item.path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-200"
                >
                  <Icon name={item.icon} className="text-[20px]" />
                  {item.label}
                </a>
              </motion.div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/[0.06] space-y-1">
          {/* Cross-mode quick link */}
          <Link
            to={isAssistant ? "/project" : "/assistant"}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-200"
          >
            <Icon name={isAssistant ? "folder_open" : "smart_toy"} className="text-[20px]" />
            {isAssistant ? "Project Analysis" : "AI Assistant"}
          </Link>
          <a
            href="#"
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-slate-400 hover:bg-white/[0.04] hover:text-slate-200 transition-all duration-200"
          >
            <Icon name="settings" className="text-[20px]" />
            Settings
          </a>
        </div>
      </motion.aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <motion.header
          className="h-16 border-b border-white/[0.06] flex items-center justify-between px-8 shrink-0"
          style={{ ...glass, boxShadow: glowShadow }}
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <div className="flex items-center gap-4 flex-1">
            {isAssistant ? (
              /* Assistant mode header */
              <>
                <div className="flex items-center gap-2">
                  <Icon name="smart_toy" className="text-[20px] text-violet-400" />
                  <span className="text-sm font-semibold text-white">AI Query Console</span>
                  <span className="text-[10px] font-semibold text-violet-400 bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 rounded-full">5 Agents</span>
                </div>
                <div className="relative w-full max-w-md ml-4">
                  <Icon
                    name="search"
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[20px]"
                  />
                  <input
                    id="conversation-search"
                    name="conversation-search"
                    className="w-full pl-10 pr-4 py-1.5 bg-white/[0.06] border border-white/[0.06] rounded-md text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 placeholder-slate-500"
                    placeholder="Search conversations..."
                    type="text"
                    autoComplete="off"
                  />
                </div>
              </>
            ) : (
              /* Project mode header */
              <>
            {/* Project Selector Dropdown */}
            <div className="flex items-center gap-2">
              <select
                id="project-select"
                name="project-select"
                value={selectedProjectId || ""}
                onChange={(e) => setSelectedProjectId(Number(e.target.value))}
                className="flex items-center gap-2 px-3 py-1.5 border border-white/[0.06] rounded text-sm font-medium bg-white/[0.06] text-slate-300 hover:bg-white/[0.08] transition-colors cursor-pointer"
                disabled={loadingProjects || projects.length === 0}
              >
                {projects.length === 0 && (
                  <option value="">{loadingProjects ? "Loading…" : "No projects"}</option>
                )}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setShowNewProject(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded transition-colors"
                style={{ boxShadow: "0 0 12px rgba(99,102,241,0.25)" }}
              >
                <Icon name="add" className="text-base" />
                New
              </button>
              {selectedProject && (
                <>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete project "${selectedProject.name}"? This will remove all analysis data.`)) return;
                    try {
                      await deleteProject(selectedProject.id);
                      setProjects((prev) => prev.filter((p) => p.id !== selectedProject.id));
                      setSelectedProjectId((prev) => {
                        const remaining = projects.filter((p) => p.id !== selectedProject.id);
                        return remaining.length > 0 ? remaining[0].id : null;
                      });
                    } catch (err) {
                      console.error("Failed to delete project:", err);
                      alert("Failed to delete project: " + err.message);
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 text-red-400 hover:bg-red-500/15 hover:text-red-300 rounded text-sm transition-colors"
                  title={`Delete ${selectedProject.name}`}
                >
                  <Icon name="delete" className="text-base" />
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm("Re-analyze project? This will regenerate all intelligence data.")) return;
                    try {
                      await reanalyzeProject(selectedProject.id);
                      setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, status: "analyzing" } : p));
                      const poll = async () => {
                        try {
                          const s = await fetchProjectStatus(selectedProject.id);
                          if (s.status === "ready") {
                            setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, status: "ready" } : p));
                          } else if (s.status === "error") {
                            alert("Re-analysis failed.");
                            setProjects((prev) => prev.map((p) => p.id === selectedProject.id ? { ...p, status: "error" } : p));
                          } else {
                            setTimeout(poll, 3000);
                          }
                        } catch (e) { setTimeout(poll, 5000); }
                      };
                      setTimeout(poll, 3000);
                    } catch (err) {
                      console.error("Failed to re-analyze:", err);
                      alert("Failed to re-analyze: " + err.message);
                    }
                  }}
                  className="flex items-center gap-1 px-2 py-1.5 text-amber-400 hover:bg-amber-500/15 hover:text-amber-300 rounded text-sm transition-colors"
                  title="Re-analyze project"
                >
                  <Icon name="refresh" className="text-base" />
                </button>
                </>
              )}
            </div>

            <div className="h-4 w-[1px] bg-white/[0.06]"></div>

            {/* Branch Badge */}
            <div className="flex items-center px-2 py-1 bg-white/[0.06] rounded text-[11px] font-bold text-slate-400 uppercase tracking-wider border border-white/[0.06]">
              {selectedBranch}
            </div>

            <div className="relative w-full max-w-md ml-4">
              <Icon
                name="search"
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-[20px]"
              />
              <input
                id="architecture-search"
                name="architecture-search"
                className="w-full pl-10 pr-4 py-1.5 bg-white/[0.06] border border-white/[0.06] rounded-md text-sm text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 placeholder-slate-500"
                placeholder="Search architecture, files, or agents..."
                type="text"
                autoComplete="off"
              />
            </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Project info badge (project mode only) */}
            {!isAssistant && selectedProject && (
              <motion.div
                className="flex items-center gap-2 px-3 py-1 rounded-lg border border-white/[0.06]"
                style={{ ...glass, boxShadow: glowShadow }}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
              >
                <Icon name="folder_open" className="text-sm text-indigo-400" />
                <span className="text-[10px] font-mono text-slate-400 truncate max-w-[160px]">
                  {selectedProject.repo_url || selectedProject.name}
                </span>
                <motion.div
                  className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  style={{ boxShadow: "0 0 6px rgba(52,211,153,0.5)" }}
                />
              </motion.div>
            )}

          </div>
        </motion.header>

        {/* Page Content */}
        <motion.div
          className="flex-1 overflow-y-auto relative"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <Outlet context={{ selectedProject, selectedBranch }} />
        </motion.div>

        {/* Project AI Chat Panel — only in project mode */}
        {!isAssistant && <ProjectChatPanel selectedProject={selectedProject} />}
      </div>

      {/* New Project Modal */}
      {showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={handleProjectCreated}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// NEW PROJECT MODAL — Upload from PC or GitHub URL
// ═══════════════════════════════════════════════════════
function NewProjectModal({ onClose, onCreated }) {
  const [tab, setTab] = useState("upload"); // "upload" | "github"
  const [githubUrl, setGithubUrl] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(null); // null | "analyzing" | "ready" | "error"
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && dropped.name.endsWith(".zip")) {
      setFile(dropped);
      setError("");
    } else {
      setError("Please drop a .zip file");
    }
  };

  const handleFileSelect = (e) => {
    const selected = e.target.files[0];
    if (selected) {
      setFile(selected);
      setError("");
    }
  };

  const pollStatus = useCallback(async (projectId, project) => {
    const poll = async () => {
      try {
        const s = await fetchProjectStatus(projectId);
        if (s.status === "ready") {
          setStatus("ready");
          onCreated({ ...project, status: "ready" });
        } else if (s.status === "error") {
          setStatus("error");
          setError("Analysis failed. Project was created but analysis encountered an error.");
          setSaving(false);
        } else {
          setTimeout(poll, 3000);
        }
      } catch {
        setTimeout(poll, 5000);
      }
    };
    poll();
  }, [onCreated]);

  const handleSubmit = async () => {
    setSaving(true);
    setError("");
    setStatus("analyzing");

    try {
      let project;
      if (tab === "upload") {
        if (!file) { setError("Select a .zip file"); setSaving(false); setStatus(null); return; }
        project = await uploadProject(file);
      } else {
        if (!githubUrl.trim()) { setError("Enter a GitHub URL"); setSaving(false); setStatus(null); return; }
        project = await importGithub(githubUrl.trim());
      }

      // Start polling for analysis completion
      pollStatus(project.id, project);
    } catch (err) {
      setError(err.message || "Failed to create project");
      setSaving(false);
      setStatus(null);
    }
  };

  const tabClass = (t) =>
    `flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all ${
      tab === t
        ? "bg-indigo-600 text-white shadow-lg"
        : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]"
    }`;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={!saving ? onClose : undefined} />

        <motion.div
          className="relative w-full max-w-lg mx-4 rounded-2xl border border-white/[0.08] p-8"
          style={{
            background: "rgba(17,22,36,0.95)",
            backdropFilter: "blur(20px)",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.03), 0 24px 80px rgba(0,0,0,0.5), 0 0 40px rgba(99,102,241,0.1)",
          }}
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center"
              style={{ boxShadow: "0 0 16px rgba(99,102,241,0.35)" }}
            >
              <Icon name={status === "analyzing" ? "hourglass_top" : "add_circle"} className="text-white text-xl" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {status === "analyzing" ? "Analyzing Project…" : "Add Project"}
              </h2>
              <p className="text-xs text-slate-500">
                {status === "analyzing"
                  ? "AI agents are scanning your code"
                  : "Upload a ZIP or import from GitHub"}
              </p>
            </div>
          </div>

          {/* Analysis progress */}
          {status === "analyzing" && (
            <div className="mb-6">
              <div className="flex items-center gap-3 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/10">
                <div className="w-8 h-8 border-3 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-indigo-300">Running AI Analysis</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Scanning files, detecting modules, analyzing security, building dependency graph…
                  </p>
                </div>
              </div>
              {error && (
                <p className="mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
              )}
            </div>
          )}

          {/* Tabs + Form (hidden during analysis) */}
          {!status && (
            <>
              {/* Tab Switcher */}
              <div className="flex gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] mb-5">
                <button className={tabClass("upload")} onClick={() => { setTab("upload"); setError(""); }}>
                  <Icon name="upload_file" className="text-base align-middle mr-1.5" />
                  Upload ZIP
                </button>
                <button className={tabClass("github")} onClick={() => { setTab("github"); setError(""); }}>
                  <Icon name="link" className="text-base align-middle mr-1.5" />
                  GitHub URL
                </button>
              </div>

              {/* Upload Tab */}
              {tab === "upload" && (
                <div className="space-y-4">
                  <div
                    className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                      dragOver
                        ? "border-indigo-400 bg-indigo-500/10"
                        : file
                          ? "border-emerald-500/50 bg-emerald-500/5"
                          : "border-white/[0.1] hover:border-white/[0.2] hover:bg-white/[0.02]"
                    }`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleFileDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      id="project-file-upload"
                      name="project-file-upload"
                      ref={fileInputRef}
                      type="file"
                      accept=".zip"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    {file ? (
                      <div className="flex items-center justify-center gap-3">
                        <Icon name="folder_zip" className="text-3xl text-emerald-400" />
                        <div className="text-left">
                          <p className="text-sm font-semibold text-white">{file.name}</p>
                          <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); setFile(null); }}
                          className="ml-2 p-1 text-slate-500 hover:text-white transition-colors"
                        >
                          <Icon name="close" className="text-base" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <Icon name="cloud_upload" className="text-4xl text-slate-500 mb-2" />
                        <p className="text-sm text-slate-300 font-medium">
                          Drag & drop your project <span className="text-indigo-400">.zip</span> here
                        </p>
                        <p className="text-xs text-slate-500 mt-1">or click to browse (max 100MB)</p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* GitHub Tab */}
              {tab === "github" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">
                      Repository URL
                    </label>
                    <input
                      id="github-url-input"
                      name="github-url-input"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/user/repo"
                      className="w-full px-4 py-2.5 bg-white/[0.06] border border-white/[0.08] rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all"
                      autoFocus
                      autoComplete="off"
                    />
                    <p className="text-[10px] text-slate-500 mt-1.5">Public repositories only. We'll clone and analyze the code.</p>
                  </div>
                </div>
              )}

              {error && (
                <p className="mt-4 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-5">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-white/[0.08] text-sm font-medium text-slate-400 hover:bg-white/[0.04] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={saving || (tab === "upload" ? !file : !githubUrl.trim())}
                  className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                  style={{ boxShadow: "0 0 16px rgba(99,102,241,0.3)" }}
                >
                  <Icon name={tab === "upload" ? "upload" : "download"} className="text-base" />
                  {tab === "upload" ? "Upload & Analyze" : "Import & Analyze"}
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════
// PROJECT CHAT PANEL — collapsible bottom chat widget
// ═══════════════════════════════════════════════════════
const agentConfig = {
  architecture: { icon: "account_tree", label: "Architecture", color: "text-blue-400", bg: "bg-blue-500/15", border: "border-blue-500/30", accent: "bg-blue-600" },
  bug_detection: { icon: "bug_report", label: "Bug Detection", color: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30", accent: "bg-red-600" },
  security: { icon: "shield", label: "Security", color: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30", accent: "bg-amber-600" },
  performance: { icon: "speed", label: "Performance", color: "text-green-400", bg: "bg-green-500/15", border: "border-green-500/30", accent: "bg-green-600" },
  tutor: { icon: "school", label: "Tutor", color: "text-violet-400", bg: "bg-violet-500/15", border: "border-violet-500/30", accent: "bg-violet-600" },
};

function ProjectChatPanel({ selectedProject }) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  const handleSubmit = async () => {
    const input = prompt.trim();
    if (!input || loading) return;

    setMessages((prev) => [...prev, { role: "user", content: input, timestamp: new Date().toISOString() }]);
    setPrompt("");
    setLoading(true);

    try {
      const data = await sendChat(input, selectedProject?.id || null);
      const agents = (data.responses || []).map((r) => ({
        agent: r.agent,
        reply: r.reply,
        confidence: r.confidence,
      }));
      setMessages((prev) => [...prev, { role: "assistant", agents, timestamp: data.timestamp || new Date().toISOString() }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "error", content: err.message, timestamp: new Date().toISOString() }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  const toggleAgent = (msgIdx, agentName) => {
    const key = `${msgIdx}-${agentName}`;
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <>
      {/* Floating toggle button */}
      {!open && (
        <motion.button
          onClick={() => setOpen(true)}
          className="absolute bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-sm font-medium transition-colors"
          style={{ boxShadow: "0 0 20px rgba(99,102,241,0.35), 0 4px 16px rgba(0,0,0,0.3)" }}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Icon name="smart_toy" className="text-lg" />
          Ask AI about this project
        </motion.button>
      )}

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 420, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="shrink-0 border-t border-white/[0.06] flex flex-col overflow-hidden"
            style={{ ...glass, boxShadow: "0 -4px 30px rgba(0,0,0,0.3)" }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/[0.06] shrink-0" style={{ background: "rgba(26,31,46,0.5)" }}>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-indigo-600 rounded-md flex items-center justify-center" style={{ boxShadow: "0 0 10px rgba(99,102,241,0.3)" }}>
                  <Icon name="smart_toy" className="text-white text-sm" />
                </div>
                <span className="text-xs font-bold text-white">Project AI Assistant</span>
                <span className="text-[10px] font-mono font-semibold text-indigo-400 bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 rounded-full">5 Agents</span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button
                    onClick={() => setMessages([])}
                    className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                    title="Clear chat"
                  >
                    <Icon name="delete_sweep" className="text-base" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                  title="Minimize"
                >
                  <Icon name="keyboard_arrow_down" className="text-lg" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && !loading && (
                <div className="text-center py-8">
                  <Icon name="smart_toy" className="text-3xl text-slate-500" />
                  <p className="text-xs text-slate-500 mt-2">Ask anything about your project — architecture, bugs, security, performance.</p>
                </div>
              )}

              {messages.map((msg, idx) => (
                <div key={idx}>
                  {msg.role === "user" ? (
                    <div className="flex justify-end">
                      <div className="max-w-[80%] bg-indigo-600 text-white px-3.5 py-2 rounded-xl rounded-br-sm text-xs leading-relaxed">
                        {msg.content}
                      </div>
                    </div>
                  ) : msg.role === "error" ? (
                    <div className="flex justify-start">
                      <div className="max-w-[80%] bg-red-500/15 border border-red-500/30 text-red-400 px-3.5 py-2 rounded-xl rounded-bl-sm text-xs">
                        {msg.content}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {msg.agents.map((agent, ai) => {
                        const cfg = agentConfig[agent.agent] || {};
                        const key = `${idx}-${agent.agent}`;
                        const isHidden = collapsed[key];
                        return (
                          <div key={ai} className={`rounded-lg border ${cfg.border || "border-white/[0.06]"} overflow-hidden`} style={{ background: "rgba(255,255,255,0.04)" }}>
                            <button
                              onClick={() => toggleAgent(idx, agent.agent)}
                              className={`w-full flex items-center gap-2 px-3 py-1.5 ${cfg.bg || "bg-white/[0.04]"} hover:brightness-110 transition-all`}
                            >
                              <div className={`w-5 h-5 ${cfg.accent || "bg-slate-600"} rounded flex items-center justify-center shrink-0`}>
                                <Icon name={cfg.icon || "smart_toy"} className="text-white text-[11px]" />
                              </div>
                              <span className={`text-[11px] font-bold ${cfg.color || "text-slate-300"}`}>{cfg.label || agent.agent}</span>
                              <span className="ml-auto flex items-center gap-1.5">
                                <span className="text-[9px] font-semibold text-slate-400 bg-white/[0.06] px-1.5 py-0.5 rounded-full border border-white/[0.04]">
                                  {Math.round(agent.confidence * 100)}%
                                </span>
                                <Icon name={isHidden ? "expand_more" : "expand_less"} className="text-sm text-slate-500" />
                              </span>
                            </button>
                            {!isHidden && (
                              <div className="px-3 py-2 border-t border-white/[0.04]">
                                <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-wrap">{agent.reply}</p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-slate-500 py-1">
                  <div className="w-5 h-5 bg-indigo-600 rounded flex items-center justify-center">
                    <Icon name="smart_toy" className="text-white text-[11px] animate-pulse" />
                  </div>
                  <span className="text-[11px]">Analyzing</span>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-1 h-1 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-1 h-1 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-white/[0.04] px-4 py-2.5" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-2">
                <input
                  id="chat-prompt-input"
                  name="chat-prompt-input"
                  ref={inputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about architecture, bugs, security..."
                  className="flex-1 px-3 py-2 bg-white/[0.06] border border-white/[0.06] rounded-lg text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-transparent placeholder-slate-500"
                  autoComplete="off"
                />
                <button
                  onClick={handleSubmit}
                  disabled={loading || !prompt.trim()}
                  className="shrink-0 w-8 h-8 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 text-white rounded-lg flex items-center justify-center transition-colors"
                >
                  <Icon name="send" className="text-sm" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export default Layout;
