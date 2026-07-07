"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    Send,
    Bot,
    User,
    Loader2,
    Database,
    Terminal,
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
                <div key={key} className="overflow-x-auto my-3 border border-zinc-200 rounded-lg bg-white">
                    <table className="min-w-full divide-y divide-zinc-200 text-xs">
                        {tableHeader.length > 0 && (
                            <thead className="bg-zinc-50 font-bold">
                                <tr>
                                    {tableHeader.map((h, i) => (
                                        <th key={i} className="px-4 py-2.5 text-left text-zinc-600 font-semibold border-b border-zinc-200" dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                                    ))}
                                </tr>
                            </thead>
                        )}
                        <tbody className="divide-y divide-zinc-100 bg-white">
                            {tableRows.map((row, idx) => (
                                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-zinc-50/30"}>
                                    {row.map((cell, i) => (
                                        <td key={i} className="px-4 py-2 text-zinc-700 max-w-xs truncate" dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
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
            .replace(/`(.*?)`/g, '<code class="bg-zinc-100 text-zinc-800 px-1 py-0.5 rounded font-mono text-[10px]">$1</code>');
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
    const [messages, setMessages] = useState<Message[]>([
        {
            id: "welcome",
            role: "model",
            content: "System initialized. direct relational SQL queries and vector semantic searches are enabled.\n\nEnter a request to perform analytical database validation or fetch organizational job descriptions.",
            timestamp: new Date()
        }
    ]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [statusIndicator, setStatusIndicator] = useState<string | null>(null);
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
        setStatusIndicator("Initiating query analysis...");

        try {
            const token = getCookie(cookieKeys.ADMIN_TOKEN);
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

            const botMessageId = `msg-${Date.now() + 1}`;
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
                        if (parsed.type === "chunk") {
                            accumulatedContent += parsed.content;
                            setMessages(prev => prev.map(m => {
                                if (m.id === botMessageId) {
                                    return { ...m, content: accumulatedContent };
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
        <div className="flex flex-col h-[calc(100vh-8rem)] space-y-4 font-sans text-zinc-800">
            {/* Header section (Minimalistic) */}
            <div className="flex items-center justify-between border-b border-zinc-250 pb-4">
                <div>
                    <h1 className="text-lg font-semibold text-zinc-900 tracking-tight flex items-center gap-2">
                        Executive Intelligence Oracle
                    </h1>
                    <p className="text-[11px] text-zinc-500">
                        Read-only administrative directory & vector index client
                    </p>
                </div>
                <div className="flex items-center gap-1.5 bg-zinc-100 border border-zinc-200 rounded-lg px-2.5 py-1 text-[10px] text-zinc-600 font-medium">
                    <Database className="w-3 h-3 text-zinc-500" />
                    Knowledge Base Active
                </div>
            </div>

            {/* Split View */}
            <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
                {/* Chat Panel */}
                <div className="flex-1 flex flex-col bg-white border border-zinc-200 rounded-xl overflow-hidden">
                    {/* Viewport */}
                    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar bg-zinc-50/20">
                        {messages.map((m) => {
                            const isUser = m.role === "user";
                            return (
                                <div key={m.id} className={`flex gap-3 max-w-[85%] ${isUser ? "ml-auto flex-row-reverse" : "mr-auto"}`}>
                                    <div className={`w-7 h-7 rounded-lg shrink-0 flex items-center justify-center border text-[10px] font-bold ${isUser ? "bg-zinc-800 text-white border-zinc-900" : "bg-zinc-100 text-zinc-600 border-zinc-250"}`}>
                                        {isUser ? "AD" : "OC"}
                                    </div>
                                    <div>
                                        <div className={`p-3.5 rounded-lg text-xs leading-relaxed border ${isUser ? "bg-zinc-800 text-white border-zinc-900" : "bg-white border-zinc-200 text-zinc-850"}`}>
                                            {isUser ? (
                                                <p className="whitespace-pre-wrap font-medium">{m.content}</p>
                                            ) : (
                                                <MarkdownRenderer content={m.content} />
                                            )}
                                        </div>
                                        <span className="block text-[9px] text-zinc-400 mt-1 px-1">
                                            {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <div className="flex gap-3 max-w-[80%] mr-auto">
                                <div className="w-7 h-7 rounded-lg shrink-0 flex items-center justify-center bg-zinc-100 border border-zinc-250 text-[10px] font-bold text-zinc-600">
                                    OC
                                </div>
                                <div className="bg-white border border-zinc-200 p-3.5 rounded-lg flex items-center gap-2.5">
                                    <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin" />
                                    <span className="text-xs text-zinc-500 font-medium animate-pulse">{statusIndicator || "Analyzing context..."}</span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Minimal Input Bar */}
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            handleSend(input);
                        }}
                        className="p-3 border-t border-zinc-200 bg-zinc-50/50 flex gap-3"
                    >
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            disabled={loading}
                            placeholder="Enter administrative data query..."
                            className="flex-1 px-3.5 py-2.5 bg-white border border-zinc-250 rounded-lg text-xs text-zinc-800 placeholder-zinc-400 focus:outline-none focus:border-zinc-650 focus:ring-1 focus:ring-zinc-650 transition-all disabled:opacity-50"
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

                {/* Templates Panel (Minimalistic) */}
                <div className="w-full lg:w-72 shrink-0 space-y-4">
                    <div className="bg-white border border-zinc-200 rounded-xl p-4 space-y-3">
                        <h3 className="text-xs font-semibold text-zinc-900 flex items-center gap-1.5">
                            <HelpCircle className="w-3.5 h-3.5 text-zinc-500" />
                            Template Queries
                        </h3>
                        <p className="text-[10px] text-zinc-500 leading-normal">
                            Select a template query to evaluate organizational metrics or cross-reference performance goals.
                        </p>
                        
                        <div className="space-y-2 pt-1.5">
                            {SUGGESTED_QUERIES.map((q, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => handleSend(q.query)}
                                    disabled={loading}
                                    className="w-full text-left p-3 rounded-lg border border-zinc-200 hover:border-zinc-350 hover:bg-zinc-50/50 transition-all duration-150 group flex items-center justify-between gap-3 text-xs disabled:opacity-50"
                                >
                                    <div className="space-y-0.5">
                                        <div className="font-semibold text-zinc-800 group-hover:text-zinc-950 transition-colors">
                                            {q.title}
                                        </div>
                                        <div className="text-[9px] text-zinc-450 leading-relaxed">
                                            {q.desc}
                                        </div>
                                    </div>
                                    <ArrowRight className="w-3 h-3 text-zinc-400 shrink-0 group-hover:translate-x-0.5 group-hover:text-zinc-700 transition-all" />
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Notice Block */}
                    <div className="bg-zinc-900 border border-zinc-950 text-zinc-450 rounded-xl p-4 space-y-1.5">
                        <h4 className="text-[11px] font-semibold text-white flex items-center gap-1.5">
                            <Terminal className="w-3 h-3 text-zinc-450" />
                            Read-Only Protocol
                        </h4>
                        <p className="text-[9px] text-zinc-400 leading-normal">
                            All operations are executed within a secured read-only SELECT context. Schemas and system configurations cannot be altered.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
