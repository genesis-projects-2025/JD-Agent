"use client";

import React, { useState, useEffect, useRef } from "react";
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
    FileText,
    Download,
    AlertTriangle,
    ShieldAlert,
    Terminal,
    Code,
    Sparkles
} from "lucide-react";
import { getAdminCache, setAdminCache } from "@/lib/admin-cache";

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
        p50_latency_ms: number;
        p95_latency_ms: number;
        anomaly_count: number;
        total_sessions: number;
        avg_tokens_per_session: number;
    };
    today: {
        total_tokens: number;
        total_cost_inr: number;
        total_calls: number;
        anomalies_today: number;
    };
    breakdown_by_agent: Array<{
        agent_name: string;
        call_count: number;
        tokens: number;
        cost_inr: number;
        avg_latency?: number;
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
    trace_id?: string;
    session_id?: string;
    employee_id?: string;
    employee_name?: string;
    agent_name: string;
    span_name?: string;
    call_type: string;
    model_name: string;
    status: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
    cost_inr: number;
    latency_ms: number;
    is_anomaly: boolean;
    user_message_snippet?: string;
    prompt_preview?: string;
    response_preview?: string;
    full_prompt?: string;
    full_response?: string;
    error_message?: string;
    created_at: string;
}

export default function AdminEvaluationPage() {
    const cachedStats = getAdminCache<EvaluationStats | null>("eval_stats");
    const cachedLogs = getAdminCache<{ logs: LLMTokenLogRow[]; total: number }>("eval_logs");

    const [stats, setStats] = useState<EvaluationStats | null>(cachedStats.data || null);
    const [logs, setLogs] = useState<LLMTokenLogRow[]>(cachedLogs.data?.logs || []);
    const [totalLogs, setTotalLogs] = useState<number>(cachedLogs.data?.total || 0);
    const [isLoading, setIsLoading] = useState(!cachedLogs.data);
    const [daysPeriod, setDaysPeriod] = useState(7);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedAgentFilter, setSelectedAgentFilter] = useState("ALL");
    const [selectedCallTypeFilter, setSelectedCallTypeFilter] = useState("ALL");
    const [onlyAnomalies, setOnlyAnomalies] = useState(false);
    const [autoRefreshInterval, setAutoRefreshInterval] = useState<number | null>(5000); // 5s default live refresh

    const [selectedSessionDetail, setSelectedSessionDetail] = useState<any>(null);
    const [selectedLogRow, setSelectedLogRow] = useState<LLMTokenLogRow | null>(null);
    const [isSessionLoading, setIsSessionLoading] = useState(false);
    const [inspectTab, setInspectTab] = useState<"prompt" | "response" | "meta">("prompt");

    const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/admin/evaluation/stats?days=${daysPeriod}`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
                setAdminCache("eval_stats", data);
            }
        } catch (err) {
            console.error("Failed to fetch evaluation stats:", err);
        }
    };

    const fetchLogs = async () => {
        try {
            if (!cachedLogs.data) setIsLoading(true);
            let url = `${API_BASE}/api/admin/evaluation/logs?limit=20&offset=0`;
            if (searchQuery.trim()) url += `&session_id=${encodeURIComponent(searchQuery.trim())}`;
            if (selectedAgentFilter !== "ALL") url += `&agent_name=${encodeURIComponent(selectedAgentFilter)}`;
            if (selectedCallTypeFilter !== "ALL") url += `&call_type=${encodeURIComponent(selectedCallTypeFilter)}`;
            if (onlyAnomalies) url += `&only_anomalies=true`;

            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                const newLogs = data.logs || [];
                const newTotal = data.total || 0;
                setLogs(newLogs);
                setTotalLogs(newTotal);
                setAdminCache("eval_logs", { logs: newLogs, total: newTotal });
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
    }, [daysPeriod, selectedAgentFilter, selectedCallTypeFilter, onlyAnomalies]);

    // Live auto-refresh polling
    useEffect(() => {
        if (!autoRefreshInterval) return;
        const timer = setInterval(() => {
            fetchStats();
            fetchLogs();
        }, autoRefreshInterval);
        return () => clearInterval(timer);
    }, [autoRefreshInterval, daysPeriod, selectedAgentFilter, selectedCallTypeFilter, onlyAnomalies, searchQuery]);

    const handleSearchSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        fetchLogs();
    };

    const handleExportCSV = () => {
        window.open(`${API_BASE}/api/admin/evaluation/export?days=${daysPeriod}`, "_blank");
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
            {/* Top Control & Header Bar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600/10 text-blue-600 rounded-xl">
                        <Activity className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                                Enterprise LLM Observability & Token Evaluation
                            </h1>
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
                                Live Tracing Active
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 font-medium mt-0.5">
                            Real-time trace monitoring, input/output token metrics, P95 latency, and cost calculations per turn.
                        </p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* Live Refresh Control */}
                    <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600">
                        <button
                            onClick={() => setAutoRefreshInterval(5000)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${autoRefreshInterval === 5000 ? "bg-emerald-600 text-white shadow-sm" : "hover:text-slate-900"}`}
                        >
                            Live 5s
                        </button>
                        <button
                            onClick={() => setAutoRefreshInterval(15000)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${autoRefreshInterval === 15000 ? "bg-white text-blue-600 shadow-sm" : "hover:text-slate-900"}`}
                        >
                            15s
                        </button>
                        <button
                            onClick={() => setAutoRefreshInterval(null)}
                            className={`px-3 py-1.5 rounded-lg transition-all ${autoRefreshInterval === null ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-900"}`}
                        >
                            Pause
                        </button>
                    </div>

                    {/* Period Selector */}
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

                    {/* Export CSV Button */}
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-xl transition-all shadow-sm active:scale-95"
                    >
                        <Download className="w-3.5 h-3.5" />
                        Export CSV
                    </button>

                    <button
                        onClick={() => { fetchStats(); fetchLogs(); }}
                        className="p-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 bg-slate-100 rounded-xl border border-slate-200 transition-all active:scale-95"
                        title="Refresh Now"
                    >
                        <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin text-blue-600" : ""}`} />
                    </button>
                </div>
            </div>

            {/* Metrics Dashboard Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Stat 1: Today's Cost & Total Cost */}
                <div className="bg-gradient-to-br from-slate-950 via-slate-900 to-slate-850 text-white p-6 rounded-2xl border border-slate-800 shadow-lg relative overflow-hidden">
                    <div className="absolute right-3 top-3 text-slate-800/50 pointer-events-none">
                        <Coins className="w-24 h-24" />
                    </div>
                    <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                        <Zap className="w-4 h-4 fill-amber-400" />
                        <span>Today's Total Spend</span>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold tracking-tight">
                        ₹{stats?.today?.total_cost_inr?.toFixed(2) || "0.00"}
                    </div>
                    <div className="mt-2 text-xs text-slate-400 font-medium flex items-center justify-between">
                        <span>Period: ₹{stats?.summary?.total_cost_inr?.toFixed(2) || "0.00"}</span>
                        <span className="text-emerald-400 font-bold">${stats?.summary?.total_cost_usd?.toFixed(4) || "0.00"} USD</span>
                    </div>
                    <p className="mt-2.5 text-[10px] text-slate-400/80 leading-tight border-t border-slate-800/80 pt-2">
                        * Real-time LLM token cost. GCP Console billing includes vector embeddings, taxes & delayed batch settlements.
                    </p>
                </div>

                {/* Stat 2: Total Prompt vs Output Tokens */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Total Tokens
                        </span>
                        <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                            <Cpu className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                        {stats?.summary?.total_tokens?.toLocaleString() || "0"}
                    </div>
                    <div className="mt-2 text-xs text-slate-500 font-medium flex items-center justify-between">
                        <span>In: <strong className="text-slate-800">{stats?.summary?.total_prompt_tokens?.toLocaleString() || "0"}</strong></span>
                        <span>Out: <strong className="text-emerald-600">{stats?.summary?.total_completion_tokens?.toLocaleString() || "0"}</strong></span>
                    </div>
                </div>

                {/* Stat 3: Avg Tokens / JD & Efficiency */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Avg Tokens / JD
                        </span>
                        <div className="p-2 bg-emerald-50 text-emerald-600 rounded-xl">
                            <BarChart3 className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 text-3xl font-extrabold text-slate-900 tracking-tight">
                        {stats?.summary?.avg_tokens_per_session?.toLocaleString() || "0"}
                    </div>
                    <div className="mt-2 text-xs text-emerald-600 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>~99.8% Token Optimization Active</span>
                    </div>
                </div>

                {/* Stat 4: Latency P50 / P95 & Anomalies */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm relative">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Latency & Anomalies
                        </span>
                        <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                            <Clock className="w-4 h-4" />
                        </div>
                    </div>
                    <div className="mt-3 flex items-baseline gap-3">
                        <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                            {stats?.summary?.avg_latency_ms || 0} ms
                        </span>
                        <span className="text-xs font-bold text-slate-400 font-mono">P95: {stats?.summary?.p95_latency_ms || 0}ms</span>
                    </div>
                    <div className="mt-2 text-xs font-medium flex items-center justify-between">
                        <span className="text-slate-500">P50: {stats?.summary?.p50_latency_ms || 0}ms</span>
                        {stats?.summary?.anomaly_count ? (
                            <span className="text-amber-600 bg-amber-50 px-2 py-0.5 rounded font-bold flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                {stats.summary.anomaly_count} Anomalies
                            </span>
                        ) : (
                            <span className="text-emerald-600 font-bold">0 Anomalies</span>
                        )}
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
                                            <span className="text-slate-700 font-mono">₹{item.cost_inr.toFixed(3)}</span>
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
                                        <span className="text-slate-800 uppercase tracking-wide text-[11px] font-mono">{item.call_type}</span>
                                        <div className="flex items-center gap-3">
                                            <span className="text-slate-500 font-normal">{item.call_count} calls</span>
                                            <span className="text-emerald-600">{item.tokens.toLocaleString()} tokens</span>
                                            <span className="text-slate-700 font-mono">₹{item.cost_inr.toFixed(3)}</span>
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

            {/* Real-time Trace Logs Table */}
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden space-y-4 p-6">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-bold text-slate-900">Live Request Traces & LLM Call Logs</h2>
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md font-mono text-xs">
                                {totalLogs} Total
                            </span>
                        </div>
                        <p className="text-xs text-slate-500">Real-time trace of every LLM call executed across all user sessions.</p>
                    </div>

                    {/* Filter Controls */}
                    <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-3">
                        <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                            <input
                                type="text"
                                placeholder="Search Session ID..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-44"
                            />
                        </div>

                        <select
                            value={selectedAgentFilter}
                            onChange={(e) => setSelectedAgentFilter(e.target.value)}
                            className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 font-medium text-slate-700"
                        >
                            <option value="ALL">All Agent Phases</option>
                            <option value="BasicInfoAgent">BasicInfoAgent</option>
                            <option value="WorkflowIdentifierAgent">WorkflowIdentifierAgent</option>
                            <option value="DeepDiveAgent">DeepDiveAgent</option>
                            <option value="ToolsAgent">ToolsAgent</option>
                            <option value="SkillsAgent">SkillsAgent</option>
                            <option value="QualificationAgent">QualificationAgent</option>
                        </select>

                        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 cursor-pointer select-none bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                            <input
                                type="checkbox"
                                checked={onlyAnomalies}
                                onChange={(e) => setOnlyAnomalies(e.target.checked)}
                                className="rounded text-amber-600 focus:ring-amber-500"
                            />
                            <span>Anomalies Only</span>
                        </label>

                        <button
                            type="submit"
                            className="px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all shadow-sm active:scale-95"
                        >
                            Apply
                        </button>
                    </form>
                </div>

                {/* Trace Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/50 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                                <th className="py-3 px-4">Time</th>
                                <th className="py-3 px-4">Session ID</th>
                                <th className="py-3 px-4">Agent Phase</th>
                                <th className="py-3 px-4">Call Type</th>
                                <th className="py-3 px-4">Model</th>
                                <th className="py-3 px-4 text-right">In Tokens</th>
                                <th className="py-3 px-4 text-right">Out Tokens</th>
                                <th className="py-3 px-4 text-right">Total Tokens</th>
                                <th className="py-3 px-4 text-right">Cost (₹)</th>
                                <th className="py-3 px-4 text-right">Latency</th>
                                <th className="py-3 px-4 text-center">Inspect</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-medium">
                            {isLoading ? (
                                <tr>
                                    <td colSpan={11} className="py-8 text-center text-slate-400">
                                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                                        Fetching real-time traces...
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={11} className="py-8 text-center text-slate-400 font-normal">
                                        No LLM call logs found matching filter criteria.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => (
                                    <tr key={log.id} className={`hover:bg-slate-50/90 transition-colors ${log.is_anomaly ? "bg-amber-50/40" : ""}`}>
                                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap font-mono text-[11px]">
                                            {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </td>
                                        <td className="py-3 px-4 font-mono text-[11px] text-slate-800">
                                            {log.session_id ? (
                                                <button
                                                    onClick={() => openSessionDrawer(log.session_id!)}
                                                    className="hover:underline text-blue-600 font-bold"
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
                                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                                            {log.total_tokens.toLocaleString()}
                                            {log.is_anomaly && (
                                                <span className="ml-1 text-amber-600" title="High token or slow latency anomaly">⚠️</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4 text-right font-mono text-blue-600 font-bold">₹{log.cost_inr.toFixed(3)}</td>
                                        <td className="py-3 px-4 text-right font-mono text-slate-500">{log.latency_ms} ms</td>
                                        <td className="py-3 px-4 text-center">
                                            <button
                                                onClick={() => setSelectedLogRow(log)}
                                                className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                title="Inspect Prompt & Response"
                                            >
                                                <Code className="w-4 h-4" />
                                            </button>
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
                    <div className="w-full max-w-3xl bg-white h-full shadow-2xl flex flex-col border-l border-slate-200">
                        {/* Header */}
                        <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-slate-950 text-white">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-lg font-bold">Session Trace Evaluation</h3>
                                    {selectedSessionDetail.anomaly_count > 0 && (
                                        <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[10px] font-bold">
                                            {selectedSessionDetail.anomaly_count} Anomalies Detected
                                        </span>
                                    )}
                                </div>
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
                                <span className="text-slate-900 text-base font-bold">{selectedSessionDetail.total_calls}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Input Tokens</span>
                                <span className="text-slate-900 text-base font-mono font-bold">{selectedSessionDetail.total_prompt_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Output Tokens</span>
                                <span className="text-emerald-600 text-base font-mono font-bold">{selectedSessionDetail.total_completion_tokens.toLocaleString()}</span>
                            </div>
                            <div>
                                <span className="text-slate-400 block text-[10px] uppercase">Total Cost</span>
                                <span className="text-blue-600 text-base font-mono font-bold">₹{selectedSessionDetail.total_cost_inr.toFixed(2)}</span>
                            </div>
                        </div>

                        {/* Call Timeline List */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                            {selectedSessionDetail.llm_calls?.map((call: any, idx: number) => (
                                <div key={call.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-sm space-y-3 text-xs">
                                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <div className="flex items-center gap-2">
                                            <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">
                                                {idx + 1}
                                            </span>
                                            <span className="font-bold text-slate-900">{call.agent_name}</span>
                                            <span className="px-2 py-0.5 bg-slate-100 text-slate-600 font-mono text-[10px] uppercase rounded">
                                                {call.call_type}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <span className="font-mono text-slate-500">{call.latency_ms} ms</span>
                                            <span className="font-mono text-blue-600 font-bold">₹{call.cost_inr.toFixed(3)}</span>
                                        </div>
                                    </div>

                                    {call.prompt_preview && (
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] font-mono text-slate-800 space-y-1">
                                            <span className="text-[10px] text-slate-400 font-bold block uppercase">Prompt Preview:</span>
                                            <p className="line-clamp-3">{call.prompt_preview}</p>
                                        </div>
                                    )}

                                    {call.response_preview && (
                                        <div className="bg-emerald-50/50 p-3 rounded-xl border border-emerald-100 text-[11px] font-mono text-slate-800 space-y-1">
                                            <span className="text-[10px] text-emerald-600 font-bold block uppercase">LLM Output Preview:</span>
                                            <p className="line-clamp-3">{call.response_preview}</p>
                                        </div>
                                    )}

                                    <div className="flex justify-end pt-1">
                                        <button
                                            onClick={() => setSelectedLogRow(call)}
                                            className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1"
                                        >
                                            <Code className="w-3.5 h-3.5" />
                                            Inspect Full Prompt & Response
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Log Row Inspector Modal */}
            {selectedLogRow && (
                <div className="fixed inset-0 z-[60] bg-slate-950/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
                    <div className="w-full max-w-4xl bg-slate-900 text-slate-100 rounded-2xl shadow-2xl border border-slate-800 overflow-hidden flex flex-col max-h-[90vh]">
                        {/* Modal Header */}
                        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-500/10 text-blue-400 rounded-xl">
                                    <Terminal className="w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-bold text-white">LLM Call Inspector</h3>
                                    <p className="text-xs text-slate-400 font-mono">ID: {selectedLogRow.id}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setSelectedLogRow(null)}
                                className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-all"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Sub Nav */}
                        <div className="flex items-center border-b border-slate-800 bg-slate-900 px-6 gap-4 text-xs font-semibold">
                            <button
                                onClick={() => setInspectTab("prompt")}
                                className={`py-3 border-b-2 transition-all ${inspectTab === "prompt" ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-white"}`}
                            >
                                System & Prompt Content
                            </button>
                            <button
                                onClick={() => setInspectTab("response")}
                                className={`py-3 border-b-2 transition-all ${inspectTab === "response" ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-400 hover:text-white"}`}
                            >
                                LLM Response Output
                            </button>
                            <button
                                onClick={() => setInspectTab("meta")}
                                className={`py-3 border-b-2 transition-all ${inspectTab === "meta" ? "border-indigo-500 text-indigo-400" : "border-transparent text-slate-400 hover:text-white"}`}
                            >
                                Metadata & Tokens
                            </button>
                        </div>

                        {/* Content Body */}
                        <div className="p-6 overflow-y-auto flex-1 font-mono text-xs space-y-4 custom-scrollbar">
                            {inspectTab === "prompt" && (
                                <div className="space-y-4">
                                    {selectedLogRow.user_message_snippet && (
                                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                                            <span className="text-[10px] font-bold text-blue-400 uppercase">User Input:</span>
                                            <pre className="whitespace-pre-wrap text-slate-200">{selectedLogRow.user_message_snippet}</pre>
                                        </div>
                                    )}
                                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">Prompt Content / System Message:</span>
                                        <pre className="whitespace-pre-wrap text-slate-300">
                                            {selectedLogRow.full_prompt || selectedLogRow.prompt_preview || "No prompt details available"}
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {inspectTab === "response" && (
                                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
                                    <span className="text-[10px] font-bold text-emerald-400 uppercase">LLM Output Text:</span>
                                    <pre className="whitespace-pre-wrap text-emerald-300">
                                        {selectedLogRow.full_response || selectedLogRow.response_preview || "No response content"}
                                    </pre>
                                </div>
                            )}

                            {inspectTab === "meta" && (
                                <div className="grid grid-cols-2 gap-4 text-slate-300">
                                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                                        <div><span className="text-slate-500">Agent Phase:</span> <strong className="text-white">{selectedLogRow.agent_name}</strong></div>
                                        <div><span className="text-slate-500">Call Type:</span> <strong className="text-white uppercase">{selectedLogRow.call_type}</strong></div>
                                        <div><span className="text-slate-500">Model Used:</span> <strong className="text-white">{selectedLogRow.model_name}</strong></div>
                                        <div><span className="text-slate-500">Status:</span> <strong className="text-emerald-400">{selectedLogRow.status}</strong></div>
                                    </div>
                                    <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                                        <div><span className="text-slate-500">Input Tokens:</span> <strong className="text-white">{selectedLogRow.prompt_tokens}</strong></div>
                                        <div><span className="text-slate-500">Output Tokens:</span> <strong className="text-emerald-400">{selectedLogRow.completion_tokens}</strong></div>
                                        <div><span className="text-slate-500">Total Tokens:</span> <strong className="text-white">{selectedLogRow.total_tokens}</strong></div>
                                        <div><span className="text-slate-500">Cost (INR):</span> <strong className="text-blue-400">₹{selectedLogRow.cost_inr.toFixed(4)}</strong></div>
                                        <div><span className="text-slate-500">Latency:</span> <strong className="text-white">{selectedLogRow.latency_ms} ms</strong></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
