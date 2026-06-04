import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { queryAgentsStream } from "../api";


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

// Quick prompt suggestions
const suggestions = [
  { icon: "api", label: "REST API Design", prompt: "Analyze a REST API built with Express and suggest improvements" },
  { icon: "bug_report", label: "Debug My Code", prompt: "Find bugs and issues in my authentication middleware" },
  { icon: "shield", label: "Security Review", prompt: "Review my login system for security vulnerabilities" },
  { icon: "speed", label: "Performance Tips", prompt: "How can I optimize my database queries for better performance?" },
  { icon: "account_tree", label: "Architecture Help", prompt: "What's the best architecture for a microservices backend?" },
  { icon: "school", label: "Explain Concepts", prompt: "Explain how JWT authentication works step by step" },
  { icon: "share", label: "Dependency Check", prompt: "Analyze the dependency structure of a Node.js project" },
  { icon: "history", label: "Code Evolution", prompt: "How should I plan version upgrades for my production app?" },
];

// Agent config for icons and colors
const agentConfig = {
  architecture: { icon: "account_tree", label: "Architecture Agent", color: "text-blue-400", bg: "bg-blue-500/15", border: "border-blue-500/30", accent: "bg-blue-600" },
  bug_detection: { icon: "bug_report", label: "Bug Detection Agent", color: "text-red-400", bg: "bg-red-500/15", border: "border-red-500/30", accent: "bg-red-600" },
  security: { icon: "shield", label: "Security Agent", color: "text-amber-400", bg: "bg-amber-500/15", border: "border-amber-500/30", accent: "bg-amber-600" },
  performance: { icon: "speed", label: "Performance Agent", color: "text-green-400", bg: "bg-green-500/15", border: "border-green-500/30", accent: "bg-green-600" },
  tutor: { icon: "school", label: "Tutor Agent", color: "text-violet-400", bg: "bg-violet-500/15", border: "border-violet-500/30", accent: "bg-violet-600" },
};

/**
 * Typewriter animation — reveals text progressively, like GPT streaming.
 * Only animates when first mounted with text. Skips animation for historical messages.
 */
function TypewriterText({ text, animate }) {
  const chunkSize = Math.max(1, Math.floor(text.length / 200));
  const [displayed, setDisplayed] = useState(animate ? "" : text);
  const [done, setDone] = useState(!animate);

  useEffect(() => {
    if (!text || !animate) return;
    setDisplayed("");
    setDone(false);
    let idx = 0;
    const id = setInterval(() => {
      idx = Math.min(idx + chunkSize, text.length);
      setDisplayed(text.slice(0, idx));
      if (idx >= text.length) { clearInterval(id); setDone(true); }
    }, 10);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return (
    <span className="whitespace-pre-wrap">
      {displayed}
      {!done && (
        <span className="inline-block w-px h-[1em] bg-slate-300 ml-0.5 align-text-bottom animate-pulse" />
      )}
    </span>
  );
}

function CodeAssistant() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [loadingStatus, setLoadingStatus] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const streamController = useRef(null);
  const agentCountRef = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (text) => {
    const input = (text || prompt).trim();
    if (!input || loading) return;

    const userMsg = { role: "user", content: input, timestamp: new Date().toISOString() };
    // Add user message + empty streaming assistant placeholder
    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", agents: [], streaming: true, timestamp: new Date().toISOString() },
    ]);
    setPrompt("");
    setLoading(true);
    agentCountRef.current = 0;
    setLoadingStatus("Agents analyzing...");

    const slowTimer = setTimeout(
      () => setLoadingStatus("Waking up server — this takes up to 30s..."),
      8000
    );

    const ctrl = queryAgentsStream(
      input,
      // onAgent — called for each agent as it finishes
      (agentResult) => {
        clearTimeout(slowTimer);
        agentCountRef.current += 1;
        setLoadingStatus(`${agentCountRef.current} / 5 agents analyzed...`);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { ...last, agents: [...last.agents, agentResult] };
          }
          return next;
        });
      },
      // onDone — all agents complete
      () => {
        clearTimeout(slowTimer);
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, streaming: false };
          }
          return next;
        });
        setLoading(false);
        setLoadingStatus("");
        inputRef.current?.focus();
      },
      // onError
      (err) => {
        clearTimeout(slowTimer);
        const msg =
          err.message === "Failed to fetch" || err.name === "AbortError"
            ? "Could not reach the server. It may be starting up — please try again in a moment."
            : err.message;
        setMessages((prev) => {
          // Replace the empty streaming placeholder with an error
          const next = prev.filter((m) => !(m.role === "assistant" && m.streaming));
          return [...next, { role: "error", content: msg, timestamp: new Date().toISOString() }];
        });
        setLoading(false);
        setLoadingStatus("");
      }
    );

    streamController.current = ctrl;
  };

  const toggleAgent = (msgIdx, agentName) => {
    const key = `${msgIdx}-${agentName}`;
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: darkBg }}>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-6">
        {messages.length === 0 ? (
          /* Welcome screen */
          <div className="max-w-3xl mx-auto mt-8">
            <div className="text-center mb-10">
              <div
                className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl flex items-center justify-center"
                style={{ boxShadow: "0 0 30px rgba(99,102,241,0.3), 0 6px 24px rgba(0,0,0,0.3)" }}
              >
                <Icon name="smart_toy" className="text-white text-3xl" />
              </div>
              <h2 className="text-2xl font-bold text-white" style={{ textShadow: "0 0 20px rgba(255,255,255,0.1)" }}>AI Query Console</h2>
              <p className="text-slate-500 mt-2">
                Ask anything — code reviews, architecture questions, security audits, performance tips.
                <br />
                <span className="text-slate-400 text-xs">5 specialized agents analyze every query in parallel.</span>
              </p>

            </div>

            {/* Agent badges */}
            <motion.div className="flex justify-center gap-2 mb-8 flex-wrap">
              {Object.entries(agentConfig).map(([key, cfg], idx) => (
                <motion.span
                  key={key}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.06 }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold ${cfg.bg} ${cfg.color} ${cfg.border} border`}
                >
                  <Icon name={cfg.icon} className="text-sm" />
                  {cfg.label.replace(" Agent", "")}
                </motion.span>
              ))}
            </motion.div>

            {/* Suggestion grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {suggestions.map((s, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onClick={() => handleSubmit(s.prompt)}
                  className="group flex flex-col items-center gap-2 p-4 rounded-xl border border-white/[0.06] hover:border-indigo-500/30 transition-all text-center cursor-pointer"
                  style={{ ...glass, boxShadow: glowShadow }}
                >
                  <Icon name={s.icon} className="text-2xl text-slate-500 group-hover:text-indigo-400 transition-colors" />
                  <span className="text-xs font-medium text-slate-400 group-hover:text-white">{s.label}</span>
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          /* Chat messages */
          <div className="max-w-4xl mx-auto space-y-6">
            <AnimatePresence>
              {messages.map((msg, idx) => (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {msg.role === "user" ? (
                    /* User message */
                    <div className="flex justify-end">
                      <div
                        className="max-w-xl bg-indigo-600 text-white px-5 py-3 rounded-2xl rounded-br-md shadow-sm"
                        style={{ boxShadow: "0 0 20px rgba(99,102,241,0.2)" }}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ) : msg.role === "error" ? (
                    /* Error */
                    <div className="flex justify-start">
                      <div
                        className="max-w-xl bg-red-500/15 border border-red-500/30 text-red-400 px-5 py-3 rounded-2xl rounded-bl-md"
                        style={{ boxShadow: "0 0 12px rgba(239,68,68,0.15)" }}
                      >
                        <p className="text-sm">{msg.content}</p>
                      </div>
                    </div>
                  ) : (
                    /* Agent responses */
                    <div className="space-y-3">
                      {msg.agents.map((agent, ai) => {
                        const cfg = agentConfig[agent.agent] || {};
                        const key = `${idx}-${agent.agent}`;
                        const isCollapsed = collapsed[key];
                        // animate text only for messages that were streamed in this session
                        const animateText = msg.streaming !== undefined;

                        return (
                          <motion.div
                            key={ai}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: ai * 0.08 }}
                            className={`rounded-xl border ${cfg.border || "border-white/[0.06]"} overflow-hidden shadow-sm`}
                            style={{ ...glass, boxShadow: glowShadow }}
                          >
                            {/* Agent header */}
                            <button
                              onClick={() => toggleAgent(idx, agent.agent)}
                              className={`w-full flex items-center gap-3 px-4 py-3 ${cfg.bg || "bg-white/[0.04]"} hover:brightness-95 transition-all`}
                              style={{ boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.04)" }}
                            >
                              <div className={`w-8 h-8 ${cfg.accent || "bg-slate-600"} rounded-lg flex items-center justify-center shrink-0`}>
                                <Icon name={cfg.icon || "smart_toy"} className="text-white text-base" />
                              </div>
                              <span className={`text-sm font-bold ${cfg.color || "text-slate-300"}`}>
                                {cfg.label || agent.agent}
                              </span>
                              <span className="ml-auto flex items-center gap-2">
                                <span
                                  className="text-[10px] font-semibold text-slate-500 bg-white/[0.06] px-2 py-0.5 rounded-full border border-white/[0.04]"
                                  style={{ boxShadow: "0 0 8px rgba(255,255,255,0.05)" }}
                                >
                                  {Math.round(agent.confidence * 100)}%
                                </span>
                                <Icon name={isCollapsed ? "expand_more" : "expand_less"} className="text-base text-slate-400" />
                              </span>
                            </button>

                            {/* Agent reply */}
                            <AnimatePresence>
                              {!isCollapsed && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="px-4 py-3 border-t border-white/[0.04]">
                                    <p className="text-sm text-slate-300 leading-relaxed">
                                      <TypewriterText text={agent.reply} animate={animateText} />
                                    </p>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Loading indicator */}
            {loading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-3 text-slate-500"
              >
                <div
                  className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center"
                  style={{ boxShadow: "0 0 20px rgba(99,102,241,0.3)" }}
                >
                  <Icon name="smart_toy" className="text-white text-base animate-pulse" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-sm">{loadingStatus || "5 agents analyzing"}</span>
                    <span className="flex gap-0.5 ml-1">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                    </span>
                  </div>
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-white/[0.06] px-4 sm:px-8 py-4" style={{ ...glass, boxShadow: glowShadow }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-end gap-3">
            <div className="flex-1 relative">
              <textarea
                id="assistant-prompt-input"
                name="assistant-prompt-input"
                ref={inputRef}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything — paste code, ask questions, request reviews..."
                rows={1}
                className="w-full px-4 py-3 pr-12 bg-white/[0.06] border border-white/[0.06] rounded-xl text-sm text-white placeholder:text-slate-500 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                style={{ minHeight: "48px", maxHeight: "160px" }}
              />
            </div>
            <button
              onClick={() => handleSubmit()}
              disabled={loading || !prompt.trim()}
              className="shrink-0 w-11 h-11 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-700 disabled:opacity-60 text-white rounded-xl flex items-center justify-center transition-colors shadow-sm"
              style={{ boxShadow: "0 0 12px rgba(99,102,241,0.3)" }}
            >
              <Icon name="send" className="text-xl" />
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2 text-center">
            Press Enter to send — 5 agents analyze in parallel.
          </p>
        </div>
      </div>
    </div>
  );
}

export default CodeAssistant;
