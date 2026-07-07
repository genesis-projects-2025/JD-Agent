"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Send,
    Bot,
    User,
    Sparkles,
    Loader2,
    Database,
    ShieldAlert,
    Terminal,
    Target,
    HelpCircle,
    ArrowRight
} from "lucide-react";
import { getCookie, cookieKeys } from "@/lib/cookies";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Message {
    id: string;
    role: "user" | "model";
    content: string;
    timestamp: Date;
}

const SUGGESTED_QUERIES = [
    {
        title: "Employee Directory Info",
        desc: "List DIR05's reporting team members and their designation details.",
        query: "Which employees report to DIR05 (Dr. Bhanu Prasad) and what are their designations? Render as a table."
    },
    {
        title: "KRA Weights Check",
        desc: "Find any active performance goal frameworks that don't sum to 100%.",
        query: "Are there any employee KRA frameworks (in kra_kpi_sessions) where the total weights do not sum up to 100%? If so, list them."
    },
    {
        title: "Skills & Gaps Analysis",
        desc: "List employees in Quality Assurance with low skill ratings.",
        query: "Find employees in Quality Assurance who have skill ratings in their KRA sheets, and list their names and ratings."
    },
    {
        title: "Role Description Search",
        desc: "Search Pinecone vectors for tasks related to compliance audits.",
        query: "Perform a vector search for any JD tasks or performance goals related to 'external audits' or 'compliance'."
    }
];

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
                        <li key={idx} className="text-xs text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
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
                <div key={key} className="overflow-x-auto my-3 border border-slate-200 rounded-lg shadow-sm">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                        {tableHeader.length > 0 && (
                            <thead className="bg-slate-50 font-bold">
                                <tr>
                                    {tableHeader.map((h, i) => (
                                        <th key={i} className="px-4 py-2.5 text-left text-slate-650 font-semibold border-b border-slate-200" dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                        )}
                        <tbody className="divide-y divide-slate-150 bg-white">
                            {tableRows.map((row, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                                    {row.map((cell, i) => (
                                        <td key={i} className="px-4 py-2 text-slate-700 max-w-xs truncate" dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
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
            .replace(/`(.*?)`/g, '<code class="bg-slate-100 text-indigo-600 px-1.5 py-0.5 rounded font-mono text-[10px]">$1</code>');
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Table row
        if (line.startsWith('|')) {
            flushList(`list-before-table-${i}`);
            inTable = true;
            const cells = line.split('|').map(c => c.strip ? c.strip() : c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
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
                <h5 key={i} className="text-sm font-bold text-slate-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(3).trim()) }} />
            );
            continue;
        }
        if (line.startsWith('##')) {
            renderedElements.push(
                <h4 key={i} className="text-base font-bold text-slate-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(2).trim()) }} />
            );
            continue;
        }
        if (line.startsWith('#')) {
            renderedElements.push(
                <h3 key={i} className="text-lg font-bold text-slate-800 mt-4 mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line.substring(1).trim()) }} />
            );
            continue;
        }
        
        // Normal line
        if (line) {
            renderedElements.push(
                <p key={i} className="text-xs text-slate-700 leading-relaxed mb-2" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
            );
        }
    }
    
    flushList("list-final");
    flushTable("table-final");
    
    return <div className="space-y-1">{renderedElements}</div>;
}

export default function AdminBrainAgentPage() {
    const router = useRouter();
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "model",
            content: "Welcome to the Admin Brain Agent workspace. I have direct query capabilities over employee registries, reporting structures, JD sessions, and KRA/KPI performance frameworks.\n\nAsk me any question related to employees, hierarchy statistics, workflow targets, or semantic searches over job descriptions. I'll analyze the dataset and provide a detailed report.",
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const token = getCookie(cookieKeys.ADMIN_TOKEN);
        if (!token) {
            router.push("/admin/login");
        }
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    const handleSend = async (textToSend: string) => {
        const userMessage = textToSend.trim();
        if (!userMessage) return;

        setInput("");
        const newMessage: Message = {
            id: `msg-${Date.now()}`,
            role: "user",
            content: userMessage,
            timestamp: new Date()
        };
        setMessages(prev => [...prev, newMessage]);
        setLoading(true);

        try {
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
            
            // Format history for backend API context
            const history = messages.slice(1).map(m => ({
                role: m.role,
                content: m.content
            }));

            const res = await fetch(`${API_URL}/admin/brain-agent/chat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    message: userMessage,
                    history
                })
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || "Brain Agent is taking too long to reply.");
            }

            const data = await res.json();
            const botMessage: Message = {
                id: `msg-${Date.now() + 1}`,
                role: "model",
                content: data.reply,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, botMessage]);
        } catch (err: any) {
            console.error(err);
            const errorMessage: Message = {
                id: `msg-error-${Date.now()}`,
                role: "model",
                content: `⚠️ **Agent Execution Error**: ${err.message || "Failed to reach backend."}\n\nPlease check your server logs or try another query.`,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-[calc(100vh-8rem)] space-y-4">
            {/* Header section */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />
                        Admin Brain Agent
                    </h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Relational SQL + Vector Hybrid Intelligence Workspace (Admin-Only Access)
                    </p>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-1.5 text-[10px] font-bold text-indigo-700">
                    <Database className="w-3.5 h-3.5" />
                    Knowledge Base Active
                </div>
            </div>

            {/* Chat viewport / suggestions split */}
            <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
                {/* Chat Pane */}
                <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                    {/* Message Area */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                        {messages.map((m) => {
                            const isUser = m.role === "user";
                            return (
                                <div key={m.id} className={`flex gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                                    <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center border ${isUser ? "bg-indigo-600 text-white border-indigo-700" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                                        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4 text-indigo-500" />}
                                    </div>
                                    <div>
                                        <div className={`p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${isUser ? "bg-indigo-600 text-white rounded-tr-none" : "bg-slate-50/50 border border-slate-150 text-slate-800 rounded-tl-none"}`}>
                                            {isUser ? (
                                                <p className="whitespace-pre-wrap text-xs font-medium">{m.content}</p>
                                            ) : (
                                                <MarkdownRenderer content={m.content} />
                                            )}
                                        </div>
                                        <span className="block text-[9px] text-slate-400 mt-1 px-1 text-right">
                                            {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex gap-3 max-w-[80%] mr-auto">
                                <div className="w-8 h-8 rounded-lg shrink-0 flex items-center justify-center bg-slate-100 border border-slate-200">
                                    <Bot className="w-4 h-4 text-indigo-500" />
                                </div>
                                <div className="bg-slate-50/50 border border-slate-150 p-4 rounded-2xl rounded-tl-none shadow-sm flex items-center gap-3">
                                    <Loader2 className="w-4 h-4 text-indigo-600 animate-spin" />
                                    <span className="text-xs text-slate-500 font-medium animate-pulse">Running data analysis pipeline...</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input Bar */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSend(input);
                        }}
                        className="p-4 border-t border-slate-150 bg-slate-50/50 flex gap-3"
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading}
                            placeholder="Ask any question about employees, hierarchy statistics, or skill gaps..."
                            className="flex-1 px-4 py-3 bg-white border border-slate-250 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all shadow-inner disabled:opacity-50"
                        />
                        <button
                            type="submit"
                            disabled={loading || !input.trim()}
                            className="px-5 py-3 bg-indigo-600 hover:bg-indigo-750 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-100 disabled:opacity-50"
                        >
                            <Send className="w-4 h-4" />
                            Send
                        </button>
                    </form>
                </div>

                {/* Suggestions Pane */}
                <div className="w-full lg:w-80 shrink-0 space-y-4">
                    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                        <h3 className="text-sm font-bold text-slate-850 flex items-center gap-2">
                            <HelpCircle className="w-4 h-4 text-indigo-500" />
                            Suggested Templates
                        </h3>
                        <p className="text-[11px] text-slate-500 leading-relaxed">
                            Click any query below to run a direct analytical analysis over the corporate database and RAG model.
                        </p>
                        
                        <div className="space-y-3 pt-2">
                            {SUGGESTED_QUERIES.map((q, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(q.query)}
                                    disabled={loading}
                                    className="w-full text-left p-3.5 rounded-xl border border-slate-150 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all duration-200 group flex items-start justify-between gap-3 text-xs disabled:opacity-50"
                                >
                                    <div className="space-y-1">
                                        <div className="font-bold text-slate-800 group-hover:text-indigo-750 transition-colors">
                                            {q.title}
                                        </div>
                                        <div className="text-[10px] text-slate-450 leading-relaxed">
                                            {q.desc}
                                        </div>
                                    </div>
                                    <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 group-hover:translate-x-0.5 group-hover:text-indigo-600 transition-all self-center" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Security Notice */}
                    <div className="bg-slate-900 border border-slate-800 text-slate-400 rounded-2xl p-5 shadow-sm space-y-3">
                        <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                            Security Protocol
                        </h4>
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                            All database accesses are restricted to read-only `SELECT` queries on approved schemas. Alteration, modification, or exposure of authentication tables is prohibited.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
