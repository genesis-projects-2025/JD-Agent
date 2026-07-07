"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Send,
    Bot,
    User,
    Loader2,
    Database,
    Terminal,
    HelpCircle,
    ArrowRight,
    Download,
    Trash2,
    MessageSquare,
    Plus,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    BarChart3
} from "lucide-react";
import { getCookie, cookieKeys } from "@/lib/cookies";
import {
    fetchBrainAgentSessions,
    fetchBrainAgentSessionTurns,
    deleteBrainAgentSession,
    exportBrainAgentCSV,
    BrainAgentSession
} from "@/lib/api";
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer
} from "recharts";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
    id: string;
    role: "user" | "model";
    content: string;
    timestamp: Date;
    sqlQuery?: string; // Cache SQL query if executed in this turn
}

const SUGGESTED_QUERIES = [
    {
        title: "Employee Directory",
        desc: "Query reports under Director DIR05.",
        query: "Which employees report to DIR05 (Dr. Bhanu Prasad) and what are their designations? Render as a table."
    },
    {
        title: "KPI Weight Audits",
        desc: "Identify framework weights deviating from 100%.",
        query: "Are there any employee KRA frameworks (in kra_kpi_sessions) where the total weights do not sum up to 100%? If so, list them."
    },
    {
        title: "Skill Competency Ratings",
        desc: "List employee ratings within Quality Assurance.",
        query: "Find employees in Quality Assurance who have skill ratings in their KRA sheets, and list their names and ratings."
    },
    {
        title: "Compliance Goal Search",
        desc: "Locate tasks matching audit goals in Pinecone.",
        query: "Perform a vector search for any JD tasks or performance goals related to 'external audits' or 'compliance'."
    }
];

function MarkdownTableWithChart({ headers, rows }: { headers: string[]; rows: string[][] }) {
    const [viewMode, setViewMode] = useState<"table" | "chart">("table");

    const isChartReady = useMemo(() => {
        if (rows.length < 1 || headers.length < 2) return false;
        // Check if the second column contains numeric data
        let numericCount = 0;
        for (const row of rows) {
            const rawVal = row[1]?.replace(/[%,]/g, "")?.trim();
            const val = parseFloat(rawVal);
            if (!isNaN(val)) numericCount++;
        }
        return numericCount >= rows.length * 0.8;
    }, [headers, rows]);

    const chartData = useMemo(() => {
        if (!isChartReady) return [];
        return rows.map(row => {
            const rawVal = row[1]?.replace(/[%,]/g, "")?.trim();
            const val = parseFloat(rawVal);
            return {
                name: row[0] || "Unknown",
                [headers[1] || "Value"]: isNaN(val) ? 0 : val
            };
        });
    }, [isChartReady, headers, rows]);

    if (headers.length === 0 && rows.length === 0) return null;

    return (
        <div className="my-3 border border-zinc-200 rounded-lg bg-white p-3 space-y-2">
            {isChartReady && (
                <div className="flex justify-between items-center border-b border-zinc-150 pb-2">
                    <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">Visualization Mode</span>
                    <div className="flex gap-1">
                        <button
                            onClick={() => setViewMode("table")}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${viewMode === "table" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-650 hover:bg-zinc-200"}`}
                        >
                            Table
                        </button>
                        <button
                            onClick={() => setViewMode("chart")}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all ${viewMode === "chart" ? "bg-zinc-800 text-white" : "bg-zinc-100 text-zinc-650 hover:bg-zinc-200"}`}
                        >
                            Chart
                        </button>
                    </div>
                </div>
            )}

            {viewMode === "table" ? (
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-zinc-200 text-xs">
                        {headers.length > 0 && (
                            <thead className="bg-zinc-50 font-bold">
                                <tr>
                                    {headers.map((h, i) => (
                                        <th key={i} className="px-4 py-2.5 text-left text-zinc-600 font-semibold border-b border-zinc-200">
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                        )}
                        <tbody className="divide-y divide-zinc-100 bg-white">
                            {rows.map((row, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-zinc-50/30"}>
                                    {row.map((cell, i) => (
                                        <td key={i} className="px-4 py-2 text-zinc-700 max-w-xs truncate">
                                            {cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div className="h-48 w-full py-1">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e4e4e7" />
                            <XAxis dataKey="name" tick={{ fontSize: 8 }} stroke="#71717a" />
                            <YAxis tick={{ fontSize: 8 }} stroke="#71717a" />
                            <Tooltip contentStyle={{ fontSize: 9, borderRadius: 6, borderColor: "#e4e4e7" }} />
                            <Bar dataKey={headers[1] || "Value"} fill="#3f3f46" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}
        </div>
    );
}

function MarkdownRenderer({ content }: { content: string }) {
    const lines = content.split('\n');
    const renderedElements: React.ReactNode[] = [];
    
    let inList = false;
    let listItems: string[] = [];
    let inTable = false;
    let tableHeader: string[] = [];
    let tableRows: string[][] = [];
    
    const flushList = (key: string) => {
        if (listItems.length > 0) {
            renderedElements.push(
                <ul key={key} className="list-disc pl-5 my-2 space-y-1">
                    {listItems.map((item, idx) => (
                        <li key={idx} className="text-xs text-zinc-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
                    ))}
                </ul>
            );
            listItems = [];
        }
        inList = false;
    };
    
    const flushTable = (key: string) => {
        if (tableRows.length > 0 || tableHeader.length > 0) {
            renderedElements.push(
                <MarkdownTableWithChart key={key} headers={tableHeader} rows={tableRows} />
            );
            tableHeader = [];
            tableRows = [];
        }
        inTable = false;
    };

    const formatInline = (text: string): string => {
        return text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code class="bg-zinc-100 text-zinc-800 px-1 py-0.5 rounded font-mono text-[10px]">$1</code>');
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Table row
        if (line.startsWith('|')) {
            flushList(`list-before-table-${i}`);
            inTable = true;
            const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
            if (line.includes('---')) {
                continue;
            }
            if (tableHeader.length === 0 && tableRows.length === 0) {
                tableHeader = cells;
            } else {
                tableRows.push(cells);
            }
            continue;
        }
        
        if (inTable && !line.startsWith('|')) {
            flushTable(`table-end-${i}`);
        }
        
        // List item
        if (line.startsWith('-') || line.startsWith('*')) {
            inList = true;
            listItems.push(line.substring(1).trim());
            continue;
        }
        
        if (inList && !line.startsWith('-') && !line.startsWith('*')) {
            flushList(`list-end-${i}`);
        }
        
        // Headers
        if (line.startsWith('###')) {
            renderedElements.push(
                <h5 key={i} className="text-sm font-bold text-zinc-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(3).trim()) }} />
            );
            continue;
        }
        if (line.startsWith('##')) {
            renderedElements.push(
                <h4 key={i} className="text-base font-bold text-zinc-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2).trim()) }} />
            );
            continue;
        }
        if (line.startsWith('#')) {
            renderedElements.push(
                <h3 key={i} className="text-lg font-bold text-zinc-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(1).trim()) }} />
            );
            continue;
        }
        
        // Normal line
        if (line) {
            renderedElements.push(
                <p key={i} className="text-xs text-zinc-700 leading-relaxed mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
            );
        }
    }
    
    flushList("list-final");
    flushTable("table-final");
    
    return <div className="space-y-1">{renderedElements}</div>;
}

export default function AdminBrainAgentPage() {
    const router = useRouter();
    const [sessions, setSessions] = useState<BrainAgentSession[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "model",
            content: "System initialized. Direct relational SQL queries and vector semantic searches are enabled.\n\nEnter a request to perform analytical database validation or fetch organizational job descriptions.",
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusIndicator, setStatusIndicator] = useState<string | null>(null);
    const [anomalies, setAnomalies] = useState<string[]>([]);
    const [anomalyOpen, setAnomalyOpen] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Fetch session list
    const loadSessionsList = async () => {
        try {
            const list = await fetchBrainAgentSessions();
            setSessions(list);
        } catch (err) {
            console.error("Failed to load sessions:", err);
        }
    };

    useEffect(() => {
        const token = getCookie(cookieKeys.ADMIN_TOKEN);
        if (!token) {
            router.push("/admin/login");
            return;
        }
        loadSessionsList();
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // Load past session turns
    const handleSelectSession = async (sessionId: string) => {
        setSelectedSessionId(sessionId);
        setLoading(true);
        setAnomalies([]);
        try {
            const turns = await fetchBrainAgentSessionTurns(sessionId);
            const mappedMessages: Message[] = turns.map(t => {
                // Find associated SQL query if present in tool calls metadata
                const sqlCall = t.tool_calls?.find((tc: any) => tc.tool === "execute_sql");
                return {
                    id: `turn-${t.id}`,
                    role: t.role === "assistant" ? "model" : "user",
                    content: t.content,
                    timestamp: new Date(t.created_at),
                    sqlQuery: sqlCall?.query
                };
            });
            
            // Check if first message contains anomaly context
            if (mappedMessages.length > 0 && mappedMessages[0].role === "model") {
                extractAnomaliesFromContent(mappedMessages[0].content);
            }

            setMessages(mappedMessages.length > 0 ? mappedMessages : [
                {
                    id: "welcome",
                    role: "model",
                    content: "Conversation session reloaded.",
                    timestamp: new Date()
                }
            ]);
        } catch (err: any) {
            console.error(err);
            alert("Failed to reload session.");
        } finally {
            setLoading(false);
        }
    };

    // Extract anomalies from diagnostic context
    const extractAnomaliesFromContent = (content: string) => {
        if (content.includes("PROACTIVE DIAGNOSTIC REPORT")) {
            const lines = content.split("\n");
            const diagList = lines.filter(l => l.trim().startsWith("- [") && l.includes("]"));
            if (diagList.length > 0) {
                setAnomalies(diagList.map(d => d.replace(/^-\s*/, "")));
                setAnomalyOpen(true);
            }
        }
    };

    // Handle delete session
    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        if (!confirm("Are you sure you want to delete this session?")) return;

        try {
            await deleteBrainAgentSession(sessionId);
            loadSessionsList();
            if (selectedSessionId === sessionId) {
                handleNewChat();
            }
        } catch (err) {
            console.error(err);
            alert("Delete failed.");
        }
    };

    // Reset chat workspace
    const handleNewChat = () => {
        setSelectedSessionId(null);
        setAnomalies([]);
        setMessages([
            {
                id: "welcome",
                role: "model",
                content: "System initialized. Direct relational SQL queries and vector semantic searches are enabled.\n\nEnter a request to perform analytical database validation or fetch organizational job descriptions.",
                timestamp: new Date()
            }
        ]);
    };

    // Export CSV
    const handleExportCSV = async (query: string) => {
        try {
            const blob = await exportBrainAgentCSV(query);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `brain_agent_export_${Date.now()}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (err: any) {
            alert(`CSV Export failed: ${err.message}`);
        }
    };

    const handleSend = async (textToSend: string) => {
        const userMessage = textToSend.trim();
        if (!userMessage) return;

        setInput("");
        const userMsgObj: Message = {
            id: `msg-user-${Date.now()}`,
            role: "user",
            content: userMessage,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, userMsgObj]);
        setLoading(true);
        setStatusIndicator("Initiating query analysis...");

        let tempSessionId = selectedSessionId;
        let lastSql: string | undefined = undefined;

        try {
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            // Collect relative history
            const history = messages.slice(1).map(m => ({
                role: m.role,
                content: m.content
            }));

            const response = await fetch(`${API_URL}/admin/brain-agent/chat/stream`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: userMessage,
                    session_id: tempSessionId,
                    history
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || "Connection failed.");
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            if (!reader) return;

            const botMessageId = `msg-model-${Date.now()}`;
            setMessages(prev => [...prev, {
                id: botMessageId,
                role: "model",
                content: "",
                timestamp: new Date()
            }]);

            let accumulatedContent = "";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";

                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine.startsWith("data: ")) continue;

                    const jsonStr = cleanLine.substring(6);
                    try {
                        const parsed = JSON.parse(jsonStr);
                        if (parsed.type === "session") {
                            tempSessionId = parsed.session_id;
                            setSelectedSessionId(parsed.session_id);
                            loadSessionsList(); // Refresh session list
                        } else if (parsed.type === "tool_call" && parsed.tool === "execute_sql") {
                            lastSql = parsed.query;
                        } else if (parsed.type === "chunk") {
                            accumulatedContent += parsed.content;
                            setMessages(prev => prev.map(m => {
                                if (m.id === botMessageId) {
                                    return {
                                        ...m,
                                        content: accumulatedContent,
                                        sqlQuery: lastSql || m.sqlQuery
                                    };
                                }
                                return m;
                            }));
                        } else if (parsed.type === "status") {
                            setStatusIndicator(parsed.content);
                        }
                    } catch (e) {
                        console.warn("Chunk parse error:", e);
                    }
                }
            }

            // Extract anomalies if this was a diagnostic first load
            extractAnomaliesFromContent(accumulatedContent);

        } catch (err: any) {
            console.error(err);
            const errorMessage: Message = {
                id: `msg-error-${Date.now()}`,
                role: "model",
                content: `Error: ${err.message || "Failed to retrieve reply."}`,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
            setStatusIndicator(null);
        }
    };

    return (
        <div className="flex h-[calc(100vh-8rem)] gap-6 font-sans text-zinc-800 bg-zinc-50/30 p-2">
            
            {/* Sidebar List (Left Panel) */}
            <div className="w-64 border border-zinc-200 rounded-xl bg-white flex flex-col overflow-hidden shrink-0">
                <div className="p-3 border-b border-zinc-150 flex justify-between items-center bg-zinc-50/50">
                    <span className="text-xs font-bold text-zinc-900 tracking-tight flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-zinc-650" />
                        Sessions History
                    </span>
                    <button
                        onClick={handleNewChat}
                        disabled={loading}
                        className="p-1 rounded-md border border-zinc-200 bg-white hover:bg-zinc-50 transition-colors disabled:opacity-50"
                        title="New Conversation"
                    >
                        <Plus className="w-3.5 h-3.5 text-zinc-700" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {sessions.length === 0 ? (
                        <div className="text-center py-8 text-[10px] text-zinc-400">
                            No past sessions found.
                        </div>
                    ) : (
                        sessions.map((s) => {
                            const isSelected = selectedSessionId === s.id;
                            return (
                                <div
                                    key={s.id}
                                    onClick={() => !loading && handleSelectSession(s.id)}
                                    className={`w-full group flex items-center justify-between p-2 rounded-lg text-left text-xs cursor-pointer border transition-all ${
                                        isSelected
                                            ? "bg-zinc-800 text-white border-zinc-900"
                                            : "bg-white text-zinc-650 border-zinc-100 hover:bg-zinc-50/50 hover:border-zinc-200"
                                    }`}
                                >
                                    <div className="flex-1 truncate mr-2">
                                        <div className="font-semibold truncate">{s.title || "Untitled Chat"}</div>
                                        <div className={`text-[9px] mt-0.5 ${isSelected ? "text-zinc-400" : "text-zinc-400"}`}>
                                            {new Date(s.updated_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => handleDeleteSession(e, s.id)}
                                        disabled={loading}
                                        className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-200/50 transition-all ${
                                            isSelected ? "text-zinc-400 hover:text-white" : "text-zinc-400 hover:text-zinc-700"
                                        }`}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Chat Workspace (Right Panel) */}
            <div className="flex-1 flex flex-col min-w-0 bg-white border border-zinc-250 rounded-xl overflow-hidden shadow-sm">
                
                {/* Header */}
                <div className="p-4 border-b border-zinc-150 flex items-center justify-between bg-zinc-50/30">
                    <div>
                        <h1 className="text-sm font-bold text-zinc-950 flex items-center gap-1.5">
                            Executive Intelligence Oracle
                        </h1>
                        <p className="text-[10px] text-zinc-500">
                            Relational SQL schemas & Pinecone vector knowledge base client
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 bg-zinc-100 border border-zinc-200 rounded-lg px-2 py-1 text-[10px] text-zinc-650 font-semibold shadow-2xs">
                        <Database className="w-3 h-3 text-zinc-500" />
                        Knowledge Base Active
                    </div>
                </div>

                {/* Collapsible Anomaly Alert Banner */}
                {anomalies.length > 0 && (
                    <div className="mx-4 mt-3 border border-amber-200 bg-amber-50/40 rounded-lg overflow-hidden transition-all duration-150">
                        <button
                            onClick={() => setAnomalyOpen(!anomalyOpen)}
                            className="w-full px-3 py-2 flex items-center justify-between text-xs text-amber-800 font-semibold hover:bg-amber-100/10 transition-colors"
                        >
                            <span className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                                Proactive Diagnostic Notice: {anomalies.length} issue(s) detected in database
                            </span>
                            {anomalyOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {anomalyOpen && (
                            <div className="p-3 border-t border-amber-100 text-[10px] text-amber-750 space-y-1.5 bg-white">
                                {anomalies.map((an, i) => (
                                    <div key={i} className="flex gap-2 items-start leading-relaxed">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1 shrink-0" />
                                        <div dangerouslySetInnerHTML={{ __html: an }} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Messages feed */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-zinc-50/20">
                    {messages.map((m) => {
                        const isUser = m.role === "user";
                        return (
                            <div key={m.id} className={`flex gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                                <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border text-[10px] font-bold ${isUser ? "bg-zinc-800 text-white border-zinc-900" : "bg-white text-zinc-650 border-zinc-200"}`}>
                                    {isUser ? "AD" : "OC"}
                                </div>
                                <div className="space-y-1">
                                    <div className={`p-3.5 rounded-lg text-xs leading-relaxed border ${isUser ? "bg-zinc-800 text-white border-zinc-900 shadow-sm" : "bg-white border-zinc-200 text-zinc-850 shadow-2xs"}`}>
                                        {isUser ? (
                                            <p className="whitespace-pre-wrap font-medium">{m.content}</p>
                                        ) : (
                                            <MarkdownRenderer content={m.content} />
                                        )}
                                    </div>
                                    <div className="flex justify-between items-center px-1">
                                        <span className="text-[9px] text-zinc-400">
                                            {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                        {!isUser && m.sqlQuery && (
                                            <button
                                                onClick={() => handleExportCSV(m.sqlQuery!)}
                                                className="text-[9px] text-zinc-500 hover:text-zinc-800 font-bold flex items-center gap-1 mt-0.5 transition-colors"
                                                title="Download query output as CSV"
                                            >
                                                <Download className="w-2.5 h-2.5" />
                                                Export CSV
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {loading && (
                        <div className="flex gap-3 max-w-[80%] mr-auto">
                            <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center bg-white border border-zinc-200 text-[10px] font-bold text-zinc-650">
                                OC
                            </div>
                            <div className="bg-white border border-zinc-200 p-3.5 rounded-lg flex items-center gap-2.5 shadow-2xs">
                                <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                                <span className="text-xs text-zinc-550 font-medium animate-pulse">{statusIndicator || "Analyzing context..."}</span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Query Input Box */}
                <div className="p-4 border-t border-zinc-150 bg-zinc-50/50 flex flex-col gap-3">
                    {/* Suggestions (Horizontal list) */}
                    {messages.length <= 1 && !loading && (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-1">
                            {SUGGESTED_QUERIES.map((q, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(q.query)}
                                    disabled={loading}
                                    className="text-left p-3 rounded-lg border border-zinc-200 bg-white hover:border-zinc-350 hover:bg-zinc-50/50 transition-all duration-150 group flex flex-col justify-between gap-1 text-xs disabled:opacity-50"
                                >
                                    <span className="font-semibold text-zinc-850 group-hover:text-zinc-950 flex items-center justify-between w-full">
                                        {q.title}
                                        <ArrowRight className="w-3 h-3 text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                                    </span>
                                    <span className="text-[9px] text-zinc-450 leading-relaxed font-normal">{q.desc}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSend(input);
                        }}
                        className="flex gap-3"
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading}
                            placeholder={loading ? "Generating agent intelligence report..." : "Ask administrative directory or goal analysis queries..."}
                            className="flex-1 px-3.5 py-2.5 bg-white border border-zinc-250 rounded-lg text-xs text-zinc-850 placeholder-zinc-400 focus:outline-none focus:border-zinc-550 focus:ring-1 focus:ring-zinc-550 transition-all disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="px-4 py-2.5 bg-zinc-900 hover:bg-zinc-850 text-white border border-zinc-950 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                            <Send className="w-3.5 h-3.5" />
                            Run
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
