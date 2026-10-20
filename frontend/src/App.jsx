import { useState, useCallback, useMemo, useEffect } from "react";
import ReactFlow, { Background, Controls, MiniMap, useNodesState, useEdgesState } from "reactflow";
import "reactflow/dist/style.css";
import axios from "axios";
import "./App.css";

// Sample Demo Data so users can test & preview all 4 views immediately
const DEMO_ARCHITECTURE_DATA = {
  architecture: {
    nodes: [
      {
        id: "frontend_ui",
        label: "React Web Dashboard",
        type: "frontend",
        confidence: "High",
        confidence_reason: "All 12 component files present and match React patterns.",
        description: "User facing interactive UI built with React and Vite.",
        files: ["src/App.jsx", "src/components/Header.jsx", "src/components/GraphView.jsx"],
        evidence: [{ file: "src/App.jsx", matched_purpose: "UI root component" }]
      },
      {
        id: "api_gateway",
        label: "API Gateway & Router",
        type: "service",
        confidence: "High",
        confidence_reason: "FastAPI main router verified on disk.",
        description: "Handles incoming HTTP REST API requests and CORS configuration.",
        files: ["backend/main.py", "backend/router.py"],
        evidence: [{ file: "backend/main.py", matched_purpose: "FastAPI App Entrypoint" }]
      },
      {
        id: "auth_service",
        label: "OAuth Auth Agent",
        type: "service",
        confidence: "Medium",
        confidence_reason: "Partial match. Missing OAuth provider callback setup.",
        description: "Manages JWT authentication and user session verification.",
        files: ["backend/agents/auth_agent.py"],
        missing_files: ["backend/config/oauth.json"],
        evidence: [{ file: "backend/agents/auth_agent.py", matched_purpose: "Auth logic" }]
      },
      {
        id: "architecture_agent",
        label: "Architecture Analyzer Agent",
        type: "backend",
        confidence: "High",
        confidence_reason: "Verified code modules match AI agent pipeline.",
        description: "Uses Gemini 3.6 Flash model to extract component graph relationships.",
        files: ["backend/agents/architecture_agent.py"],
        evidence: [{ file: "backend/agents/architecture_agent.py", matched_purpose: "Graph generator" }]
      },
      {
        id: "verification_agent",
        label: "Verification Scorer Agent",
        type: "backend",
        confidence: "Low",
        confidence_reason: "Low verification confidence. 2 of 3 specified helper files missing on disk.",
        description: "Validates architecture node files against actual disk contents.",
        files: ["backend/agents/verification_agent.py", "backend/utils/disk_checker.py", "backend/utils/ast_parser.py"],
        missing_files: ["backend/utils/disk_checker.py", "backend/utils/ast_parser.py"],
        evidence: [{ file: "backend/agents/verification_agent.py", matched_purpose: "Disk verification" }]
      },
      {
        id: "cache_store",
        label: "Redis Cache Store",
        type: "database",
        confidence: "Low",
        confidence_reason: "No active connection file or configuration found on disk.",
        description: "Caches frequent repository graph analysis results for instant load.",
        files: ["backend/cache/redis_client.py"],
        missing_files: ["backend/cache/redis_client.py"]
      },
      {
        id: "postgres_db",
        label: "PostgreSQL Database",
        type: "database",
        confidence: "High",
        confidence_reason: "Database migrations and schema definitions verified.",
        description: "Stores persistent user repository analysis history and metadata.",
        files: ["backend/db/schema.sql", "backend/db/models.py"],
        evidence: [{ file: "backend/db/schema.sql", matched_purpose: "DB Schema" }]
      },
      {
        id: "external_github",
        label: "GitHub REST & GraphQL API",
        type: "external",
        confidence: "Medium",
        confidence_reason: "External API integration verified via HTTP client, but API rate limits unhandled.",
        description: "Fetches repository file trees and raw code contents.",
        files: ["backend/repo_cloner.py"]
      },
      {
        id: "unconnected_utils",
        label: "Standalone Legacy Logger",
        type: "backend",
        confidence: "Medium",
        confidence_reason: "Utility script found, but no active component imports it.",
        description: "Isolated utility module for legacy logging.",
        files: ["backend/utils/legacy_logger.py"]
      }
    ],
    edges: [
      { from: "frontend_ui", to: "api_gateway", label: "Sends REST Requests" },
      { from: "api_gateway", to: "auth_service", label: "Verifies Auth Token" },
      { from: "api_gateway", to: "architecture_agent", label: "Dispatches Analysis Task" },
      { from: "architecture_agent", to: "verification_agent", label: "Passes Graph for Scoring" },
      { from: "api_gateway", to: "external_github", label: "Fetches Repository Files" },
      { from: "architecture_agent", to: "postgres_db", label: "Saves Graph Output" },
      { from: "architecture_agent", to: "cache_store", label: "Reads/Writes Cached Graph" }
    ]
  },
  tech_stack: { language: "Python / JavaScript", framework: "FastAPI / React" },
  code_analysis: { modules: [] },
  analysis: { apis: [] }
};

// Layer category helper
const getLayerCategory = (type = "") => {
  const t = type.toLowerCase();
  if (t.includes("front") || t.includes("ui") || t.includes("client") || t.includes("web") || t.includes("mobile")) {
    return { id: "frontend", name: "Frontend / UI Layer", order: 0, icon: "🌐", headerBg: "#2563eb" };
  }
  if (t.includes("api") || t.includes("service") || t.includes("gateway") || t.includes("router")) {
    return { id: "service", name: "Services & APIs Layer", order: 1, icon: "⚡", headerBg: "#7c3aed" };
  }
  if (t.includes("back") || t.includes("server") || t.includes("controller") || t.includes("core") || t.includes("agent")) {
    return { id: "backend", name: "Backend & Core Layer", order: 2, icon: "⚙️", headerBg: "#059669" };
  }
  if (t.includes("data") || t.includes("db") || t.includes("cache") || t.includes("store") || t.includes("sql") || t.includes("postgres")) {
    return { id: "database", name: "Database & Storage Layer", order: 3, icon: "💾", headerBg: "#d97706" };
  }
  return { id: "external", name: "External & Utilities Layer", order: 4, icon: "🔌", headerBg: "#4b5563" };
};

function App() {
  const [githubUrl, setGithubUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fullAnalysis, setFullAnalysis] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  // View Mode state: "component" | "dependency" | "confidence" | "layer"
  const [viewMode, setViewMode] = useState("component");

  // ReactFlow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  // QA state
  const [chatQuestion, setChatQuestion] = useState("");
  const [chatAnswer, setChatAnswer] = useState(null);
  const [chatLoading, setChatLoading] = useState(false);

  // Compute graph data based on architecture & viewMode
  const updateGraphForView = useCallback((analysisData, currentViewMode) => {
    if (!analysisData || !analysisData.architecture) return;

    const architecture = analysisData.architecture;
    const rawNodes = architecture.nodes || [];
    const rawEdges = architecture.edges || [];

    // Find nodes involved in relationships
    const connectedNodeIds = new Set();
    rawEdges.forEach((edge) => {
      if (edge.from) connectedNodeIds.add(edge.from);
      if (edge.to) connectedNodeIds.add(edge.to);
    });

    // Positions & styles per view mode
    let computedNodes = [];
    let computedEdges = [];

    // Prepare layer mapping if in layer view
    const layerGroups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
    if (currentViewMode === "layer") {
      rawNodes.forEach((node) => {
        const cat = getLayerCategory(node.type);
        layerGroups[cat.order].push(node);
      });
    }

    const colCountPerLayer = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };

    computedNodes = rawNodes.map((node, index) => {
      const isConnected = connectedNodeIds.has(node.id);
      const layerCat = getLayerCategory(node.type);
      const conf = node.confidence || "High";

      let position = { x: 0, y: 0 };
      let style = {};
      let customClass = "flow-node-card";
      let badgeTag = null;

      // 1. COMPONENT VIEW (Default Grid)
      if (currentViewMode === "component") {
        position = {
          x: (index % 3) * 360 + 40,
          y: Math.floor(index / 3) * 220 + 40,
        };
        style = {
          background: conf === "High" ? "#f0fdf4" : conf === "Medium" ? "#fffbeb" : "#fef2f2",
          border: conf === "High" ? "2px solid #22c55e" : conf === "Medium" ? "2px solid #f59e0b" : "2px solid #ef4444",
          borderRadius: "10px",
          width: 250,
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.08)",
          opacity: 1,
        };
        badgeTag = <span className={`badge badge-${conf.toLowerCase()}`}>{conf} Conf.</span>;
      }

      // 2. DEPENDENCY VIEW (Emphasize edges/relationships, de-emphasize standalone)
      else if (currentViewMode === "dependency") {
        position = {
          x: (index % 3) * 360 + 40,
          y: Math.floor(index / 3) * 220 + 40,
        };
        if (isConnected) {
          style = {
            background: "#ffffff",
            border: "3px solid #2563eb",
            borderRadius: "10px",
            width: 250,
            boxShadow: "0 0 14px rgba(37, 99, 235, 0.4)",
            opacity: 1,
          };
          customClass += " glow-blue";
          badgeTag = <span className="badge badge-connected">🔗 Connected ({rawEdges.filter(e => e.from === node.id || e.to === node.id).length} edges)</span>;
        } else {
          style = {
            background: "#f8fafc",
            border: "1.5px dashed #cbd5e1",
            borderRadius: "10px",
            width: 250,
            opacity: 0.35,
            filter: "grayscale(60%)",
          };
          badgeTag = <span className="badge badge-standalone">⚪ Standalone</span>;
        }
      }

      // 3. CONFIDENCE VIEW (Highlight Low/Medium confidence, dim High confidence)
      else if (currentViewMode === "confidence") {
        position = {
          x: (index % 3) * 360 + 40,
          y: Math.floor(index / 3) * 220 + 40,
        };

        if (conf === "Low") {
          style = {
            background: "#fef2f2",
            border: "3px solid #ef4444",
            borderRadius: "10px",
            width: 260,
            opacity: 1,
            boxShadow: "0 0 16px rgba(239, 68, 68, 0.5)",
          };
          customClass += " pulse-red-glow";
          badgeTag = <span className="badge badge-low">⚠️ LOW CONFIDENCE</span>;
        } else if (conf === "Medium") {
          style = {
            background: "#fffbeb",
            border: "2.5px solid #f59e0b",
            borderRadius: "10px",
            width: 250,
            opacity: 1,
            boxShadow: "0 0 10px rgba(245, 158, 11, 0.4)",
          };
          badgeTag = <span className="badge badge-medium">⚡ MEDIUM CONFIDENCE</span>;
        } else {
          // Dim high confidence nodes to highlight weak spots
          style = {
            background: "#f1f5f9",
            border: "1px solid #cbd5e1",
            borderRadius: "10px",
            width: 240,
            opacity: 0.3,
            filter: "grayscale(80%)",
          };
          badgeTag = <span className="badge badge-high">✓ Verified (High)</span>;
        }
      }

      // 4. LAYER VIEW (Grouped into separate horizontal rows by component type)
      else if (currentViewMode === "layer") {
        const order = layerCat.order;
        const colIndex = colCountPerLayer[order];
        colCountPerLayer[order] += 1;

        position = {
          x: 280 + colIndex * 320,
          y: 60 + order * 210,
        };

        style = {
          background: "#ffffff",
          border: `2px solid ${layerCat.headerBg}`,
          borderRadius: "10px",
          width: 250,
          boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
          opacity: 1,
        };
        badgeTag = <span className="badge badge-type">{layerCat.icon} {node.type}</span>;
      }

      return {
        id: node.id,
        data: {
          label: (
            <div className={customClass}>
              <div className="node-title">
                <span>{node.label}</span>
              </div>
              <div className="node-badge-row">
                {badgeTag}
                <span className="badge badge-type">{node.type}</span>
                <span style={{ fontSize: "10px", color: "#64748b" }}>📄 {node.files ? node.files.length : 0} files</span>
              </div>
              {node.description && <div className="node-desc">{node.description}</div>}
            </div>
          ),
          rawNode: node,
        },
        position,
        style,
      };
    });

    // If Layer View, inject decorative Layer Header backdrop cards on the left side
    if (currentViewMode === "layer") {
      const activeLayers = [
        { name: "Frontend Layer", icon: "🌐", order: 0, bg: "#2563eb" },
        { name: "Services & APIs", icon: "⚡", order: 1, bg: "#7c3aed" },
        { name: "Backend Layer", icon: "⚙️", order: 2, bg: "#059669" },
        { name: "Database & Storage", icon: "💾", order: 3, bg: "#d97706" },
        { name: "External Services", icon: "🔌", order: 4, bg: "#4b5563" },
      ];

      activeLayers.forEach((layer) => {
        if (layerGroups[layer.order].length > 0) {
          computedNodes.unshift({
            id: `layer-header-${layer.order}`,
            data: {
              label: (
                <div className="layer-header-card" style={{ background: layer.bg }}>
                  <span>{layer.icon}</span>
                  <span>{layer.name}</span>
                  <span style={{ marginLeft: "auto", fontSize: "11px", opacity: 0.9 }}>
                    ({layerGroups[layer.order].length})
                  </span>
                </div>
              ),
            },
            position: { x: 20, y: 60 + layer.order * 210 },
            selectable: false,
            draggable: false,
            style: { border: "none", background: "transparent", padding: 0 },
          });
        }
      });
    }

    // Edges configuration per mode
    computedEdges = rawEdges.map((edge, idx) => {
      let animated = true;
      let style = { stroke: "#94a3b8", strokeWidth: 2 };
      let labelStyle = { fill: "#334155", fontWeight: 600, fontSize: 11 };

      if (currentViewMode === "dependency") {
        style = { stroke: "#2563eb", strokeWidth: 3 };
        animated = true;
      } else if (currentViewMode === "confidence") {
        style = { stroke: "#cbd5e1", strokeWidth: 1.5 };
      } else if (currentViewMode === "layer") {
        style = { stroke: "#6366f1", strokeWidth: 2 };
      }

      return {
        id: `e-${idx}`,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated,
        style,
        labelStyle,
      };
    });

    setNodes(computedNodes);
    setEdges(computedEdges);
  }, [setNodes, setEdges]);

  // Handle View Mode switch
  const handleViewChange = (mode) => {
    setViewMode(mode);
    if (fullAnalysis) {
      updateGraphForView(fullAnalysis, mode);
    }
  };

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8003";

  // Analyze API Call
  const analyzeRepo = async () => {
    if (!githubUrl || !githubUrl.trim()) {
      setError("Please enter a GitHub repository URL to analyze.");
      return;
    }

    const trimmedUrl = githubUrl.trim();

    // If user attempts to analyze the fake demo URL, explain or redirect to sample repo
    if (trimmedUrl === "https://github.com/example/repoarchitect-demo") {
      setError("The demo URL is a sample preview. Please enter a real public GitHub repository URL (e.g. https://github.com/octocat/Hello-World) to run live AI analysis.");
      return;
    }

    setLoading(true);
    setError(null);
    setSelectedNode(null);
    setChatAnswer(null);

    try {
      const response = await axios.post(
        `${API_BASE_URL}/analyze`,
        { github_url: trimmedUrl },
        { timeout: 60000 }
      );

      if (!response.data || !response.data.architecture || !response.data.architecture.nodes) {
        setError("No architecture nodes returned from backend analysis.");
        setLoading(false);
        return;
      }

      setFullAnalysis(response.data);
      updateGraphForView(response.data, viewMode);
    } catch (err) {
      let errMsg = err.response?.data?.detail || err.message;
      if (err.code === "ECONNABORTED" || errMsg?.includes("timeout")) {
        errMsg = "Analysis request timed out. Please try again or analyze a smaller repository.";
      } else if (errMsg === "Network Error" || err.code === "ERR_NETWORK") {
        errMsg = `Network Error: Could not connect to backend server at ${API_BASE_URL}. Ensure the backend server is running.`;
      }
      setError(errMsg || "Failed to analyze repository.");
    } finally {
      setLoading(false);
    }
  };

  // Load Demo Data for Instant Interactive Testing
  const loadDemoData = () => {
    setLoading(false);
    setError(null);
    setSelectedNode(null);
    setGithubUrl("https://github.com/example/repoarchitect-demo");
    setFullAnalysis(DEMO_ARCHITECTURE_DATA);
    updateGraphForView(DEMO_ARCHITECTURE_DATA, viewMode);
  };

  // Auto load demo on initial load if no data exists
  useEffect(() => {
    if (!fullAnalysis) {
      loadDemoData();
    }
  }, []);

  // Sync graph whenever viewMode changes
  useEffect(() => {
    if (fullAnalysis) {
      updateGraphForView(fullAnalysis, viewMode);
    }
  }, [viewMode, fullAnalysis, updateGraphForView]);

  // Handle Node click
  const onNodeClick = useCallback((event, node) => {
    if (node.data && node.data.rawNode) {
      setSelectedNode(node.data.rawNode);
    }
  }, []);

  // Ask Question API Call
  const askQuestion = async () => {
    if (!fullAnalysis || !chatQuestion) return;
    setChatLoading(true);
    setChatAnswer(null);

    try {
      const response = await axios.post(`${API_BASE_URL}/ask`, {
        question: chatQuestion,
        tech_stack: fullAnalysis.tech_stack,
        code_analysis: fullAnalysis.code_analysis,
        analysis: fullAnalysis.analysis,
        architecture: fullAnalysis.architecture,
      });
      setChatAnswer(response.data);
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message;
      setChatAnswer({ answer: "Error: " + (errMsg || "Could not connect to backend.") });
    } finally {
      setChatLoading(false);
    }
  };

  // Summary numbers for current active view mode banner
  const viewSummaryText = useMemo(() => {
    if (!fullAnalysis || !fullAnalysis.architecture) return "";
    const nodesList = fullAnalysis.architecture.nodes || [];
    const edgesList = fullAnalysis.architecture.edges || [];

    if (viewMode === "component") {
      return `Component View: Displaying all ${nodesList.length} architecture nodes & ${edgesList.length} relationship edges.`;
    }
    if (viewMode === "dependency") {
      const connectedCount = nodesList.filter((n) =>
        edgesList.some((e) => e.from === n.id || e.to === n.id)
      ).length;
      const standaloneCount = nodesList.length - connectedCount;
      return `Dependency View: ${connectedCount} connected nodes & ${edgesList.length} dependency paths highlighted (${standaloneCount} standalone nodes de-emphasized).`;
    }
    if (viewMode === "confidence") {
      const lowCount = nodesList.filter((n) => n.confidence === "Low").length;
      const medCount = nodesList.filter((n) => n.confidence === "Medium").length;
      return `Confidence View: Spotlighting weak spots — ${lowCount} Low Confidence ⚠️ & ${medCount} Medium Confidence ⚡ nodes highlighted.`;
    }
    if (viewMode === "layer") {
      return `Layer View: System components grouped into 5 horizontal rows by architectural type (Frontend, Services, Backend, Database, External).`;
    }
    return "";
  }, [fullAnalysis, viewMode]);

  return (
    <div className="app-container">
      <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
        
        {/* Header */}
        <header className="app-header">
          <div className="app-title-group">
            <h1 className="app-logo">RepoArchitect AI</h1>
            <span style={{ fontSize: "11px", background: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: "12px", fontWeight: 600 }}>
              Architecture Views
            </span>
          </div>

          <div className="input-group">
            <input
              type="text"
              className="repo-input"
              placeholder="Enter GitHub Repo URL (e.g. https://github.com/facebook/react)"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
            />
            <button className="btn-primary" onClick={analyzeRepo} disabled={loading}>
              {loading ? "Analyzing..." : "Analyze Repo"}
            </button>
            <button className="btn-secondary" onClick={loadDemoData} title="Load sample architecture data">
              Load Demo
            </button>
          </div>
        </header>

        {error && (
          <div style={{ padding: "8px 20px", background: "#fef2f2", color: "#dc2626", fontSize: "13px", borderBottom: "1px solid #fee2e2" }}>
            ⚠️ {error}
          </div>
        )}

        {/* View Switcher Toolbar */}
        <div className="view-switcher-bar">
          <div className="view-tabs">
            <button
              className={`tab-btn ${viewMode === "component" ? "active" : ""}`}
              onClick={() => handleViewChange("component")}
            >
              🧩 Component View
            </button>
            <button
              className={`tab-btn ${viewMode === "dependency" ? "active" : ""}`}
              onClick={() => handleViewChange("dependency")}
            >
              🔗 Dependency View
            </button>
            <button
              className={`tab-btn ${viewMode === "confidence" ? "active" : ""}`}
              onClick={() => handleViewChange("confidence")}
            >
              ⚠️ Confidence View
            </button>
            <button
              className={`tab-btn ${viewMode === "layer" ? "active" : ""}`}
              onClick={() => handleViewChange("layer")}
            >
              🥞 Layer View
            </button>
          </div>

          <div className="view-banner">
            <span>ℹ️</span>
            <span>{viewSummaryText}</span>
          </div>
        </div>

        {/* Interactive ReactFlow Diagram Canvas */}
        <div style={{ flex: 1, position: "relative", background: "#f8fafc" }}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
          >
            <Background color="#cbd5e1" gap={16} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) => {
                if (n.id.startsWith("layer-header")) return "#334155";
                return "#3b82f6";
              }}
            />
          </ReactFlow>
        </div>

        {/* Ask the Architecture Section */}
        <div className="ask-section">
          <div style={{ fontSize: "13px", fontWeight: 600, color: "#334155", marginBottom: "6px" }}>
            💬 Ask the Architecture Agent
          </div>
          <div className="ask-input-group">
            <input
              type="text"
              className="ask-input"
              placeholder="e.g. Which component handles user authentication? Or how does data flow to the database?"
              value={chatQuestion}
              onChange={(e) => setChatQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askQuestion()}
            />
            <button className="btn-primary" onClick={askQuestion} disabled={chatLoading || !fullAnalysis}>
              {chatLoading ? "Thinking..." : "Ask"}
            </button>
          </div>

          {chatAnswer && (
            <div className="ask-answer-box">
              <strong>Answer:</strong> {chatAnswer.answer}
              {chatAnswer.referenced_files && chatAnswer.referenced_files.length > 0 && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#0284c7" }}>
                  📁 Referenced files: {chatAnswer.referenced_files.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Node Inspection Sidebar */}
      {selectedNode && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h3 className="sidebar-title">{selectedNode.label}</h3>
            <button className="close-btn" onClick={() => setSelectedNode(null)}>✕</button>
          </div>

          <div className="meta-item">
            <div className="meta-label">Component Type</div>
            <div className="meta-val" style={{ textTransform: "capitalize" }}>
              <span className="badge badge-type" style={{ fontSize: "12px" }}>{selectedNode.type}</span>
            </div>
          </div>

          <div className="meta-item">
            <div className="meta-label">Verification Confidence</div>
            <div className="meta-val">
              <span className={`badge badge-${(selectedNode.confidence || "High").toLowerCase()}`} style={{ fontSize: "12px" }}>
                {selectedNode.confidence || "High"} Confidence
              </span>
            </div>
            {selectedNode.confidence_reason && (
              <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                {selectedNode.confidence_reason}
              </p>
            )}
          </div>

          {selectedNode.description && (
            <div className="meta-item">
              <div className="meta-label">Role & Description</div>
              <div className="meta-val" style={{ fontSize: "13px", lineHeight: 1.4 }}>
                {selectedNode.description}
              </div>
            </div>
          )}

          <div className="meta-item">
            <div className="meta-label">Source Files ({selectedNode.files ? selectedNode.files.length : 0})</div>
            <ul className="file-list">
              {(selectedNode.files || []).map((file, i) => (
                <li key={i} className="file-item">
                  📄 {file}
                </li>
              ))}
            </ul>
          </div>

          {selectedNode.missing_files && selectedNode.missing_files.length > 0 && (
            <div className="meta-item">
              <div className="meta-label" style={{ color: "#dc2626" }}>⚠️ Missing Files on Disk</div>
              <ul className="file-list">
                {selectedNode.missing_files.map((file, i) => (
                  <li key={i} className="file-item" style={{ background: "#fef2f2", borderColor: "#fca5a5", color: "#991b1b" }}>
                    ❌ {file}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selectedNode.evidence && selectedNode.evidence.length > 0 && (
            <div className="meta-item">
              <div className="meta-label" style={{ color: "#166534" }}>✓ Verified Evidence</div>
              <div style={{ fontSize: "12px", color: "#475569" }}>
                {selectedNode.evidence.map((ev, i) => (
                  <div key={i} style={{ marginBottom: "4px", padding: "4px 8px", background: "#f0fdf4", borderRadius: "4px" }}>
                    <strong>{ev.file}</strong>: {ev.matched_purpose}
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

export default App;