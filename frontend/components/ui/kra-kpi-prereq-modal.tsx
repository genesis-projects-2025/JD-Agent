import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X, FileText, LayoutDashboard, ClipboardList } from "lucide-react";
import { useRouter } from "next/navigation";
import { safeBtoa } from "@/lib/base64";

interface KRAKPIPrereqModalProps {
  isOpen: boolean;
  onClose: () => void;
  missing: string[];
  employeeId: string;
  employeeName?: string;
  managerCode: string;
  currentUserId: string;
  currentUserRole?: string;
}

export function KRAKPIPrereqModal({
  isOpen,
  onClose,
  missing,
  employeeId,
  employeeName = "Employee",
  managerCode = "unknown",
  currentUserId,
  currentUserRole,
}: KRAKPIPrereqModalProps) {
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timer);
  }, []);

  if (!isOpen || !mounted) return null;

  const hasEmployeeJdMissing = missing.includes("employee_jd");
  const hasEmployeeJdApprovedMissing = missing.includes("employee_jd_approved");
  const hasManagerJdMissing = missing.includes("manager_jd");
  const hasManagerKraMissing = missing.includes("manager_kra_kpi");
  const isManagerBlocker = !hasEmployeeJdMissing && (hasManagerJdMissing || hasManagerKraMissing);

  const isSelf = currentUserId === employeeId;
  const isDirectManager = currentUserId === managerCode;

  const goToDashboard = () => {
    onClose();
    if (currentUserId) {
      router.push(`/dashboard/${safeBtoa(currentUserId)}`);
    } else {
      router.push("/");
    }
  };

  // Render content depending on who is viewing it
  let title = "Prerequisites Incomplete";
  let content = null;
  let buttons = null;

  if (isSelf) {
    // ----------------------------------------------------
    // CASE 1: Employee is viewing their own prerequisites
    // ----------------------------------------------------
    title = "Prerequisites Incomplete";
    content = (
      <div className="space-y-4 mb-6 mt-3 text-sm text-slate-600 leading-relaxed font-medium">
        {hasEmployeeJdMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Create Your JD First</p>
            <p className="text-xs text-red-700">
              You must complete your questionnaire interview and generate your Job Description before you can define your KRA/KPI framework.
            </p>
          </div>
        ) : null}

        {hasEmployeeJdApprovedMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Waiting on Manager JD Approval</p>
            <p className="text-xs text-red-700">
              Your Job Description has not been approved by your manager yet. Your manager must review and approve your Job Description before you can generate your KRA/KPI performance goals.
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
              Please request your manager to complete their setup, or contact HR to proceed.
            </p>
          </div>
        ) : null}
      </div>
    );

    buttons = (
      <div className="flex flex-col gap-2">
        {hasEmployeeJdMissing ? (
          <>
            <button
              onClick={() => {
                onClose();
                router.push("/questionnaire");
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm cursor-pointer"
            >
              <ClipboardList className="w-4 h-4" />
              Start My JD Interview
            </button>
            <button
              onClick={goToDashboard}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4" />
              Back to Dashboard
            </button>
          </>
        ) : (
          <>
            <button
              onClick={goToDashboard}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4" />
              Back to Dashboard
            </button>
            <button
              onClick={onClose}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              View My Job Description
            </button>
          </>
        )}
      </div>
    );
  } else if (isDirectManager) {
    // ----------------------------------------------------
    // CASE 2: Reporting Manager is viewing their subordinate's prerequisites
    // ----------------------------------------------------
    title = "Subordinate Setup Blocked";
    content = (
      <div className="space-y-4 mb-6 mt-3 text-sm text-slate-600 leading-relaxed font-medium">
        {hasEmployeeJdMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Subordinate JD Incomplete</p>
            <p className="text-xs text-red-700">
              The employee <span className="font-bold">{employeeName}</span> (ID: {employeeId}) has not completed their Job Description yet. They must finish their interview first.
            </p>
          </div>
        ) : null}

        {hasEmployeeJdApprovedMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Subordinate JD Needs Your Approval</p>
            <p className="text-xs text-red-700">
              The Job Description for <span className="font-bold">{employeeName}</span> has not been approved by you yet. Please review and approve their Job Description on your dashboard first.
            </p>
          </div>
        ) : null}

        {isManagerBlocker ? (
          <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100/50">
            <p className="text-amber-800 font-semibold mb-1">👔 Your Setup is Required</p>
            <p className="text-xs text-amber-700">
              You must complete your own setup before <span className="font-bold">{employeeName}</span> can start their KRA/KPI framework.
            </p>
            <ul className="list-disc list-inside mt-2 text-[11px] text-amber-800 space-y-1">
              {hasManagerJdMissing && <li>Your own Job Description is not yet approved</li>}
              {hasManagerKraMissing && <li>Your own KRA/KPI framework is not yet confirmed</li>}
            </ul>
            <p className="text-xs text-amber-700 mt-2">
              Please complete your JD interview and finalize your KRA/KPIs on your own dashboard first.
            </p>
          </div>
        ) : null}
      </div>
    );

    buttons = (
      <div className="flex flex-col gap-2">
        <button
          onClick={goToDashboard}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm cursor-pointer"
        >
          <LayoutDashboard className="w-4 h-4" />
          Go to My Dashboard
        </button>
        <button
          onClick={onClose}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm cursor-pointer"
        >
          <FileText className="w-4 h-4" />
          {hasEmployeeJdMissing ? "Close" : "View Subordinate JD"}
        </button>
      </div>
    );
  } else {
    // ----------------------------------------------------
    // CASE 3: HR / Admin / Other user is viewing
    // ----------------------------------------------------
    title = "Setup Prerequisites Incomplete";
    content = (
      <div className="space-y-4 mb-6 mt-3 text-sm text-slate-600 leading-relaxed font-medium">
        {hasEmployeeJdMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Employee JD Incomplete</p>
            <p className="text-xs text-red-700">
              The employee <span className="font-bold">{employeeName}</span> (ID: {employeeId}) has not generated their Job Description yet.
            </p>
          </div>
        ) : null}

        {hasEmployeeJdApprovedMissing ? (
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100/50">
            <p className="text-red-800 font-semibold mb-1">📄 Employee JD Manager Approval Pending</p>
            <p className="text-xs text-red-700">
              The Job Description for <span className="font-bold">{employeeName}</span> has not been approved by their manager yet.
            </p>
          </div>
        ) : null}

        {isManagerBlocker ? (
          <div className="p-3 bg-amber-50/50 rounded-xl border border-amber-100/50">
            <p className="text-amber-800 font-semibold mb-1">👔 Manager Setup Pending</p>
            <p className="text-xs text-amber-700">
              The reporting manager (ID: <span className="font-bold underline">{managerCode}</span>) has not completed their setup.
            </p>
            <ul className="list-disc list-inside mt-2 text-[11px] text-amber-800 space-y-1">
              {hasManagerJdMissing && <li>Manager's Job Description is not yet approved</li>}
              {hasManagerKraMissing && <li>Manager's KRA/KPI framework is not yet confirmed</li>}
            </ul>
          </div>
        ) : null}
      </div>
    );

    buttons = (
      <div className="flex flex-col gap-2">
        <button
          onClick={goToDashboard}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-md shadow-md shadow-slate-900/20 transition-all text-sm cursor-pointer"
        >
          <LayoutDashboard className="w-4 h-4" />
          Back to Dashboard
        </button>
        <button
          onClick={onClose}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-md transition-all text-sm cursor-pointer"
        >
          <FileText className="w-4 h-4" />
          {hasEmployeeJdMissing ? "Close" : "View Employee JD"}
        </button>
      </div>
    );
  }

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
            className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-neutral-100 transition-colors text-neutral-500 hover:text-neutral-700 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h3 className="text-xl font-semibold text-slate-950 mb-2">{title}</h3>
        
        {content}
        {buttons}
      </div>
    </div>,
    document.body
  );
}
