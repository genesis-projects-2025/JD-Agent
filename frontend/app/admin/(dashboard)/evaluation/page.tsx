"use client";

import React, { useState, useEffect } from "react";
import {
    Activity,
    Coins,
    Cpu,
    Clock,
    Search,
    Filter,
    RefreshCw,
    Layers,
    Database,
    Zap,
    TrendingUp,
    BarChart3,
    ArrowUpRight,
    CheckCircle2,
    Sliders,
    X,
    FileText
} from "lucide-react";

interface EvaluationStats {
    period_days: number;
    summary: {
        total_prompt_tokens: number;
        total_completion_tokens: number;
        total_tokens: number;
        total_cost_usd: number;
        total_cost_inr: number;
        total_llm_calls: number;
        avg_latency_ms: number;
        total_sessions: number;
        avg_tokens_per_session: number;
    };
    today: {
        total_tokens: number;
        total_cost_inr: number;
        total_calls: number;
    };
    breakdown_by_agent: Array<{
        agent_name: string;
        call_count: number;
        tokens: number;
        cost_inr: number;
    }>;
    breakdown_by_call_type: Array<{
        call_type: string;
        call_count: number;
        tokens: number;
        cost_inr: number;
    }>;
    breakdown_by_model: Array<{
        model_name: string;
        call_count: number;
        tokens: number;
        cost_inr: number;
    }>;
}

interface LLMTokenLogRow {
    id: string;
    session_id?: string;
    employee_id?: string;
    employee_name?: string;
    agent_name: string;
    call_type: string;
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
    cost_inr: number;
    latency_ms: number;
    user_message_snippet?: string;
    prompt_preview?: string;
    response_preview?: string;
    created_at: string;
}

export default function AdminEvaluationPage() {
    const [stats, setStats] = useState<EvaluationStats | null>(null);
    const [logs, setLogs] = useState<LLMTokenLogRow[]>([]);
    const [totalLogs, setTotalLogs] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [daysPeriod, setDaysPeriod] = useState(7);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedAgentFilter, setSelectedAgentFilter] = useState("ALL");
    const [selectedCallTypeFilter, setSelectedCallTypeFilter] = useState("ALL");
    const [selectedSessionDetail, setSelectedSessionDetail] = useState<any>(null);
    const [isSessionLoading, setIsSessionLoading] = useState(false);

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/evaluation/stats?days=${daysPeriod}`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (err) {
            console.error("Failed to fetch evaluation stats:", err);
        }
    };

    const fetchLogs = async () => {
        try {
            setIsLoading(true);
            let url = `${API_BASE}/api/admin/evaluation/logs?limit=50&offset=0`;
            if (searchQuery.trim()) url += `&session_id=${encodeURIComponent(searchQuery.trim())}`;
            if (selectedAgentFilter !== "ALL") url += `&agent_name=${encodeURIComponent(selectedAgentFilter)}`;
            if (selectedCallTypeFilter !== "ALL") url += `&call_type=${encodeURIComponent(selectedCallTypeFilter)}`;

            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setLogs(data.logs || []);
                setTotalLogs(data.total || 0);
            }
        } catch (err) {
            console.error("Failed to fetch logs:", err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchStats();
        fetchLogs();
    }, [daysPeriod, selectedAgentFilter, selectedCallTypeFilter]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        fetchLogs();
    };

    const openSessionDrawer = async (sessionId: string) => {
        if (!sessionId) return;
        setIsSessionLoading(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/evaluation/session/${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedSessionDetail(data);
            }
        } catch (err) {
            console.error("Failed to fetch session detail:", err);
        } finally {
            setIsSessionLoading(false);
        }
    };

    return (
        <div className="space-y-8 max-w-[1600px] mx-auto pb-12">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                <div>
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-blue-600/10 text-blue-600 rounded-xl">
                            <Activity className="w-6 h-6" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                                LLM Token & Cost Evaluation
                            </h1>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">
                                Real-time observability, prompt token tracking, and cost analytics per request.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600">
                        <button
                            onClick={() => setDaysPeriod(1)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${daysPeriod === 1 ? "bg-white text-blue-600 shadow-sm" : "hover:text-slate-900"}`}
                        >
                            Today
                        </button>
                        <button
                            onClick={() => setDaysPeriod(7)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${daysPeriod === 7 ? "bg-white text-blue-600 shadow-sm" : "hover:text-slate-900"}`}
                        >
                            7 Days
                        </button>
                        <button
                            onClick={() => setDaysPeriod(30)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${daysPeriod === 30 ? "bg-white text-blue-600 shadow-sm" : "hover:text-slate-900"}`}
                        >
                            30 Days
                        </button>
                    </div>

                    <button
                        onClick={() => { fetchStats(); fetchLogs(); }}
                        className="p-2.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 bg-slate-100 rounded-xl border border-slate-200 transition-all active:scale-95"
                        title="Refresh Data"
                    >
                        <RefreshCw className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Top Stat Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Stat 1: Today's Cost */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white p-6 rounded-2xl border border-slate-700 shadow-md relative overflow-hidden">
                    <div className="absolute right-3 top-3 text-slate-700/40 pointer-events-none">
                        <Coins className="w-20 h-20" />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <span>Today's Total Spend</span>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold tracking-tight">
                        ₹{stats?.today?.total_cost_inr?.toFixed(2) || "0.00"}
                    </div>
                    <div className="mt-2 text-xs text-slate-400 flex items-center gap-2 font-medium">
                        <span>Period Total: ₹{stats?.summary?.total_cost_inr?.toFixed(2) || "0.00"}</span>
                        <span>•</span>
                        <span>(${stats?.summary?.total_cost_usd?.toFixed(4) || "0.00"} USD)</span>
                    </div>
                </div>

                {/* Stat 2: Total Prompt Tokens */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Total Tokens
                        </span>
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                            <Cpu className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                        {stats?.summary?.total_tokens?.toLocaleString() || "0"}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 font-medium flex items-center justify-between">
                        <span>Input: {stats?.summary?.total_prompt_tokens?.toLocaleString() || "0"}</span>
                        <span className="text-emerald-600 font-semibold">Output: {stats?.summary?.total_completion_tokens?.toLocaleString() || "0"}</span>
                    </div>
                </div>

                {/* Stat 3: Avg Tokens per Session */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            Avg Tokens / JD
                        </span>
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                            <BarChart3 className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                        {stats?.summary?.avg_tokens_per_session?.toLocaleString() || "0"}
                    </div>
                    <div className="mt-2 text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Optimized (~99% Savings Active)</span>
                    </div>
                </div>

                {/* Stat 4: Total LLM Calls & Latency */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                            LLM Calls Executed
                        </span>
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                        {stats?.summary?.total_llm_calls?.toLocaleString() || "0"}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 font-medium flex items-center gap-2">
                        <span>Avg Latency:</span>
                        <span className="font-semibold text-slate-800">{stats?.summary?.avg_latency_ms || 0} ms</span>
                    </div>
                </div>
            </div>

            {/* Breakdown Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Agent Breakdown */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-blue-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Token Consumption by Agent Phase</h3>
                        </div>
                        <span className="text-xs text-slate-400 font-medium">Last {daysPeriod} Days</span>
                    </div>
                    <div className="space-y-3">
                        {stats?.breakdown_by_agent?.map((item) => {
                            const maxTokens = Math.max(...(stats?.breakdown_by_agent?.map(i => i.tokens) || [1]));
                            const pct = Math.round((item.tokens / maxTokens) * 100) || 5;
                            return (
                                <div key={item.agent_name} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                        <span className="text-slate-800">{item.agent_name}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-slate-500 font-normal">{item.call_count} calls</span>
                                            <span className="text-blue-600">{item.tokens.toLocaleString()} tokens</span>
                                            <span className="text-slate-700">₹{item.cost_inr.toFixed(3)}</span>
                                        </div>
                                    </div>
                                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                        <div
                                            className="bg-blue-600 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Call Type Breakdown */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-emerald-600" />
                            <h3 className="font-bold text-slate-900 text-sm">Token Consumption by Call Type</h3>
                        </div>
                        <span className="text-xs text-slate-400 font-medium">Last {daysPeriod} Days</span>
                    </div>
                    <div className="space-y-3">
                        {stats?.breakdown_by_call_type?.map((item) => {
                            const maxTokens = Math.max(...(stats?.breakdown_by_call_type?.map(i => i.tokens) || [1]));
                            const pct = Math.round((item.tokens / maxTokens) * 100) || 5;
                            return (
                                <div key={item.call_type} className="space-y-1">
                                    <div className="flex items-center justify-between text-xs font-semibold">
                                        <span className="text-slate-800 uppercase tracking-wide text-[11px]">{item.call_type}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-slate-500 font-normal">{item.call_count} calls</span>
                                            <span className="text-emerald-600">{item.tokens.toLocaleString()} tokens</span>
                                            <span className="text-slate-700">₹{item.cost_inr.toFixed(3)}</span>
                                        </div>
                                    </div>
                                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                                        <div
                                            className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                                            style={{ width: `${pct}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Real-time Logs Table */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden space-y-4 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <h2 className="text-lg font-bold text-slate-900">Live Request Token Logs</h2>
                        <p className="text-xs text-slate-500">Real-time trace of every LLM call executed by users across the application.</p>
                    </div>

                    {/* Filter Bar */}
                    <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                            <input
                                type="text"
                                placeholder="Search Session ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-48"
                            />
                        </div>

                        <select
                            value={selectedAgentFilter}
                            onChange={(e) => setSelectedAgentFilter(e.target.value)}
                            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium text-slate-700"
                        >
                            <option value="ALL">All Agents</option>
                            <option value="BasicInfoAgent">BasicInfoAgent</option>
                            <option value="WorkflowIdentifierAgent">WorkflowIdentifierAgent</option>
                            <option value="DeepDiveAgent">DeepDiveAgent</option>
                            <option value="ToolsAgent">ToolsAgent</option>
                            <option value="SkillsAgent">SkillsAgent</option>
                            <option value="QualificationAgent">QualificationAgent</option>
                        </select>

                        <button
                            type="submit"
                            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-sm active:scale-95"
                        >
                            Apply Filters
                        </button>
                    </form>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                                <th className="py-3 px-4">Timestamp</th>
                                <th className="py-3 px-4">Session & Employee</th>
                                <th className="py-3 px-4">Agent Phase</th>
                                <th className="py-3 px-4">Call Type</th>
                                <th className="py-3 px-4">Model</th>
                                <th className="py-3 px-4 text-right">Input Tokens</th>
                                <th className="py-3 px-4 text-right">Output Tokens</th>
                                <th className="py-3 px-4 text-right">Total Tokens</th>
                                <th className="py-3 px-4 text-right">Cost (₹)</th>
                                <th className="py-3 px-4 text-right">Latency</th>
                                <th className="py-3 px-4 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={11} className="py-8 text-center text-slate-400">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                                        Loading real-time token logs...
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="py-8 text-center text-slate-400 font-normal">
                                        No LLM call logs found matching criteria.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[11px] text-slate-800">
                                            {log.session_id ? (
                                                <button
                                                    onClick={() => openSessionDrawer(log.session_id!)}
                                                    className="hover:underline text-blue-600 text-left font-bold"
                                                >
                                                    {log.session_id.slice(0, 8)}...
                                                </button>
                                            ) : (
                                                <span className="text-slate-400">System</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-100 font-semibold text-[10px]">
                                                {log.agent_name}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-mono text-[10px] uppercase">
                                                {log.call_type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-slate-600">{log.model_name}</td>
                                        <td className="py-3 px-4 text-right font-mono text-slate-600">{log.prompt_tokens.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right font-mono text-emerald-600">{log.completion_tokens.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">{log.total_tokens.toLocaleString()}</td>
                                        <td className="py-3 px-4 text-right font-mono text-blue-600 font-bold">₹{log.cost_inr.toFixed(3)}</td>
                                        <td className="py-3 px-4 text-right font-mono text-slate-500">{log.latency_ms} ms</td>
                                        <td className="py-3 px-4 text-center">
                                            {log.session_id && (
                                                <button
                                                    onClick={() => openSessionDrawer(log.session_id!)}
                                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                    title="View Full Session Trace"
                                                >
                                                    <ArrowUpRight className="w-4 h-4" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Session Trace Drawer Modal */}
            {selectedSessionDetail && (
                <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex justify-end animate-in fade-in duration-200">
                    <div className="w-full max-w-2xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-900 text-white">
                            <div>
                                <h3 className="text-lg font-bold">Session LLM Trace Breakdown</h3>
                                <p className="text-xs text-slate-400 font-mono mt-0.5">Session ID: {selectedSessionDetail.session_id}</p>
                            </div>
                            <button
                                onClick={() => setSelectedSessionDetail(null)}
                                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Summary Bar */}
                        <div className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-4 gap-2 text-center text-xs font-semibold">
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">LLM Calls</span>
                                <span className="text-slate-900 text-base">{selectedSessionDetail.total_calls}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Prompt Tokens</span>
                                <span className="text-slate-900 text-base">{selectedSessionDetail.total_prompt_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Completion</span>
                                <span className="text-emerald-600 text-base">{selectedSessionDetail.total_completion_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Total Cost</span>
                                <span className="text-blue-600 text-base">₹{selectedSessionDetail.total_cost_inr.toFixed(2)}</span>
                            </div>
                        </div>

                        {/* Call list */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                            {selectedSessionDetail.llm_calls?.map((call: any, idx: number) => (
                                <div key={call.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-2 text-xs">
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <span className="font-bold text-slate-900 flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px]">
                                                {idx + 1}
                                            </span>
                                            {call.agent_name}
                                        </span>
                                        <span className="font-mono text-blue-600 font-bold">₹{call.cost_inr.toFixed(3)}</span>
                                    </div>

                                    <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                                        <div>Call Type: <strong className="text-slate-800 font-mono">{call.call_type}</strong></div>
                                        <div>Tokens: <strong className="text-slate-800 font-mono">{call.total_tokens}</strong></div>
                                        <div>Latency: <strong className="text-slate-800 font-mono">{call.latency_ms} ms</strong></div>
                                    </div>

                                    {call.prompt_preview && (
                                        <div className="mt-2 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] font-mono text-slate-700">
                                            <span className="text-[10px] text-slate-400 font-bold block mb-1 uppercase">Prompt Preview:</span>
                                            {call.prompt_preview}
                                        </div>
                                    )}

                                    {call.response_preview && (
                                        <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[11px] font-mono text-slate-700">
                                            <span className="text-[10px] text-emerald-600 font-bold block mb-1 uppercase">Response Preview:</span>
                                            {call.response_preview}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
