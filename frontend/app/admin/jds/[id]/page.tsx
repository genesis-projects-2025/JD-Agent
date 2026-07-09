// frontend/app/admin/jds/[id]/page.tsx
'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { getCookie, cookieKeys } from '@/lib/cookies'
import { formatDateTime } from '@/lib/format-date'
import {
  fetchAdminReferenceJD,
  fetchAdminReferenceJDPreview,
  publishAdminReferenceJD,
} from '@/lib/api'
import { Briefcase, Users, FileText, CheckCircle, XCircle, Download, Eye, Shield, Target, Wrench, Calendar, Send, Loader2, X, Save, Plus, Trash2, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { downloadJDPdfClient } from '@/lib/download-jd-pdf'
import { PdfDocumentView } from '@/components/jd/pdf-document-view'
import type { ReferenceJDPreviewResponse, ReferenceJDRecord } from '@/types/reference-jd'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function JDDetailPage() {
  const router = useRouter()
  const params = useParams()
  const [jd, setJd] = useState<ReferenceJDRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showFullView, setShowFullView] = useState(false)
  const [previewData, setPreviewData] = useState<ReferenceJDPreviewResponse["data"] | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // JD Preview editing states
  const [isEditingJD, setIsEditingJD] = useState(false)
  const [editedJdTitle, setEditedJdTitle] = useState('')
  const [editedJdDept, setEditedJdDept] = useState('')
  const [editedJdLevel, setEditedJdLevel] = useState('')
  const [editedJdPurpose, setEditedJdPurpose] = useState('')
  const [editedJdTasks, setEditedJdTasks] = useState<string[]>([])
  const [editedJdSkills, setEditedJdSkills] = useState<string[]>([])
  const [editedJdTools, setEditedJdTools] = useState<string[]>([])
  const [editedJdEducation, setEditedJdEducation] = useState('')
  const [editedJdExperience, setEditedJdExperience] = useState('')
  const [savingEditedJd, setSavingEditedJd] = useState(false)

  const handleUpdateTask = (idx: number, val: string) => {
    setEditedJdTasks(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleAddTask = () => {
    setEditedJdTasks(prev => [...prev, '']);
  };

  const handleRemoveTask = (idx: number) => {
    setEditedJdTasks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateSkill = (idx: number, val: string) => {
    setEditedJdSkills(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleAddSkill = () => {
    setEditedJdSkills(prev => [...prev, '']);
  };

  const handleRemoveSkill = (idx: number) => {
    setEditedJdSkills(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpdateTool = (idx: number, val: string) => {
    setEditedJdTools(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleAddTool = () => {
    setEditedJdTools(prev => [...prev, '']);
  };

  const handleRemoveTool = (idx: number) => {
    setEditedJdTools(prev => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => {
    const token = getCookie(cookieKeys.ADMIN_TOKEN)
    if (!token) { router.push('/admin/login'); return }
    fetchJD()
  }, [params.id])

  const fetchJD = async () => {
    try {
      setJd(await fetchAdminReferenceJD(String(params.id)))
    } catch { setError('Failed to fetch JD') }
    finally { setLoading(false) }
  }

  const handlePublish = async () => {
    setIsPublishing(true)
    try {
      const response = await publishAdminReferenceJD(String(params.id))
      setJd((prev) =>
        prev
          ? {
              ...prev,
              processing_status: response.data.processing_status,
              published_at: response.data.published_at ?? new Date().toISOString(),
            }
          : prev,
      )
    } catch { alert('Failed to publish JD') }
    finally { setIsPublishing(false) }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`${API_URL}/admin/jds/${params.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` }
      })
      if (res.ok) router.push('/admin/jd-library')
    } catch {
      alert('Failed to delete JD')
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleViewFullJD = async () => {
    setShowFullView(true)
    setLoadingPreview(true)
    try {
      setPreviewData(await fetchAdminReferenceJDPreview(String(params.id)))
    } catch { alert('Failed to load preview') }
    finally { setLoadingPreview(false) }
  }

  const startEditingJd = () => {
    if (!previewData?.jd_structured) return;
    const struct = previewData.jd_structured as any;
    const ref = (previewData.reference_data || {}) as any;
    
    setEditedJdTitle(ref.role_title || struct.job_title || struct.designation || "");
    setEditedJdDept(ref.department || struct.department || struct.function || "");
    setEditedJdLevel(ref.level || struct.experience || struct.level || "");
    setEditedJdPurpose(struct.purpose || struct.role_summary || "");
    
    // Extract arrays safely
    const tasks = Array.isArray(struct.responsibilities) ? struct.responsibilities : 
                  Array.isArray(struct.key_responsibilities) ? struct.key_responsibilities : [];
    setEditedJdTasks([...tasks]);
    
    const skl = Array.isArray(struct.skills) ? struct.skills : 
                Array.isArray(struct.technical_skills) ? struct.technical_skills : [];
    setEditedJdSkills([...skl]);
    
    const tls = Array.isArray(struct.tools) ? struct.tools : 
                Array.isArray(struct.tools_used) ? struct.tools_used : 
                Array.isArray(struct.tools_and_technologies) ? struct.tools_and_technologies : [];
    setEditedJdTools([...tls]);
    
    setEditedJdEducation(struct.qualifications?.education || struct.education || struct.qualifications?.required_education || "");
    setEditedJdExperience(struct.qualifications?.experience || struct.experience || struct.qualifications?.experience_years || "");
    
    setIsEditingJD(true);
  };

  const handleSaveJDEdits = async () => {
    if (!previewData?.reference_data?.id) return;
    setSavingEditedJd(true);
    try {
      const { updateAdminReferenceJD } = await import("@/lib/api");
      const struct = previewData.jd_structured as any;
      const updatedStructured = {
        ...struct,
        job_title: editedJdTitle,
        department: editedJdDept,
        experience: editedJdLevel,
        purpose: editedJdPurpose,
        responsibilities: editedJdTasks,
        skills: editedJdSkills,
        tools: editedJdTools,
        qualifications: {
          ...struct?.qualifications,
          education: editedJdEducation,
          experience: editedJdExperience
        },
        employee_information: {
          ...struct?.employee_information,
          job_title: editedJdTitle,
          department: editedJdDept
        }
      };

      await updateAdminReferenceJD(previewData.reference_data.id, {
        role_title: editedJdTitle,
        department: editedJdDept,
        level: editedJdLevel,
        structured_data: updatedStructured
      });

      // Update previewData state with the saved data
      setPreviewData((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          jd_structured: updatedStructured,
          reference_data: {
            ...prev.reference_data,
            role_title: editedJdTitle,
            department: editedJdDept
          }
        };
      });

      // Update parent component's reference data to show changes immediately on screen
      setJd((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          role_title: editedJdTitle,
          department: editedJdDept,
          level: editedJdLevel,
          structured_data: updatedStructured
        };
      });

      setIsEditingJD(false);
      alert("Job Description updated successfully!");
    } catch (err: any) {
      alert(err.message || "Failed to update Job Description");
    } finally {
      setSavingEditedJd(false);
    }
  };

  const handleDownloadPDF = () => {
    if (previewData?.jd_structured) {
      downloadJDPdfClient(previewData.jd_structured, jd?.role_title, jd?.department)
    } else if (jd?.structured_data) {
      downloadJDPdfClient(jd.structured_data, jd.role_title, jd.department)
    }
  }

  const safeData = (jd?.structured_data || {}) as {
    purpose?: string
    tasks?: string[]
    responsibilities?: string[]
    key_responsibilities?: string[]
    skills?: string[]
    tools?: string[]
    technologies?: string[]
  }
  const responsibilityItems = safeData.tasks ?? safeData.responsibilities ?? safeData.key_responsibilities ?? []
  const skillItems = safeData.skills ?? []
  const toolItems = [...(safeData.tools ?? []), ...(safeData.technologies ?? [])]

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !jd) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <XCircle className="w-16 h-16 mx-auto text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-slate-800 mb-2">JD Not Found</h2>
          <p className="text-slate-500 mb-6">{error || 'The requested JD does not exist'}</p>
          <Link href="/admin/jd-library" className="text-blue-600 hover:text-blue-700 font-medium">← Back to Library</Link>
        </div>
      </div>
    )
  }

  const formatDate = (dateStr: string) => formatDateTime(dateStr)

  return (
    <div className="w-full">
      {/* Header Actions */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{jd.role_title || 'Untitled Role'}</h1>
            <p className="text-sm text-slate-500">Reference Library Entry</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {jd.processing_status !== 'published' && (
            <button onClick={handlePublish} disabled={isPublishing}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50">
              {isPublishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {isPublishing ? 'Publishing...' : 'Publish to Employee'}
            </button>
          )}
          {jd.processing_status === 'published' && (
            <span className="px-4 py-2.5 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium border border-emerald-200 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" />Published
            </span>
          )}
          <button onClick={() => setShowDeleteConfirm(true)}
            className="px-4 py-2.5 bg-red-50 text-red-600 rounded-lg text-sm font-medium hover:bg-red-100 transition-all flex items-center gap-2 border border-red-200">
            <XCircle className="w-4 h-4" />Delete
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className="mb-8 p-5 bg-white rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <span className={`px-3.5 py-1.5 rounded-lg text-sm font-medium ${jd.processing_status === 'published' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : jd.processing_status === 'processed' ? 'bg-blue-50 text-blue-600 border border-blue-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
              {jd.processing_status?.toUpperCase()}
            </span>
            {jd.published_at && (
              <span className="flex items-center gap-1 text-sm text-slate-500">
                <CheckCircle className="w-4 h-4 text-emerald-500" />Published on {formatDate(jd.published_at)}
              </span>
            )}
          </div>
          <div className="text-sm text-slate-400">Uploaded on {formatDate(jd.uploaded_at)}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Role Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <h2 className="text-3xl font-semibold text-slate-900 mb-6">{jd.role_title || 'Untitled Role'}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: Briefcase, label: 'Department', value: jd.department },
                { icon: Users, label: 'Level', value: jd.level },
                { icon: Shield, label: 'Employee', value: jd.employee_name },
                { icon: Calendar, label: 'Employee ID', value: jd.employee_id },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <Icon className="w-5 h-5 text-blue-500" />
                  <div><div className="text-xs text-slate-400">{label}</div><div className="text-slate-800 font-medium">{value || '—'}</div></div>
                </div>
              ))}
            </div>
          </div>

          {safeData.purpose && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-5"><div className="p-2 bg-blue-50 rounded-lg border border-blue-100"><FileText className="w-5 h-5 text-blue-600" /></div>
                <h3 className="text-xl font-semibold text-slate-900">Purpose of the Role</h3></div>
              <p className="text-slate-600 leading-relaxed">{safeData.purpose}</p>
            </div>
          )}

          {responsibilityItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-5"><div className="p-2 bg-blue-50 rounded-lg border border-blue-100"><Target className="w-5 h-5 text-blue-600" /></div>
                <h3 className="text-xl font-semibold text-slate-900">Key Responsibilities</h3></div>
              <ul className="space-y-3">
                {responsibilityItems.map((item: string, i: number) => (
                  <li key={i} className="flex items-start gap-3"><div className="w-2 h-2 bg-blue-500 rounded-full mt-2 flex-shrink-0" /><span className="text-slate-600">{item}</span></li>
                ))}
              </ul>
            </div>
          )}

          {skillItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-5"><div className="p-2 bg-blue-50 rounded-lg border border-blue-100"><Target className="w-5 h-5 text-blue-600" /></div>
                <h3 className="text-xl font-semibold text-slate-900">Required Skills</h3></div>
              <div className="flex flex-wrap gap-2">
                {skillItems.map((skill: string, i: number) => (
                  <span key={i} className="px-3.5 py-1.5 bg-slate-50 rounded-lg text-slate-700 text-sm border border-slate-200">{skill}</span>
                ))}
              </div>
            </div>
          )}

          {toolItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="flex items-center gap-3 mb-5"><div className="p-2 bg-blue-50 rounded-lg border border-blue-100"><Wrench className="w-5 h-5 text-blue-600" /></div>
                <h3 className="text-xl font-semibold text-slate-900">Tools & Technologies</h3></div>
              <div className="flex flex-wrap gap-2">
                {toolItems.map((tool: string, i: number) => (
                  <span key={i} className="px-3.5 py-1.5 bg-slate-50 rounded-lg text-slate-700 text-sm border border-slate-200">{tool}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <button onClick={handleViewFullJD}
                className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-all text-left text-sm font-medium border border-blue-100">
                <Eye className="w-4 h-4" /><span>View Full JD (Employee View)</span>
              </button>
              <button onClick={handleDownloadPDF}
                className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 text-slate-700 rounded-lg hover:bg-slate-100 transition-all text-left text-sm font-medium border border-slate-200">
                <Download className="w-4 h-4" /><span>Download PDF</span>
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Metadata</h3>
            <div className="space-y-3 text-sm">
              {[
                { label: 'Uploaded By', value: jd.uploaded_by || 'Admin' },
                { label: 'Uploaded At', value: formatDate(jd.uploaded_at) },
                ...(jd.published_at ? [{ label: 'Published At', value: formatDate(jd.published_at) }] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between"><span className="text-slate-500">{label}</span><span className="text-slate-800 font-medium">{value}</span></div>
              ))}
              <div className="flex justify-between">
                <span className="text-slate-500">Status</span>
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-medium ${jd.processing_status === 'published' ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'}`}>
                  {jd.processing_status}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Full JD View Modal */}
      {showFullView && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-8 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl relative">
            <div className="sticky top-0 flex items-center justify-between p-5 border-b border-slate-200 bg-white rounded-t-2xl z-10">
              <h3 className="text-lg font-semibold text-slate-900">Employee Dashboard View</h3>
              <div className="flex items-center gap-3">
                {previewData && !loadingPreview && (
                  <button
                    onClick={() => {
                      if (isEditingJD) {
                        setIsEditingJD(false);
                      } else {
                        startEditingJd();
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all shadow-sm bg-white"
                  >
                    {isEditingJD ? "Cancel" : "Edit JD"}
                  </button>
                )}
                <button onClick={() => { setShowFullView(false); setPreviewData(null); setIsEditingJD(false); }}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
              </div>
            </div>
            <div className="p-6 max-h-[80vh] overflow-y-auto">
              {loadingPreview ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
              ) : isEditingJD ? (
                <div className="space-y-6 max-w-3xl mx-auto bg-slate-50/50 p-6 rounded-2xl border border-slate-150">
                  <h4 className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2 mb-4 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-blue-500 animate-pulse" />
                    Modify JD Fields
                  </h4>
                  
                  {/* Row 1: Designation, Level, Department */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Designation</label>
                      <input
                        type="text"
                        value={editedJdTitle}
                        onChange={(e) => setEditedJdTitle(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Job Level</label>
                      <input
                        type="text"
                        value={editedJdLevel}
                        onChange={(e) => setEditedJdLevel(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Department</label>
                      <input
                        type="text"
                        value={editedJdDept}
                        onChange={(e) => setEditedJdDept(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-semibold"
                      />
                    </div>
                  </div>

                  {/* Row 2: Purpose */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Purpose of the Role</label>
                    <textarea
                      value={editedJdPurpose}
                      onChange={(e) => setEditedJdPurpose(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all leading-relaxed"
                      rows={3}
                    />
                  </div>

                  {/* Row 3: Responsibilities List */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Responsibilities</label>
                      <button onClick={handleAddTask} className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-bold text-blue-600 hover:bg-slate-50 transition-colors">
                        <Plus className="w-2.5 h-2.5" /> Add Row
                      </button>
                    </div>
                    <div className="space-y-2">
                      {editedJdTasks.map((task, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-mono w-5 text-right">{idx + 1}.</span>
                          <input
                            type="text"
                            value={task}
                            onChange={(e) => handleUpdateTask(idx, e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none"
                            placeholder={`Responsibility ${idx + 1}`}
                          />
                          <button onClick={() => handleRemoveTask(idx)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Row 4: Skills List */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Required Skills</label>
                      <button onClick={handleAddSkill} className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-bold text-blue-600 hover:bg-slate-50 transition-colors">
                        <Plus className="w-2.5 h-2.5" /> Add Row
                      </button>
                    </div>
                    <div className="space-y-2">
                      {editedJdSkills.map((skill, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-mono w-5 text-right">{idx + 1}.</span>
                          <input
                            type="text"
                            value={skill}
                            onChange={(e) => handleUpdateSkill(idx, e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none"
                            placeholder="Skill"
                          />
                          <button onClick={() => handleRemoveSkill(idx)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Row 5: Tools & Platforms List */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">Tools & Platforms</label>
                      <button onClick={handleAddTool} className="flex items-center gap-1 px-2 py-1 bg-white border border-slate-200 rounded-lg text-[9px] font-bold text-blue-600 hover:bg-slate-50 transition-colors">
                        <Plus className="w-2.5 h-2.5" /> Add Row
                      </button>
                    </div>
                    <div className="space-y-2">
                      {editedJdTools.map((tool, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-400 font-mono w-5 text-right">{idx + 1}.</span>
                          <input
                            type="text"
                            value={tool}
                            onChange={(e) => handleUpdateTool(idx, e.target.value)}
                            className="flex-1 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none"
                            placeholder="Tool / Platform"
                          />
                          <button onClick={() => handleRemoveTool(idx)} className="text-slate-400 hover:text-red-500 transition-colors p-1">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Row 6: Qualifications */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Education</label>
                      <input
                        type="text"
                        value={editedJdEducation}
                        onChange={(e) => setEditedJdEducation(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Experience</label>
                      <input
                        type="text"
                        value={editedJdExperience}
                        onChange={(e) => setEditedJdExperience(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                      />
                    </div>
                  </div>
                </div>
              ) : previewData?.jd_structured ? (
                <PdfDocumentView data={previewData.jd_structured} roleTitle={jd?.role_title} dept={jd?.department} />
              ) : (
                <p className="text-slate-500 text-center py-10">No preview data available</p>
              )}
            </div>
            {previewData && (
              isEditingJD ? (
                <div className="sticky bottom-0 p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex gap-3 justify-end">
                  <button onClick={() => setIsEditingJD(false)}
                    className="px-5 py-2.5 border border-slate-200 text-slate-700 bg-white rounded-lg text-sm font-semibold hover:bg-slate-50 transition-all shadow-sm">
                    Cancel
                  </button>
                  <button onClick={handleSaveJDEdits} disabled={savingEditedJd}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50">
                    {savingEditedJd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {savingEditedJd ? 'Saving...' : 'Save JD Changes'}
                  </button>
                </div>
              ) : (
                <div className="sticky bottom-0 p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex gap-3">
                  <button onClick={() => previewData.jd_structured && downloadJDPdfClient(previewData.jd_structured, jd?.role_title, jd?.department)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 shadow-sm">
                    <Download className="w-4 h-4" />Download PDF
                  </button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-red-50 rounded-lg border border-red-100"><XCircle className="w-5 h-5 text-red-500" /></div>
              <h3 className="text-lg font-semibold text-slate-900">Delete JD</h3>
            </div>
            <p className="text-slate-500 mb-6">Are you sure you want to delete this job description? This action cannot be undone.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium text-sm">Cancel</button>
              <button onClick={handleDelete} disabled={isDeleting}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center justify-center gap-2 font-medium text-sm">
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
