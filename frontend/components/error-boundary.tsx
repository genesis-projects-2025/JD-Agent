"use client";

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
 children: ReactNode;
}

interface State {
 hasError: boolean;
 error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
 constructor(props: Props) {
 super(props);
 this.state = { hasError: false, error: null };
 }

 static getDerivedStateFromError(error: Error): State {
 return { hasError: true, error };
 }

 componentDidCatch(error: Error, info: React.ErrorInfo) {
 console.error("ErrorBoundary caught:", error, info);
 }

 render() {
 if (this.state.hasError) {
 return (
 <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-50 p-6">
 <div className="max-w-md w-full text-center">
 <div className="w-16 h-16 bg-rose-100 rounded-md flex items-center justify-center mx-auto mb-6">
 <AlertTriangle className="w-8 h-8 text-rose-600" />
 </div>
 <h1 className="text-xl font-medium text-slate-900 mb-2">
 Something went wrong
 </h1>
 <p className="text-sm text-slate-500 mb-6">
 An unexpected error occurred. Please try refreshing the page.
 </p>
 {this.state.error && (
 <p className="text-xs text-slate-400 bg-slate-100 rounded-lg p-3 mb-6 font-mono break-all">
 {this.state.error.message}
 </p>
 )}
 <button
 onClick={() => {
 this.setState({ hasError: false, error: null });
 window.location.reload();
 }}
 className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-md text-sm font-semibold hover:bg-slate-800 transition-colors"
 >
 <RefreshCw className="w-4 h-4" />
 Refresh Page
 </button>
 </div>
 </div>
 );
 }

 return this.props.children;
 }
}
