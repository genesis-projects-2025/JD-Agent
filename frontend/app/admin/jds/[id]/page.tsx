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
import { Briefcase, Users, FileText, CheckCircle, XCircle, Download, Eye, Shield, Target, Wrench, Calendar, Send, Loader2, X } from 'lucide-react'
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
              <button onClick={() => { setShowFullView(false); setPreviewData(null) }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="p-6 max-h-[80vh] overflow-y-auto">
              {loadingPreview ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
              ) : previewData?.jd_structured ? (
                <PdfDocumentView data={previewData.jd_structured} roleTitle={jd?.role_title} dept={jd?.department} />
              ) : (
                <p className="text-slate-500 text-center py-10">No preview data available</p>
              )}
            </div>
            {previewData && (
              <div className="sticky bottom-0 p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex gap-3">
                <button onClick={() => previewData.jd_structured && downloadJDPdfClient(previewData.jd_structured, jd?.role_title, jd?.department)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 shadow-sm">
                  <Download className="w-4 h-4" />Download PDF
                </button>
              </div>
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
