import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X, FileText, LayoutDashboard, ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";

interface KRAKPIPrereqModalProps {
  isOpen: boolean;
  onClose: () => void;
  missing: string[];
  managerCode?: string | null;
  employeeId?: string | null;
}

export function KRAKPIPrereqModal({
  isOpen,
  onClose,
  missing,
  managerCode = "unknown",
  employeeId,
}: KRAKPIPrereqModalProps) {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!isOpen || !mounted) return null;

  const hasEmployeeJdMissing = missing.includes("employee_jd");
  const hasManagerJdMissing = missing.includes("manager_jd");
  const hasManagerKraMissing = missing.includes("manager_kra_kpi");
  const isManagerBlocker = !hasEmployeeJdMissing && (hasManagerJdMissing || hasManagerKraMissing);

  const goToDashboard = () => {
    onClose();
    if (employeeId) {
      router.push(`/dashboard/${window.btoa(employeeId)}`);
    } else {
      router.push("/");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="bg-white w-[90%] sm:w-full max-w-md rounded-[24px] p-5 sm:p-6 shadow-xl animate-in zoom-in-95 duration-300 m-4 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <div className="w-12 h-12 bg-amber-50 rounded-md flex items-center justify-center border border-amber-200">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-neutral-100 transition-colors text-neutral-500 hover:text-neutral-700"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h3 className="text-xl font-semibold text-slate-950 mb-2">Prerequisites Incomplete</h3>
        
        <div className="space-y-4 mb-6 mt-3 text-sm text-slate-600 leading-relaxed font-medium">
          {hasEmployeeJdMissing ? (
            <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
              <p className="text-red-800 font-semibold mb-1">📄 Create Your JD First</p>
              <p className="text-xs text-red-700">
                You must complete your questionnaire interview and generate your Job Description before you can define your KRA/KPI framework.
              </p>
            </div>
          ) : null}

          {isManagerBlocker ? (
            <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100/50">
              <p className="text-amber-800 font-semibold mb-1">👔 Waiting on Your Manager</p>
              <p className="text-xs text-amber-700">
                Your manager (ID: <span className="font-bold underline">{managerCode}</span>) needs to complete their setup before you can start your KRA/KPI.
              </p>
              <ul className="list-disc list-inside mt-2 text-[11px] text-amber-800 space-y-1">
                {hasManagerJdMissing && <li>Manager's Job Description is not yet approved</li>}
                {hasManagerKraMissing && <li>Manager's KRA/KPI framework is not yet confirmed</li>}
              </ul>
              <p className="text-xs text-amber-700 mt-2">
                Please ask your manager to complete their profile, or contact HR/Admin to upload the manager's KRA/KPI document.
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          {hasEmployeeJdMissing ? (
            <>
              <button
                onClick={() => {
                  onClose();
                  router.push("/questionnaire");
                }}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm"
              >
                <ClipboardList className="w-4 h-4" />
                Okay
              </button>
              <button
                onClick={goToDashboard}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm"
              >
                <LayoutDashboard className="w-4 h-4" />
                Back to Dashboard
              </button>
            </>
          ) : isManagerBlocker ? (
            <>
              <button
                onClick={goToDashboard}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm"
              >
                <LayoutDashboard className="w-4 h-4" />
                Back to Dashboard
              </button>
              <button
                onClick={onClose}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm"
              >
                <FileText className="w-4 h-4" />
                View My Job Description
              </button>
            </>
          ) : (
            <button
              onClick={goToDashboard}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm"
            >
              <LayoutDashboard className="w-4 h-4" />
              Back to Dashboard
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
