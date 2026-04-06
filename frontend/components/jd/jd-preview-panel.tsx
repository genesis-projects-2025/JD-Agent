// components/jd/jd-preview-panel.tsx
// Slide-in panel shown on the CHAT page after JD generation

"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
 X,
 Download,
 Save,
 CheckCircle2,
 Loader2,
 FileText,
 Briefcase,
 Target,
 Wrench,
 Users,
 BarChart3,
 Clock,
 ChevronRight,
 Sparkles,
 ExternalLink,
 Edit,
 Plus,
 Trash,
 GraduationCap,
 ChevronDown,
 FileDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { downloadJDPdfClient } from "@/lib/download-jd-pdf";
import { downloadJDDocx } from "@/lib/api";

type Props = {
 jd: string | null;
 structuredData: any;
 isGenerating: boolean;
 isSaving: boolean;
 saveSuccess?: boolean;
 onSave: () => void;
 onEdit: () => void;
 updateJd: (newJd: string) => void;
 updateStructuredData: (newData: any) => void;
 onClose: () => void;
 sessionId: string;
};

function SkillTag({ label }: { label: string }) {
 return (
 <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary-50 text-primary-700 border border-primary-100 tracking-wide">
 {label}
 </span>
 );
}

function SectionBlock({
 icon: Icon,
 title,
 children,
}: {
 icon: any;
 title: string;
 children: React.ReactNode;
}) {
 return (
 <div className="mb-8">
 <div className="flex items-center gap-2.5 mb-4">
 <div className="w-8 h-8 bg-surface-50 rounded-lg flex items-center justify-center border border-surface-100">
 <Icon className="w-4 h-4 text-primary-500" />
 </div>
 <h3 className="text-[10px] font-medium text-surface-400 tracking-[0.25em]">
 {title}
 </h3>
 </div>
 <div className="pl-0">{children}</div>
 </div>
 );
}

function BulletList({ items }: { items: string[] }) {
 if (!items?.length) return null;
 return (
 <ul className="space-y-2.5">
 {items.map((item, i) => (
 <li
 key={i}
 className="flex items-start gap-3 text-[13px] text-surface-700 leading-relaxed"
 >
 <div className="mt-1.5 w-1.5 h-1.5 rounded-md bg-primary-400 flex-shrink-0" />
 <span>{item}</span>
 </li>
 ))}
 </ul>
 );
}

export default function JDPreviewPanel({
 jd,
 structuredData,
 isGenerating,
 isSaving,
 saveSuccess,
 onSave,
 onEdit,
 updateJd,
 updateStructuredData,
 onClose,
 sessionId,
}: Props) {
 const router = useRouter();
 const [activeTab, setActiveTab] = useState<"structured" | "markdown">(
 "structured",
 );
 const [isEditing, setIsEditing] = useState(false);
 const [editedData, setEditedData] = useState<any>(null);
 const [showDownloadDropdown, setShowDownloadDropdown] = useState(false);

 const s = structuredData || {};

 // For migration/fallback: map legacy keys if needed
 const getSafeData = () => {
 const d = { ...s };
 if (d.key_responsibilities && !d.responsibilities) d.responsibilities = d.key_responsibilities;
 if (d.required_skills && !d.skills) d.skills = d.required_skills;
 if (d.tools_and_technologies && !d.tools) d.tools = d.tools_and_technologies;
 if (d.role_summary && !d.purpose) d.purpose = d.role_summary;
 return d;
 };

 const safeData = getSafeData();
 const empInfo = safeData.employee_information || {};
 const title =
 empInfo.job_title ||
 empInfo.title ||
 empInfo.role_title ||
 "Job Description";
 const dept = empInfo.department || "";
 const location = empInfo.location || "";
 const reportsTo = empInfo.reports_to || "";
 const workType = empInfo.work_type || empInfo.employment_type || "";

 const hasStructured =
 structuredData && Object.keys(structuredData).length > 0;

 const handleEditToggle = () => {
 if (!isEditing) {
 setEditedData(JSON.parse(JSON.stringify(safeData)));
 setActiveTab("structured");
 } else {
 // Done editing
 updateStructuredData(editedData);
 // We don't updateJd here because the backend will regenerate md from structured on save.
 // But for local UI sync, we could clear it or wait for save.
 }
 setIsEditing(!isEditing);
 };

 const handleTextChange = (key: string, val: string) => {
 setEditedData((prev: any) => ({ ...prev, [key]: val }));
 };

 const handleArrayChange = (key: string, idx: number, val: string) => {
 setEditedData((prev: any) => {
 const arr = [...(prev[key] || [])];
 arr[idx] = val;
 return { ...prev, [key]: arr };
 });
 };

 const handleAddArrayItem = (key: string) => {
 setEditedData((prev: any) => ({
 ...prev,
 [key]: [...(prev[key] || []), ""],
 }));
 };

 const handleRemoveArrayItem = (key: string, idx: number) => {
 setEditedData((prev: any) => {
 const arr = [...(prev[key] || [])];
 arr.splice(idx, 1);
 return { ...prev, [key]: arr };
 });
 };

 return (
 <div className="flex flex-col h-full bg-white border-l border-surface-200 w-full">
 {/* Header */}
 <div className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-surface-100 bg-gradient-to-r from-primary-600 to-primary-800">
 <div className="flex items-center justify-between mb-1">
 <div className="flex items-center gap-2 sm:gap-2.5">
 <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-white/80 shrink-0" />
 <span className="text-[9px] sm:text-[10px] font-medium text-white/70 tracking-[0.25em] truncate">
 Generated JD
 </span>
 </div>
 <button
 onClick={onClose}
 className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0 md:hidden"
 >
 <X className="w-4 h-4" />
 </button>
 <button
 onClick={onClose}
 className="hidden md:flex w-8 h-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors shrink-0"
 >
 <X className="w-4 h-4" />
 </button>
 </div>
 <h2 className="text-base sm:text-lg font-medium text-white leading-tight line-clamp-2">
 {isGenerating ? "Architecting..." : title}
 </h2>
 {!isGenerating && (dept || location) && (
 <p className="text-[10px] sm:text-[11px] text-white/60 mt-1 font-medium truncate">
 {[dept, location, workType].filter(Boolean).join(" · ")}
 </p>
 )}
 </div>

 {/* Loading state */}
 {isGenerating && (
 <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
 <div className="relative">
 <div className="w-16 h-16 rounded-md bg-primary-50 flex items-center justify-center border border-primary-100">
 <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
 </div>
 <div className="absolute -inset-2 bg-primary-100 rounded-md animate-ping opacity-20" />
 </div>
 <div className="text-center">
 <p className="text-sm font-medium text-surface-700 ">
 Creating Your JD
 </p>
 <p className="text-xs text-surface-400 mt-2 font-medium">
 Generating role intelligence into professional format...
 </p>
 </div>
 <div className="w-full max-w-xs space-y-2">
 {[
 "Analyzing insights",
 "Structuring responsibilities",
 "Formatting document",
 ].map((step, i) => (
 <div key={i} className="flex items-center gap-3">
 <div
 className="w-1.5 h-1.5 rounded-md bg-primary-400 animate-pulse"
 style={{ animationDelay: `${i * 300}ms` }}
 />
 <span className="text-[11px] text-surface-500 font-medium">
 {step}
 </span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Tabs */}
 {!isGenerating && jd && (
 <>
 {hasStructured && (
 <div className="flex-shrink-0 flex border-b border-surface-100 px-2 sm:px-4 pt-2 sm:pt-3 gap-1 overflow-x-auto">
 {(["structured", "markdown"] as const).map((tab) => (
 <button
 key={tab}
 onClick={() => setActiveTab(tab)}
 className={`px-3 sm:px-4 py-1.5 sm:py-2 text-[9px] sm:text-[10px] font-medium rounded-t-lg transition-all whitespace-nowrap ${
 activeTab === tab
 ? "bg-primary-600 text-white"
 : "text-surface-400 hover:text-surface-700"
 }`}
 >
 {tab === "structured" ? "Structured View" : "Document View"}
 </button>
 ))}
 </div>
 )}

 {/* Content */}
 <div className="flex-1 overflow-y-auto">
 {/* STRUCTURED VIEW */} {activeTab === "structured" && hasStructured ? (
 <div className="p-4 sm:p-6 space-y-1">
 {isEditing ? (
 /* STRUCTURED EDIT FORM */
 <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
 {/* Purpose */}
 <div className="space-y-3">
 <label className="text-[10px] font-medium text-surface-400 px-1">
 Purpose of the Job
 </label>
 <textarea
 value={editedData.purpose || ""}
 onChange={(e) => handleTextChange("purpose", e.target.value)}
 className="w-full bg-surface-50 border border-surface-200 rounded-md p-4 text-[13px] font-medium text-surface-800 leading-relaxed focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[120px] transition-all"
 placeholder="Brief overview of the role's purpose..."
 />
 </div>

 {/* Arrays: Responsibilities, Skills, Tools */}
 {[
 { key: ["responsibilities", "key_responsibilities"], label: "Job Responsibilities" },
 { key: ["skills", "required_skills"], label: "Skills / Competencies" },
 { key: ["tools", "tools_and_technologies"], label: "Tools & Technologies" },
 ].map((field) => {
 const currentKey = Array.isArray(field.key) ? field.key.find(k => editedData[k]?.length > 0) || field.key[0] : field.key;
 return (
 <div key={currentKey} className="space-y-4">
 <div className="flex items-center justify-between px-1">
 <label className="text-[10px] font-medium text-surface-400 ">
 {field.label}
 </label>
 <button
 onClick={() => handleAddArrayItem(currentKey)}
 className="flex items-center gap-1.5 text-[9px] font-medium text-primary-600 hover:text-primary-700 bg-primary-50 px-3 py-1.5 rounded-lg transition-all"
 >
 <Plus className="w-3 h-3" /> Add
 </button>
 </div>
 <div className="space-y-2.5">
 {(editedData[currentKey] || []).map((item: string, idx: number) => (
 <div key={idx} className="flex items-start gap-2 group">
 <textarea
 value={item}
 onChange={(e) => handleArrayChange(currentKey, idx, e.target.value)}
 className="flex-1 bg-surface-50 border border-surface-200 rounded-md p-3 text-[12px] font-medium text-surface-800 leading-relaxed focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[60px] transition-all"
 />
 <button
 onClick={() => handleRemoveArrayItem(currentKey, idx)}
 className="mt-1 w-8 h-8 flex items-center justify-center rounded-lg text-surface-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
 >
 <Trash className="w-3.5 h-3.5" />
 </button>
 </div>
 ))}
 </div>
 </div>
 )})}

 {/* Education & Experience */}
 <div className="space-y-6 pt-4">
 <div className="space-y-3">
 <label className="text-[10px] font-medium text-surface-400 px-1">
 Education Requested
 </label>
 <textarea
 value={editedData.education || ""}
 onChange={(e) => handleTextChange("education", e.target.value)}
 className="w-full bg-surface-50 border border-surface-200 rounded-md p-4 text-[12px] font-medium text-surface-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[80px]"
 />
 </div>
 <div className="space-y-3">
 <label className="text-[10px] font-medium text-surface-400 px-1">
 Experience Requested
 </label>
 <textarea
 value={editedData.experience || ""}
 onChange={(e) => handleTextChange("experience", e.target.value)}
 className="w-full bg-surface-50 border border-surface-200 rounded-md p-4 text-[12px] font-medium text-surface-800 focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none resize-none min-h-[80px]"
 />
 </div>
 </div>
 </div>
 ) : (
 /* STRUCTURED READ-ONLY VIEW */
 <>
 {/* Role meta */}
 {reportsTo && (
 <div className="mb-4 sm:mb-6 px-3 sm:px-4 py-2 sm:py-3 bg-surface-50 rounded-md border border-surface-100 flex items-center gap-2 sm:gap-3 text-[11px] sm:text-[12px] text-surface-600">
 <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-surface-400 shrink-0" />
 <span className="truncate">
 <span className="font-medium text-surface-900">
 Reports to:
 </span>{" "}
 {reportsTo}
 </span>
 </div>
 )}

 {/* Purpose of the Job */}
 {safeData.purpose && (
 <SectionBlock icon={FileText} title="Purpose of the Job">
 <p className="text-[13px] text-surface-700 leading-relaxed">
 {typeof safeData.purpose === "string"
 ? safeData.purpose
 : safeData.purpose?.description ||
 JSON.stringify(safeData.purpose)}
 </p>
 </SectionBlock>
 )}

 {/* Job Responsibilities */}
 {(safeData.responsibilities?.length > 0 || safeData.key_responsibilities?.length > 0) && (
 <SectionBlock icon={Target} title="Job Responsibilities">
 <BulletList items={safeData.responsibilities || safeData.key_responsibilities} />
 </SectionBlock>
 )}

 {/* Required Skills */}
 {(safeData.skills?.length > 0 || safeData.required_skills?.length > 0) && (
 <SectionBlock icon={Briefcase} title="Skills / Competencies">
 <div className="flex flex-wrap gap-2">
 {(safeData.skills || safeData.required_skills).map((skill: string, i: number) => (
 <SkillTag key={i} label={skill} />
 ))}
 </div>
 </SectionBlock>
 )}

 {/* Tools & Technologies */}
 {(safeData.tools?.length > 0 || safeData.tools_and_technologies?.length > 0) && (
 <SectionBlock icon={Wrench} title="Tools & Technologies">
 <div className="flex flex-wrap gap-2">
 {(safeData.tools || safeData.tools_and_technologies).map(
 (tool: string, i: number) => (
 <span
 key={i}
 className="inline-flex items-center px-3 py-1.5 rounded-lg text-[11px] font-medium bg-surface-50 text-surface-700 border border-surface-200 tracking-wide"
 >
 {tool}
 </span>
 ),
 )}
 </div>
 </SectionBlock>
 )}

 {/* Education & Experience */}
 {(safeData.education || safeData.experience) && (
 <SectionBlock icon={GraduationCap} title="Qualifications & Experience">
 <div className="space-y-4">
 {safeData.education && (
 <div>
 <h4 className="text-[10px] font-medium text-surface-400 mb-1">Education</h4>
 <p className="text-[13px] text-surface-700">{safeData.education}</p>
 </div>
 )}
 {safeData.experience && (
 <div>
 <h4 className="text-[10px] font-medium text-surface-400 mb-1">Experience</h4>
 <p className="text-[13px] text-surface-700">{safeData.experience}</p>
 </div>
 )}
 </div>
 </SectionBlock>
 )}

 {/* Working Relationships */}
 {safeData.working_relationships &&
 Object.keys(safeData.working_relationships).length > 0 && (
 <SectionBlock icon={Users} title="Working Relationships">
 <div className="space-y-2">
 {Object.entries(safeData.working_relationships).map(([k, v]) => (
 <div
 key={k}
 className="flex items-start justify-between gap-4 py-2 border-b border-surface-50 last:border-0"
 >
 <span className="text-[11px] font-medium text-surface-400 tracking-wider">
 {k.replace(/_/g, " ")}
 </span>
 <span className="text-[12px] text-surface-700 font-semibold text-right">
 {Array.isArray(v) ? v.join(", ") : String(v)}
 </span>
 </div>
 ))}
 </div>
 </SectionBlock>
 )}
 </>
 )}
 </div>
 ) : (
 /* MARKDOWN VIEW */
 <div className="p-4 sm:p-6 h-full flex flex-col min-h-[400px]">
 {isEditing ? (
 <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-surface-50 rounded-md border border-dashed border-surface-200">
 <Edit className="w-8 h-8 text-surface-300 mb-4" />
 <h4 className="text-sm font-medium text-surface-700">Document Edition Disabled</h4>
 <p className="text-xs text-surface-500 mt-2 max-w-[200px]">
 Please use the <strong>Structured View</strong> tab to edit the JD fields.
 </p>
 <button 
 onClick={() => setActiveTab('structured')}
 className="mt-6 text-[11px] font-medium text-primary-600 hover:text-primary-700"
 >
 Switch to Structured View
 </button>
 </div>
 ) : (
 <div className="prose prose-sm prose-neutral max-w-none prose-headings:font-medium prose-headings:text-surface-900 prose-h1:text-lg sm:prose-h1:text-xl prose-h2:text-sm sm:prose-h2:text-base prose-h2:mt-4 sm:prose-h2:mt-6 prose-p:text-surface-700 prose-li:text-surface-700 prose-strong:text-primary-700 text-sm">
 <ReactMarkdown remarkPlugins={[remarkGfm]}>
 {jd}
 </ReactMarkdown>
 </div>
 )}
 </div>
 )}
 </div>

 {/* Actions Footer */}
 <div className="flex-shrink-0 p-4 border-t border-surface-100 bg-surface-50 space-y-2">
 <button
 onClick={onSave}
 disabled={isSaving || saveSuccess || isEditing}
 className={`w-full py-3.5 text-white rounded-md font-medium text-[13px] transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-2 ${
 saveSuccess
 ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/20 disabled:opacity-100"
 : "bg-primary-600 hover:bg-primary-700 shadow-primary-500/20 disabled:opacity-50"
 }`}
 >
 {isSaving ? (
 <Loader2 className="w-4 h-4 animate-spin" />
 ) : saveSuccess ? (
 <CheckCircle2 className="w-4 h-4" />
 ) : (
 <Save className="w-4 h-4" />
 )}
 {isSaving
 ? "Saving to Database..."
 : saveSuccess
 ? "Saved Successfully!"
 : isEditing 
 ? "Finish Editing to Save"
 : "Save JD to Database"}
 </button>
 <div className="flex gap-2">
 <button
 onClick={handleEditToggle}
 disabled={isSaving}
 className={`flex-1 py-3 hover:bg-surface-50 border border-surface-200 rounded-md font-medium text-[12px] transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm ${
 isEditing
 ? "bg-primary-50 text-primary-700 border-primary-200"
 : "bg-white text-surface-700"
 }`}
 >
 {isEditing ? (
 <CheckCircle2 className="w-3.5 h-3.5" />
 ) : (
 <Edit className="w-3.5 h-3.5" />
 )}
 {isEditing ? "Done Editing" : "Edit JD"}
 </button>

 <div className="flex-1 relative">
 <button
 onClick={() => setShowDownloadDropdown(!showDownloadDropdown)}
 disabled={isEditing || !jd}
 className="w-full py-3 bg-white text-primary-700 border border-primary-200 rounded-md font-medium text-[12px] hover:bg-primary-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
 >
 <Download className={`w-3.5 h-3.5 ${isGenerating ? 'animate-pulse' : ''}`} />
 Download
 <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showDownloadDropdown ? 'rotate-180' : ''}`} />
 </button>

 {showDownloadDropdown && (
 <div className="absolute bottom-full left-0 right-0 mb-2 bg-white border border-surface-200 rounded-md shadow-md z-[100] overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
 <button
 onClick={(e) => {
 e.stopPropagation();
 setShowDownloadDropdown(false);
 downloadJDPdfClient(
 safeData,
 title,
 dept
 );
 }}
 className="w-full flex items-center gap-3 px-4 py-3.5 text-[12px] font-medium text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
 >
 <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center group-hover/item:bg-red-100 transition-colors">
 <FileDown className="w-4 h-4 text-red-600" />
 </div>
 <div className="flex flex-col items-start text-left">
 <span>Professional PDF</span>
 <span className="text-[9px] text-surface-400 font-medium">Branded template</span>
 </div>
 </button>
 <button
 onClick={(e) => {
 e.stopPropagation();
 setShowDownloadDropdown(false);
 downloadJDDocx(sessionId);
 }}
 className="w-full flex items-center gap-3 px-4 py-3.5 text-[12px] font-medium text-surface-700 hover:bg-primary-50 hover:text-primary-700 transition-colors group/item"
 >
 <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center group-hover/item:bg-blue-100 transition-colors">
 <FileText className="w-4 h-4 text-blue-600" />
 </div>
 <div className="flex flex-col items-start text-left">
 <span>Word Document</span>
 <span className="text-[9px] text-surface-400 font-medium">Editable file</span>
 </div>
 </button>
 </div>
 )}
 </div>
 </div>
 </div>
 </>
 )}
 </div>
 );
}
