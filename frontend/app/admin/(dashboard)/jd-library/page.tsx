// frontend/app/admin/(dashboard)/jd-library/page.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle, Loader2, Briefcase, Eye, X, FileTextIcon, Shield, Download, Send, ChevronDown } from 'lucide-react'
import { useAuth } from '@/components/providers/auth-provider'
import { getCookie, cookieKeys } from '@/lib/cookies'
import Link from 'next/link'
import { downloadJDPdfClient } from '@/lib/download-jd-pdf'
import { PdfDocumentView } from '@/components/jd/pdf-document-view'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function JDLibraryPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [results, setResults] = useState<Array<{
    file: string
    status: 'success' | 'error'
    message: string
    data?: any
  }>>([])
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [jds, setJDs] = useState<any[]>([])
  const [loadingJDs, setLoadingJDs] = useState(false)
  const router = useRouter()
  const { employeeId: authEmployeeId } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [activeTab, setActiveTab] = useState<'upload' | 'library'>('upload')

  // Publish states
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set())

  // Preview modal
  const [previewData, setPreviewData] = useState<any>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)

  useEffect(() => {
    const token = getCookie(cookieKeys.ADMIN_TOKEN)
    if (!token) {
      router.push('/admin/login')
    } else {
      setIsCheckingAuth(false)
    }
  }, [router])

  useEffect(() => {
    if (!isCheckingAuth) fetchJDs()
  }, [isCheckingAuth])

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  const fetchJDs = async () => {
    setLoadingJDs(true)
    try {
      const token = getCookie(cookieKeys.ADMIN_TOKEN)
      const res = await fetch(`${API_URL}/admin/jds/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setJDs(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch JDs:', error)
    } finally {
      setLoadingJDs(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files).filter(file => file.type === 'application/pdf'))
      setResults([])
    }
  }

  const processFiles = async () => {
    if (files.length === 0 || !employeeId || !employeeName) {
      alert('Please select PDF files and enter employee information')
      return
    }
    setUploading(true)
    setCurrentFileIndex(0)
    const uploadResults = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setCurrentFileIndex(i + 1)
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('employee_id', employeeId)
        formData.append('employee_name', employeeName)
        formData.append('uploaded_by', authEmployeeId || 'admin')
        const response = await fetch(`${API_URL}/admin/jds/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
          body: formData,
        })
        const data = await response.json()
        uploadResults.push({
          file: file.name,
          status: response.ok ? 'success' as const : 'error' as const,
          message: response.ok ? 'JD processed successfully' : (data.detail || 'Upload failed'),
          data: response.ok ? data.data : undefined,
        })
      } catch (error: any) {
        uploadResults.push({ file: file.name, status: 'error' as const, message: error.message || 'Upload failed' })
      }
    }
    setResults(uploadResults)
    setUploading(false)
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    fetchJDs()
  }

  const handlePublish = async (jdId: string) => {
    setPublishingId(jdId)
    try {
      const res = await fetch(`${API_URL}/admin/jds/${jdId}/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` }
      })
      if (res.ok) {
        setPublishedIds(prev => new Set(prev).add(jdId))
        fetchJDs()
      } else {
        const data = await res.json()
        alert(data.detail || 'Failed to publish')
      }
    } catch {
      alert('Failed to publish JD')
    } finally {
      setPublishingId(null)
    }
  }

  const handlePreview = async (jdId: string) => {
    setLoadingPreview(true)
    setShowPreview(true)
    try {
      const res = await fetch(`${API_URL}/admin/jds/${jdId}/preview`, {
        headers: { 'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` }
      })
      if (res.ok) {
        const data = await res.json()
        setPreviewData(data.data)
      }
    } catch {
      alert('Failed to load preview')
      setShowPreview(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleDownloadFromResult = (resultData: any) => {
    if (resultData?.structured_data) {
      downloadJDPdfClient(resultData.structured_data, resultData.role_title, resultData.department)
    }
  }

  const handleDownloadFromJD = (jd: any) => {
    if (jd?.structured_data) {
      downloadJDPdfClient(jd.structured_data, jd.role_title, jd.department)
    }
  }

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length

  const formatDate = (dateStr: string) =>
    new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="w-full">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 mb-8 bg-slate-100 p-1.5 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('upload')}
          className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >Upload JD</button>
        <button
          onClick={() => setActiveTab('library')}
          className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'library' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >Reference Library</button>
      </div>

      {activeTab === 'upload' ? (
        <div className="max-w-3xl">
          {/* Upload Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100"><Upload className="w-6 h-6 text-blue-600" /></div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Upload JD PDF</h2>
                <p className="text-slate-500 mt-1">Process job description PDFs with AI</p>
              </div>
            </div>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Employee ID *</label>
                  <input type="text" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="e.g., EMP001"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all" disabled={uploading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Employee Name *</label>
                  <input type="text" value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="e.g., John Manager"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all" disabled={uploading} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Select PDF Files *</label>
                <div className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${files.length > 0 ? 'border-blue-400 bg-blue-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" multiple accept=".pdf" onChange={handleFileSelect} className="hidden" disabled={uploading} />
                  <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                  <p className="text-slate-600 text-sm">{files.length > 0 ? `${files.length} file(s) selected` : 'Click to browse or drag and drop'}</p>
                  <p className="text-slate-400 text-xs mt-1">Maximum file size: 10MB</p>
                </div>
              </div>
              {files.length > 0 && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <h3 className="text-sm font-medium text-slate-700 mb-3">Selected Files:</h3>
                  <div className="space-y-2">
                    {files.map((file, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-slate-600 bg-white rounded-lg px-3 py-2 border border-slate-100">
                        <FileText className="w-4 h-4 text-blue-500" /><span className="flex-1">{file.name}</span>
                        <span className="text-slate-400">{(file.size / 1024).toFixed(1)} KB</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={processFiles} disabled={uploading || files.length === 0 || !employeeId || !employeeName}
                className={`w-full py-4 px-6 rounded-xl font-medium text-sm transition-all ${uploading || files.length === 0 || !employeeId || !employeeName ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'}`}>
                {uploading ? (<span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin" />Processing {currentFileIndex} of {files.length}...</span>) : `Upload & Process`}
              </button>
            </div>
          </div>

          {/* Results with Publish/View/Download */}
          {results.length > 0 && (
            <div className="mt-8 bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Processing Results</h2>
              <div className="flex gap-6 mb-6 p-4 bg-slate-50 rounded-xl">
                <div className="flex items-center gap-2"><CheckCircle className="w-5 h-5 text-emerald-500" /><span className="text-sm font-medium text-emerald-600">{successCount} Success</span></div>
                {errorCount > 0 && <div className="flex items-center gap-2"><X className="w-5 h-5 text-red-500" /><span className="text-sm font-medium text-red-600">{errorCount} Failed</span></div>}
              </div>
              <div className="space-y-4">
                {results.map((result, index) => (
                  <div key={index} className={`p-5 rounded-xl border ${result.status === 'success' ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        {result.status === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <X className="w-5 h-5 text-red-500" />}
                        <div>
                          <p className="font-medium text-slate-800">{result.file}</p>
                          <p className="text-sm text-slate-500">{result.message}</p>
                          {result.data?.role_title && <p className="text-sm text-blue-600 font-medium mt-1">Role: {result.data.role_title}</p>}
                        </div>
                      </div>
                    </div>
                    {result.status === 'success' && result.data && (
                      <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-3">
                        <button onClick={() => handlePreview(result.data.id)}
                          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                          <Eye className="w-4 h-4" />View JD
                        </button>
                        <button onClick={() => handleDownloadFromResult(result.data)}
                          className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                          <Download className="w-4 h-4" />Download PDF
                        </button>
                        {publishedIds.has(result.data.id) ? (
                          <span className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium border border-emerald-200">
                            <CheckCircle className="w-4 h-4" />Published
                          </span>
                        ) : (
                          <button onClick={() => handlePublish(result.data.id)} disabled={publishingId === result.data.id}
                            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50">
                            {publishingId === result.data.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                            {publishingId === result.data.id ? 'Publishing...' : 'Publish to Employee'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => setResults([])} className="mt-4 text-sm text-slate-400 hover:text-slate-600">Clear Results</button>
            </div>
          )}
        </div>
      ) : (
        /* Reference Library Tab */
        <div className="max-w-7xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Reference Library</h2>
              <p className="text-slate-500 mt-1">AI-processed job descriptions</p>
            </div>
          </div>
          {loadingJDs ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
          ) : jds.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
              <FileTextIcon className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-700 mb-2">No JDs in library</h3>
              <p className="text-slate-400 text-sm">Upload a JD PDF to get started</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {jds.map((jd) => (
                <div key={jd.id} className="bg-white rounded-2xl border border-slate-200 p-6 hover:border-blue-300 transition-all hover:shadow-md group">
                  <div className="flex items-start justify-between mb-4">
                    <div className="p-2 bg-blue-50 rounded-lg border border-blue-100"><Briefcase className="w-5 h-5 text-blue-600" /></div>
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium ${jd.processing_status === 'published' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}`}>
                      {jd.processing_status}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-900 mb-2 line-clamp-2">{jd.role_title || 'Untitled Role'}</h3>
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-sm text-slate-500"><Briefcase className="w-4 h-4" /><span>{jd.department || '—'}</span></div>
                    <div className="flex items-center gap-2 text-sm text-slate-500"><span className="w-4 h-4">👤</span><span>{jd.employee_name || '—'}</span></div>
                    <div className="flex items-center gap-2 text-sm text-slate-400"><span className="w-4 h-4">📅</span><span>{formatDate(jd.uploaded_at)}</span></div>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button onClick={() => handlePreview(jd.id)} className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-50 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 transition-all border border-slate-200">
                      <Eye className="w-4 h-4" />View
                    </button>
                    <button onClick={() => handleDownloadFromJD(jd)} className="flex items-center justify-center gap-2 px-3 py-2.5 bg-slate-50 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 transition-all border border-slate-200">
                      <Download className="w-4 h-4" />
                    </button>
                    {jd.processing_status !== 'published' && (
                      <button onClick={() => handlePublish(jd.id)} disabled={publishingId === jd.id}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all disabled:opacity-50">
                        {publishingId === jd.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-start justify-center p-4 pt-8 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl relative">
            <div className="sticky top-0 flex items-center justify-between p-5 border-b border-slate-200 bg-white rounded-t-2xl z-10">
              <h3 className="text-lg font-semibold text-slate-900">JD Preview — Employee Dashboard View</h3>
              <button onClick={() => { setShowPreview(false); setPreviewData(null) }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="p-6 max-h-[80vh] overflow-y-auto">
              {loadingPreview ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
              ) : previewData?.jd_structured ? (
                <PdfDocumentView data={previewData.jd_structured} roleTitle={previewData.reference_data?.role_title} dept={previewData.reference_data?.department} />
              ) : (
                <p className="text-slate-500 text-center py-10">No preview data available</p>
              )}
            </div>
            {previewData && (
              <div className="sticky bottom-0 p-5 border-t border-slate-200 bg-slate-50 rounded-b-2xl flex gap-3">
                <button onClick={() => previewData.jd_structured && downloadJDPdfClient(previewData.jd_structured, previewData.reference_data?.role_title, previewData.reference_data?.department)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                  <Download className="w-4 h-4" />Download PDF
                </button>
                {previewData.reference_data?.processing_status !== 'published' && (
                  <button onClick={() => { handlePublish(previewData.reference_data?.id); setShowPreview(false); setPreviewData(null) }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all shadow-sm">
                    <Send className="w-4 h-4" />Publish to Employee Dashboard
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
