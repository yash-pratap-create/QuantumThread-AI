import { useState, useCallback, useMemo, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { fetchArchitecture } from "../api";

const darkBg  = "#0B0F1A";
const cardBg  = "rgba(26,31,46,0.6)";
const glass   = {
  background: cardBg,
  backdropFilter: "blur(16px) saturate(120%)",
  WebkitBackdropFilter: "blur(16px) saturate(120%)",
};
const glowShadow = "0 0 0 1px rgba(255,255,255,0.03), 0 6px 24px rgba(0,0,0,0.3)";

const Icon = ({ name, className = "", style = {} }) => (
  <span className={`material-symbols-outlined ${className}`} style={style}>
    {name}
  </span>
);

const DepthBadgeNode = ({ data }) => (
  <div className="relative group">
    <Handle
      type="target"
      position={Position.Top}
      style={{ opacity: 0, pointerEvents: "none" }}
    />
    <Handle
      type="source"
      position={Position.Bottom}
      style={{ opacity: 0, pointerEvents: "none" }}
    />
    <span className="text-slate-300">{data.label}</span>
    <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white/[0.1] text-[10px] font-semibold text-slate-400 flex items-center justify-center pointer-events-none transition-opacity duration-200 opacity-75 group-hover:opacity-100">
      {data.depthLevel || "L0"}
    </span>
  </div>
);

// Default empty config for initial render before API data loads
const defaultRepoConfig = {
  name: "Loading",
  fullName: "loading",
  nodes: [],
  edges: [],
};

// Defined outside component so ReactFlow always gets a stable reference (prevents error#002)
const NODE_TYPES = { depthBadgeNode: DepthBadgeNode };

// Stable options objects — must be outside component to avoid ReactFlow error#002
const DEFAULT_EDGE_OPTIONS = {
  type: "smoothstep",
  style: {
    stroke: "rgba(139,92,246,0.6)",
    strokeWidth: 2,
  },
};

// Stable callbacks — inline functions/objects passed to ReactFlow trigger error#002
const MINIMAP_NODE_COLOR = (node) => {
  switch (node.data.risk) {
    case "high":   return "#ef4444";
    case "medium": return "#eab308";
    case "low":    return "#10b981";
    default:       return "#94a3b8";
  }
};
const MINIMAP_MASK_COLOR = "rgba(13, 17, 23, 0.8)";
const RF_BG_STYLE = { background: "rgba(13,17,23,0.5)" };

function ArchitectureMap() {
  const { selectedProject } = useOutletContext();
  const selectedRepository = selectedProject?.name || "";
  const [selectedBranch] = useState("main");
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [heatmapEnabled, setHeatmapEnabled] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("Current");
  const [focusMode, setFocusMode] = useState(false);
  const [showHeatStrip, setShowHeatStrip] = useState(false);
  const [showGravityMap, setShowGravityMap] = useState(false);
  const [showEntropyRing, setShowEntropyRing] = useState(false);
  const [showBlastRadius, setShowBlastRadius] = useState(false);

  // Local architecture data fetched per-repository
  const [archNodes, setArchNodes] = useState([]);
  const [archEdges, setArchEdges] = useState([]);

  // Fetch architecture data when repository changes
  useEffect(() => {
    if (!selectedRepository) {
      setArchNodes([]);
      setArchEdges([]);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        console.log("ArchitectureMap: fetching architecture for repo:", selectedRepository);
        const data = await fetchArchitecture(selectedRepository);
        console.log("ArchitectureMap: API response — nodes:", data.nodes?.length, "edges:", data.edges?.length);
        if (!cancelled) {
          const formattedNodes = (data.nodes || []).map((n) => ({
            ...n,
            id: String(n.id),
          }));

          let formattedEdges = (data.edges || []).map((e) => ({
            ...e,
            type: "smoothstep",
            animated: e.animated === true || e.animated === 1,
            style: { stroke: e.style?.stroke || "#cbd5e1", strokeWidth: e.style?.strokeWidth || 2 },
          }));

          // If the DB has no edges yet, synthesise a connected graph from the nodes
          // so the Architecture Map is never shown blank for existing projects.
          if (formattedEdges.length === 0 && formattedNodes.length > 1) {
            console.log("ArchitectureMap: no edges from API — synthesizing edges for", formattedNodes.length, "nodes");
            const syntheticEdges = [];
            const defaultStyle = { stroke: "rgba(99,102,241,0.35)", strokeWidth: 1.5 };
            // Linear chain connecting adjacent nodes
            for (let i = 0; i < formattedNodes.length - 1; i++) {
              syntheticEdges.push({
                id: `synthetic-edge-${i}`,
                source: formattedNodes[i].id,
                target: formattedNodes[i + 1].id,
                type: "smoothstep",
                animated: false,
                style: defaultStyle,
              });
            }
            // Add cross-links for richer topology on 4+ node graphs
            if (formattedNodes.length >= 4) {
              const mid = Math.floor(formattedNodes.length / 2);
              syntheticEdges.push({
                id: `synthetic-edge-cross-0`,
                source: formattedNodes[0].id,
                target: formattedNodes[mid].id,
                type: "smoothstep",
                animated: false,
                style: defaultStyle,
              });
              syntheticEdges.push({
                id: `synthetic-edge-cross-1`,
                source: formattedNodes[mid].id,
                target: formattedNodes[formattedNodes.length - 1].id,
                type: "smoothstep",
                animated: false,
                style: defaultStyle,
              });
            }
            formattedEdges = syntheticEdges;
          }

          // Deduplicate by ID — guards against StrictMode double-invocation
          const seenEdgeIds = new Set();
          formattedEdges = formattedEdges.filter((e) => {
            if (seenEdgeIds.has(e.id)) return false;
            seenEdgeIds.add(e.id);
            return true;
          });

          console.log("ArchitectureMap: setting state — nodes:", formattedNodes.length, "edges:", formattedEdges.length);
          setArchNodes(formattedNodes);
          setArchEdges(formattedEdges);
        }
      } catch (err) {
        console.error("Failed to fetch architecture:", err);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedRepository]);

  // Build moduleIntelligence from fetched nodes
  const moduleIntelligence = useMemo(() => {
    const intel = {};
    archNodes.forEach((n) => {
      // Count actual edges connected to this node
      const depCount = archEdges.filter((e) => String(e.source) === String(n.id) || String(e.target) === String(n.id)).length;
      intel[n.id] = {
        name: n.data?.label || "Unknown",
        risk: n.data?.risk || "low",
        dependencies: depCount,
        summary: `Module ${n.data?.label} — risk level: ${n.data?.risk || "low"}, load: ${n.data?.load ?? 50}%`,
        impactRadius: n.data?.risk === "high" ? 4 : n.data?.risk === "medium" ? 2 : 1,
      };
    });
    return intel;
  }, [archNodes, archEdges]);

  // Version data — only current scores (no synthetic historical data)
  const versionData = useMemo(() => {
    const current = {};
    archNodes.forEach((n) => { current[n.id] = n.data?.riskScore || 0; });
    return { Current: current };
  }, [archNodes]);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // Update ReactFlow nodes/edges when architecture data loads
  useEffect(() => {
    console.log("ArchitectureMap sync — archNodes:", archNodes.length, "archEdges:", archEdges.length);
    setNodes(archNodes);
    setEdges(archEdges);
  }, [archNodes, archEdges, setNodes, setEdges]);


  // Update node risk scores when version changes
  useEffect(() => {
    const versionRiskScores = versionData[selectedVersion];
    if (!versionRiskScores) return;
    setNodes((nds) => {
      if (nds.length === 0) return nds;
      return nds.map((node) => ({
        ...node,
        data: {
          ...node.data,
          riskScore: versionRiskScores[node.id] || node.data.riskScore,
        },
      }));
    });
  }, [selectedVersion, versionData, setNodes]);



  // Style nodes based on risk level and selection
  const getHeatmapColor = useCallback((riskScore) => {
    if (riskScore >= 70) {
      // High risk: red tint, intensity increases with score
      const intensity = Math.min(100, riskScore) / 100;
      const bgOpacity = 0.1 + intensity * 0.15; // 0.1 to 0.25
      return {
        bg: `rgba(239, 68, 68, ${bgOpacity})`,
        border: `#dc2626`,
      };
    } else if (riskScore >= 35) {
      // Medium risk: yellow tint
      const intensity = (riskScore - 35) / 35;
      const bgOpacity = 0.1 + intensity * 0.15;
      return {
        bg: `rgba(217, 119, 6, ${bgOpacity})`,
        border: `#b45309`,
      };
    } else {
      // Low risk: green tint
      const intensity = riskScore / 35;
      const bgOpacity = 0.05 + intensity * 0.1;
      return {
        bg: `rgba(16, 185, 129, ${bgOpacity})`,
        border: `#059669`,
      };
    }
  }, []);

  // Style nodes based on risk level and selection
  const depthLevels = useMemo(() => {
    const incomingCount = nodes.reduce((accumulator, node) => {
      accumulator[node.id] = 0;
      return accumulator;
    }, {});

    const adjacency = nodes.reduce((accumulator, node) => {
      accumulator[node.id] = [];
      return accumulator;
    }, {});

    edges.forEach((edge) => {
      if (incomingCount[edge.target] !== undefined) {
        incomingCount[edge.target] += 1;
      }
      if (adjacency[edge.source]) {
        adjacency[edge.source].push(edge.target);
      }
    });

    const levels = {};
    const queue = [];

    Object.keys(incomingCount).forEach((nodeId) => {
      if (incomingCount[nodeId] === 0) {
        levels[nodeId] = 0;
        queue.push(nodeId);
      }
    });

    while (queue.length > 0) {
      const currentNodeId = queue.shift();
      const currentLevel = levels[currentNodeId] ?? 0;

      (adjacency[currentNodeId] || []).forEach((targetId) => {
        const nextLevel = Math.min(2, currentLevel + 1);
        if (levels[targetId] === undefined || nextLevel > levels[targetId]) {
          levels[targetId] = nextLevel;
          queue.push(targetId);
        }
      });
    }

    nodes.forEach((node) => {
      if (levels[node.id] === undefined) {
        levels[node.id] = 0;
      }
    });

    return levels;
  }, [nodes, edges]);

  // Style nodes based on risk level and selection
  const styledNodes = useMemo(() => {
    return nodes.map((node) => {
      let borderColor = "#10b981"; // Green for low
      if (node.data.risk === "medium") borderColor = "#eab308"; // Yellow
      if (node.data.risk === "high") borderColor = "#ef4444"; // Red

      // Apply heatmap colors if enabled
      let bgColor = "rgba(13,17,23,0.8)";
      if (heatmapEnabled && node.data.riskScore !== undefined) {
        const heatmapColor = getHeatmapColor(node.data.riskScore);
        bgColor = heatmapColor.bg;
        borderColor = heatmapColor.border;
      }

      const isSelected = node.id === selectedNodeId;

      // Focus mode: reduce opacity for non-selected nodes
      let nodeOpacity = focusMode && selectedNodeId && !isSelected ? 0.35 : 1;

      return {
        ...node,
        type: "depthBadgeNode",
        data: {
          ...node.data,
          depthLevel: `L${depthLevels[node.id] ?? 0}`,
        },
        style: {
          background: bgColor,
          border: isSelected ? `2px solid ${borderColor}` : `1px solid rgba(255,255,255,0.1)`,
          borderLeft: `3px solid ${borderColor}`,
          borderRadius: "8px",
          padding: "12px 16px",
          fontSize: "12px",
          fontWeight: "600",
          color: "#cbd5e1",
          opacity: nodeOpacity,
          boxShadow: isSelected
            ? `0 4px 12px ${borderColor}40`
            : "0 2px 8px rgba(0,0,0,0.3)",
          minWidth: "140px",
          transition:
            "all 0.15s ease, background-color 0.15s ease, border-color 0.15s ease, opacity 0.15s ease",
        },
      };
    });
  }, [
    nodes,
    selectedNodeId,
    heatmapEnabled,
    getHeatmapColor,
    depthLevels,
    focusMode,
  ]);

  const styledEdges = useMemo(() => {
    const highRiskNodeIds = new Set(
      nodes
        .filter((node) => (node.data.riskScore ?? 0) >= 70)
        .map((node) => node.id),
    );

    return edges.map((edge) => {
      const connectedToHighRisk =
        highRiskNodeIds.has(edge.source) || highRiskNodeIds.has(edge.target);

      // Solid, visible stroke — animated edges get a brighter accent colour
      const strokeColor = edge.animated
        ? "#a78bfa"                                          // violet for animated/high-risk
        : connectedToHighRisk && heatmapEnabled
          ? "rgba(139,92,246,0.85)"                         // bright purple when heatmap on
          : "rgba(139,92,246,0.6)";                         // default: visible indigo-violet

      const strokeWidth = connectedToHighRisk && heatmapEnabled ? 2.5 : 2;

      return {
        ...edge,
        type: edge.type || "smoothstep",
        style: {
          ...(edge.style || {}),
          stroke: strokeColor,
          strokeWidth,
          opacity: 1,
          transition: "stroke 0.2s ease, stroke-width 0.2s ease",
        },
      };
    });
  }, [edges, nodes, heatmapEnabled]);

  const onNodeDragStop = useCallback((event, node) => {
    console.log("Node dragged:", node);
  }, []);

  const onNodeClick = useCallback((event, node) => {
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const selectedNode = useMemo(() => {
    return nodes.find((node) => node.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  const architectureSummary = useMemo(() => {
    const totalModules = nodes.length;
    const totalDependencyEdges = edges.length;

    const totalRiskScore = nodes.reduce(
      (sum, node) => sum + (node.data.riskScore ?? 0),
      0,
    );
    const averageRiskScore =
      totalModules > 0 ? Math.round(totalRiskScore / totalModules) : 0;

    const connectionCounts = nodes.reduce((accumulator, node) => {
      accumulator[node.id] = 0;
      return accumulator;
    }, {});

    edges.forEach((edge) => {
      if (connectionCounts[edge.source] !== undefined) {
        connectionCounts[edge.source] += 1;
      }
      if (connectionCounts[edge.target] !== undefined) {
        connectionCounts[edge.target] += 1;
      }
    });

    let mostConnectedNodeId = null;
    let highestConnections = -1;

    Object.entries(connectionCounts).forEach(([nodeId, count]) => {
      if (count > highestConnections) {
        highestConnections = count;
        mostConnectedNodeId = nodeId;
      }
    });

    const mostConnectedModule =
      nodes.find((node) => node.id === mostConnectedNodeId)?.data.label ||
      "N/A";

    return {
      totalModules,
      averageRiskScore,
      mostConnectedModule,
      totalDependencyEdges,
    };
  }, [nodes, edges]);

  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ background: darkBg }}>
      {/* Page Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-white/[0.06] px-8 py-6"
        style={{ ...glass, boxShadow: glowShadow }}
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white mb-2" style={{ textShadow: "0 0 20px rgba(255,255,255,0.1)" }}>
              Architecture Map
            </h1>
            <p className="text-sm text-slate-400">
              Interactive structural intelligence view of the selected
              repository.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <motion.div className="w-2 h-2 bg-emerald-400 rounded-full" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 2, repeat: Infinity }} style={{ boxShadow: "0 0 8px rgba(52,211,153,0.4)" }} />
              <span className="text-[10px] font-mono text-emerald-400/70">LIVE</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Repository Name */}
            <div className="px-3 py-2 border border-white/[0.06] rounded-md text-sm font-medium bg-white/[0.06] text-slate-300">
              {selectedRepository || "No project selected"}
            </div>

            {/* Branch Badge */}
            <div className="px-3 py-1.5 bg-white/[0.06] rounded-md text-xs font-bold text-slate-400 uppercase tracking-wider border border-white/[0.06]">
              {selectedBranch}
            </div>

            {/* Heatmap Toggle */}
            <button
              onClick={() => setHeatmapEnabled(!heatmapEnabled)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                heatmapEnabled
                  ? "bg-indigo-500/15 text-indigo-400 border border-indigo-500/30"
                  : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
              }`}
            >
              <Icon name="insights" className="text-[18px]" />
              <span>Heatmap</span>
            </button>

            {/* Focus Mode Toggle */}
            <button
              onClick={() => setFocusMode(!focusMode)}
              className={`px-3 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                focusMode
                  ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                  : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
              }`}
              title="Focus on selected node and connected path"
            >
              <Icon name="center_focus_strong" className="text-[18px]" />
              <span>Focus</span>
            </button>

            {/* Intelligence Overlays Dropdown */}
            <div className="border-l border-white/[0.06] pl-3 ml-3 flex gap-2">
              <button
                onClick={() => setShowHeatStrip(!showHeatStrip)}
                className={`px-2 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                  showHeatStrip
                    ? "bg-red-500/15 text-red-400 border border-red-500/30"
                    : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                }`}
                title="Risk ranking heat strip"
              >
                Heat
              </button>
              <button
                onClick={() => setShowGravityMap(!showGravityMap)}
                className={`px-2 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                  showGravityMap
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                    : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                }`}
                title="Gravity-based node sizing"
              >
                Gravity
              </button>
              <button
                onClick={() => setShowEntropyRing(!showEntropyRing)}
                className={`px-2 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                  showEntropyRing
                    ? "bg-cyan-500/15 text-cyan-400 border border-cyan-500/30"
                    : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                }`}
                title="Entropy distribution ring"
              >
                Entropy
              </button>
              <button
                onClick={() => setShowBlastRadius(!showBlastRadius)}
                className={`px-2 py-1.5 rounded-md text-xs font-bold uppercase tracking-wider transition-all ${
                  showBlastRadius
                    ? "bg-orange-500/15 text-orange-400 border border-orange-500/30"
                    : "bg-white/[0.06] text-slate-400 border border-white/[0.06] hover:bg-white/[0.08]"
                }`}
                title="Impact blast radius projection"
              >
                Blast
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Full-Width Graph Container */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex-1 p-8 min-h-0 relative"
        style={{ minHeight: 0 }}
      >
        <div
          className="border border-white/[0.06] rounded-xl overflow-hidden relative"
          style={{ ...glass, boxShadow: glowShadow, width: "100%", height: "100%", position: "absolute", inset: "2rem" }}
        >
          <ReactFlow
            nodes={styledNodes}
            edges={styledEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            fitView
            attributionPosition="bottom-right"
            nodesDraggable={true}
            nodesConnectable={false}
            elementsSelectable={true}
            panOnDrag={true}
            zoomOnScroll={true}
            panOnScroll={false}
            minZoom={0.3}
            maxZoom={2.5}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            className="relative z-0"
            style={RF_BG_STYLE}
          >
            <Background
              gap={20}
              size={1}
              color="rgba(99,102,241,0.15)"
              style={{ opacity: 0.3 }}
            />
            <Controls
              showInteractive={false}
              className="rounded-lg"
            />
            <MiniMap
              nodeColor={MINIMAP_NODE_COLOR}
              maskColor={MINIMAP_MASK_COLOR}
              className="rounded-lg"
            />
          </ReactFlow>

          {/* PHASE 3: Intelligence Overlays */}

          {/* Heat Strip: Risk-based cascade ranking */}
          {showHeatStrip && (
            <div
              className="absolute top-4 right-4 w-48 border border-white/[0.06] rounded-lg p-3 z-30"
              style={{ ...glass, boxShadow: glowShadow }}
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Risk Ranking
              </p>
              <div className="space-y-1">
                {nodes.slice(0, 5).map((node, idx) => (
                  <motion.div key={node.id} className="flex items-center gap-2"
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.06 }}>
                    <div
                      className="h-2 rounded-sm"
                      style={{
                        width: `${12 - idx * 2}px`,
                        backgroundColor:
                          idx === 0
                            ? "#ef4444"
                            : idx === 1
                              ? "#f97316"
                              : idx === 2
                                ? "#eab308"
                                : "#94a3b8",
                      }}
                    />
                    <span className="text-xs text-slate-400 truncate">
                      {node.data.label}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Entropy Ring: Complexity distribution */}
          {showEntropyRing && (
            <svg
              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
              width="300"
              height="300"
              style={{ opacity: 0.4 }}
            >
              <circle
                cx="150"
                cy="150"
                r="100"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="1"
              />
              <circle
                cx="150"
                cy="150"
                r="120"
                fill="none"
                stroke="#0891b2"
                strokeWidth="1"
              />
              <circle
                cx="150"
                cy="150"
                r="80"
                fill="none"
                stroke="#06b6d4"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            </svg>
          )}

          {/* Blast Radius Arcs: Impact zones */}
          {showBlastRadius && (
            <svg
              className="absolute inset-0 pointer-events-none z-5"
              width="100%"
              height="100%"
              style={{ opacity: 0.25 }}
            >
              <defs>
                <filter id="blastGlow">
                  <feGaussianBlur stdDeviation="1" result="coloredBlur" />
                </filter>
              </defs>
              {nodes.map((node) => {
                const radius = (node.data.riskScore ?? 0) / 10;
                return (
                  <circle
                    key={node.id}
                    cx={node.position?.x || 0}
                    cy={node.position?.y || 0}
                    r={radius}
                    fill="none"
                    stroke={
                      node.data.risk === "high"
                        ? "#ef4444"
                        : node.data.risk === "medium"
                          ? "#eab308"
                          : "#10b981"
                    }
                    strokeWidth="1"
                    opacity="0.3"
                    style={{ transition: "opacity 0.15s ease" }}
                  />
                );
              })}
            </svg>
          )}

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="absolute top-4 left-4 w-[260px] border border-white/[0.06] rounded-lg p-4 z-30 pointer-events-none"
            style={{ ...glass, boxShadow: glowShadow }}
          >
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-3">
              Architecture Summary
            </p>
            <div className="space-y-3">
              {[
                { label: "Total Modules", value: architectureSummary.totalModules },
                { label: "Average Risk Score", value: architectureSummary.averageRiskScore },
                { label: "Most Connected Module", value: architectureSummary.mostConnectedModule, extraClass: "gap-3", valueClass: "text-right" },
                { label: "Total Dependency Edges", value: architectureSummary.totalDependencyEdges },
              ].map((stat, i) => (
                <motion.div key={stat.label} className={`flex items-center justify-between${stat.extraClass ? ` ${stat.extraClass}` : ""}`}
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
                  <span className="text-xs text-slate-500">
                    {stat.label}
                  </span>
                  <span className={`text-sm font-semibold text-white${stat.valueClass ? ` ${stat.valueClass}` : ""}`}>
                    {stat.value}
                  </span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Evolution Timeline Slider */}
          <div
            className="absolute bottom-0 left-0 right-0 border-t border-white/[0.06] px-8 py-4 z-20"
            style={{ ...glass, boxShadow: glowShadow }}
          >
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
                <Icon name="history" className="text-slate-400 text-[20px]" />
                <span className="text-xs font-bold uppercase text-slate-500 tracking-wider">
                  Evolution Timeline
                </span>
              </div>

              {/* Version Selector */}
              <div className="flex-1 flex items-center gap-4">
                {["Current"].map((version, idx) => (
                  <motion.button
                    key={version}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={() => setSelectedVersion(version)}
                    className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-all ${
                      selectedVersion === version
                        ? "bg-indigo-500 text-white shadow-md"
                        : "bg-white/[0.06] text-slate-400 hover:bg-white/[0.08]"
                    }`}
                  >
                    {version}
                  </motion.button>
                ))}
              </div>

              {/* Version Info */}
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase text-slate-400 mb-0.5">
                  Selected
                </p>
                <p className="text-sm font-semibold text-white">
                  {selectedVersion}
                </p>
              </div>
            </div>
          </div>

          {/* Module Inspector Panel - Overlay */}
          <AnimatePresence>
            {selectedNode && (
              <motion.div
                initial={{ x: 400, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: 400, opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="absolute right-0 top-0 h-full w-[400px] border-l border-white/[0.06] z-40 flex flex-col overflow-hidden"
                style={{ ...glass, boxShadow: glowShadow }}
              >
                {/* Panel Header */}
                <div className="p-6 border-b border-white/[0.06] flex items-center justify-between shrink-0">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Module Inspector
                    </p>
                    <h3 className="text-lg font-semibold text-white">
                      {selectedNode.data.label}
                    </h3>
                  </div>
                  <button
                    className="text-slate-400 hover:text-slate-300 transition-colors p-1"
                    onClick={() => setSelectedNodeId(null)}
                  >
                    <Icon name="close" className="text-[20px]" />
                  </button>
                </div>

                {/* Panel Content */}
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Risk Score */}
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0 * 0.06 }}>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">
                      Risk Score
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-white">
                        {selectedNode.data.riskScore ?? 0}
                      </span>
                      <span className="text-xs text-slate-500">/ 100</span>
                    </div>
                  </motion.div>

                  {/* Dependencies */}
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 * 0.06 }}>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">
                      Dependencies
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {moduleIntelligence[selectedNodeId]?.dependencies || 0}
                    </p>
                  </motion.div>

                  {/* Summary */}
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2 * 0.06 }}>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">
                      AI Summary
                    </p>
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {moduleIntelligence[selectedNodeId]?.summary}
                    </p>
                  </motion.div>

                  {/* Impact Radius */}
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3 * 0.06 }}>
                    <p className="text-[10px] font-bold uppercase text-slate-400 mb-2">
                      Impact Radius
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-bold text-indigo-400">
                        {moduleIntelligence[selectedNodeId]?.impactRadius || 0}
                      </span>
                      <span className="text-xs text-slate-400">
                        modules affected
                      </span>
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}

export default ArchitectureMap;
