// frontend/app/admin/(dashboard)/jd-library/page.tsx
'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, CheckCircle, Loader2, Briefcase, Eye, X, FileTextIcon, Shield, Download, Send, ChevronDown, Target, Sparkles, AlertCircle, ArrowLeft, Plus, Trash2, Save } from 'lucide-react'
import { useAuth } from '@/components/providers/auth-provider'
import { getCookie, cookieKeys } from '@/lib/cookies'
import Link from 'next/link'
import { downloadJDPdfClient } from '@/lib/download-jd-pdf'
import { formatDateTime } from '@/lib/format-date'
import { PdfDocumentView } from '@/components/jd/pdf-document-view'
import {
  fetchAdminReferenceJDs,
  fetchAdminReferenceJDPreview,
  publishAdminReferenceJD,
} from '@/lib/api'
import type {
  ReferenceJDPreviewResponse,
  ReferenceJDRecord,
  ReferenceJDStructuredData,
} from '@/types/reference-jd'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function JDLibraryPage() {
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [results, setResults] = useState<Array<{
    file: string
    status: 'success' | 'error'
    message: string
    data?: {
      id: string
      role_title: string
      department: string
      employee_name: string
      uploaded_at: string
      processing_status: string
      ai_processed: boolean
    }
  }>>([])
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [jds, setJDs] = useState<ReferenceJDRecord[]>([])
  const [loadingJDs, setLoadingJDs] = useState(false)
  const router = useRouter()
  const { employeeId: authEmployeeId } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [activeTab, setActiveTab] = useState<'upload' | 'upload_kra' | 'library'>('upload')

  // Publish states
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set())

  // Preview modal
  const [previewData, setPreviewData] = useState<ReferenceJDPreviewResponse["data"] | null>(null)
  const [showPreview, setShowPreview] = useState(false)
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

  // KRA/KPI upload states
  const [kraFiles, setKraFiles] = useState<File[]>([])
  const [kraEmployeeId, setKraEmployeeId] = useState('')
  const [kraEmployeeName, setKraEmployeeName] = useState('')
  const [kraUploading, setKraUploading] = useState(false)
  const [currentKraFileIndex, setCurrentKraFileIndex] = useState(0)
  const [kraResults, setKraResults] = useState<Array<{
    file: string
    status: 'success' | 'error'
    message: string
    data?: {
      jd_session_id: string
      kra_kpi_session_id: string
      employee_id: string
      employee_name: string
      role_title: string
      department: string
      kras_count: number
    }
  }>>([])
  const kraFileInputRef = useRef<HTMLInputElement>(null)

  // KRA/KPI Paste modes and states
  const [kraInputMode, setKraInputMode] = useState<'file' | 'paste'>('file')
  const [kraPasteContent, setKraPasteContent] = useState('')
  const [kraAnalysisResult, setKraAnalysisResult] = useState<any | null>(null)
  const [analyzingKra, setAnalyzingKra] = useState(false)
  const [confirmingKra, setConfirmingKra] = useState(false)
  const [isEditingPreview, setIsEditingPreview] = useState(false)

  const handleUpdateKraField = (kraIdx: number, field: 'title' | 'description' | 'weight', value: any) => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    if (field === 'weight') {
      updatedKras[kraIdx] = { ...updatedKras[kraIdx], [field]: parseInt(value) || 0 }
    } else {
      updatedKras[kraIdx] = { ...updatedKras[kraIdx], [field]: value }
    }
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  const handleUpdateKpiField = (kraIdx: number, kpiIdx: number, field: 'title' | 'description', value: string) => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    const updatedKpis = [...(updatedKras[kraIdx].kpis || [])]
    updatedKpis[kpiIdx] = { ...updatedKpis[kpiIdx], [field]: value }
    updatedKras[kraIdx] = { ...updatedKras[kraIdx], kpis: updatedKpis }
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  const handleDeleteKra = (kraIdx: number) => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    updatedKras.splice(kraIdx, 1)
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  const handleAddKra = () => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    updatedKras.push({
      title: 'New KRA Goal',
      description: 'Describe this KRA goal',
      weight: 0,
      kpis: []
    })
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  const handleDeleteKpi = (kraIdx: number, kpiIdx: number) => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    const updatedKpis = [...(updatedKras[kraIdx].kpis || [])]
    updatedKpis.splice(kpiIdx, 1)
    updatedKras[kraIdx] = { ...updatedKras[kraIdx], kpis: updatedKpis }
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  const handleAddKpi = (kraIdx: number) => {
    if (!kraAnalysisResult) return
    const updatedKras = [...(kraAnalysisResult.kra_kpi?.kras || [])]
    const updatedKpis = [...(updatedKras[kraIdx].kpis || [])]
    updatedKpis.push({
      title: 'New KPI Metric',
      description: 'Describe the metric or target for this KPI'
    })
    updatedKras[kraIdx] = { ...updatedKras[kraIdx], kpis: updatedKpis }
    setKraAnalysisResult({
      ...kraAnalysisResult,
      kra_kpi: {
        ...kraAnalysisResult.kra_kpi,
        kras: updatedKras
      }
    })
  }

  // Missing JD Warning Modal States
  const [showMissingJdModal, setShowMissingJdModal] = useState(false)
  const [missingJdEmpDetails, setMissingJdEmpDetails] = useState<{ id: string; name: string } | null>(null)



  const handleAnalyzePaste = async () => {
    if (!kraEmployeeId || !kraEmployeeName || !kraPasteContent.trim()) {
      alert('Please fill in Employee ID, Employee Name, and paste raw KRA/KPA content')
      return
    }
    setAnalyzingKra(true)
    setKraAnalysisResult(null)
    try {
      const response = await fetch(`${API_URL}/admin/kra-kpi/analyze-paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`
        },
        body: JSON.stringify({
          employee_id: kraEmployeeId,
          employee_name: kraEmployeeName,
          content: kraPasteContent
        })
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.detail && typeof data.detail === 'object' && data.detail.code === 'MISSING_JD') {
          setMissingJdEmpDetails({ id: kraEmployeeId, name: kraEmployeeName })
          setShowMissingJdModal(true)
          return
        }
        let errMsg = 'Analysis failed'
        if (data.detail && typeof data.detail === 'object' && data.detail.message) {
          errMsg = data.detail.message
        } else if (typeof data.detail === 'string') {
          errMsg = data.detail
        }
        throw new Error(errMsg)
      }
      setKraAnalysisResult(data.data)
    } catch (error: any) {
      alert(error.message || 'Failed to analyze content')
    } finally {
      setAnalyzingKra(false)
    }
  }

  const handleConfirmPaste = async () => {
    if (!kraAnalysisResult) return
    setConfirmingKra(true)
    try {
      const response = await fetch(`${API_URL}/admin/kra-kpi/confirm-paste`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}`
        },
        body: JSON.stringify({
          employee_id: kraEmployeeId,
          employee_name: kraEmployeeName,
          jd: kraAnalysisResult.jd,
          kra_kpi: kraAnalysisResult.kra_kpi
        })
      })
      const data = await response.json()
      if (!response.ok) {
        if (data.detail && typeof data.detail === 'object' && data.detail.code === 'MISSING_JD') {
          setMissingJdEmpDetails({ id: kraEmployeeId, name: kraEmployeeName })
          setShowMissingJdModal(true)
          return
        }
        let errMsg = 'Confirmation failed'
        if (data.detail && typeof data.detail === 'object' && data.detail.message) {
          errMsg = data.detail.message
        } else if (typeof data.detail === 'string') {
          errMsg = data.detail
        }
        throw new Error(errMsg)
      }
      alert('KRA/KPI framework successfully confirmed and deployed to employee dashboard!')
      // Reset
      setKraPasteContent('')
      setKraAnalysisResult(null)
      setKraInputMode('file')
    } catch (error: any) {
      alert(error.message || 'Failed to save KRA/KPI framework')
    } finally {
      setConfirmingKra(false)
    }
  }

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
      const data = await fetchAdminReferenceJDs()
      setJDs(data.data || [])
    } catch (error) {
      console.error('Failed to fetch JDs:', error)
    } finally {
      setLoadingJDs(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files).filter(file =>
        file.type === 'application/pdf' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.type === 'application/msword'
      ))
      setResults([])
    }
  }

  const processFiles = async () => {
    if (files.length === 0 || !employeeId || !employeeName) {
      alert('Please select PDF/DOCX files and enter employee information')
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
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        uploadResults.push({ file: file.name, status: 'error' as const, message })
      }
    }
    setResults(uploadResults)
    setUploading(false)
    setFiles([])
    if (fileInputRef.current) fileInputRef.current.value = ''
    fetchJDs()
  }



  const handleKraFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setKraFiles(Array.from(e.target.files).filter(file =>
        file.type === 'application/pdf' ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        file.type === 'application/msword' ||
        file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        file.type === 'application/vnd.ms-excel' ||
        file.name.toLowerCase().endsWith('.xlsx') ||
        file.name.toLowerCase().endsWith('.xls')
      ))
      setKraResults([])
    }
  }

  const processKraFiles = async () => {
    if (kraFiles.length === 0 || !kraEmployeeId || !kraEmployeeName) {
      alert('Please select PDF/DOCX files and enter employee information')
      return
    }
    setKraUploading(true)
    setCurrentKraFileIndex(0)
    const uploadResults = []
    for (let i = 0; i < kraFiles.length; i++) {
      const file = kraFiles[i]
      setCurrentKraFileIndex(i + 1)
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('employee_id', kraEmployeeId)
        formData.append('employee_name', kraEmployeeName)
        const response = await fetch(`${API_URL}/admin/kra-kpi/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${getCookie(cookieKeys.ADMIN_TOKEN)}` },
          body: formData,
        })
        const data = await response.json()
        let errMsg = 'Upload failed'
        if (data.detail) {
          if (typeof data.detail === 'object' && data.detail.message) {
            errMsg = data.detail.message
          } else if (typeof data.detail === 'string') {
            errMsg = data.detail
          }
        }
        uploadResults.push({
          file: file.name,
          status: response.ok ? 'success' as const : 'error' as const,
          message: response.ok ? 'KRA/KPI document processed successfully' : errMsg,
          data: response.ok ? data.data : undefined,
          errorData: !response.ok ? data.detail : undefined,
        })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Upload failed'
        uploadResults.push({ file: file.name, status: 'error' as const, message })
      }
    }
    setKraResults(uploadResults)
    setKraUploading(false)
    setKraFiles([])
    if (kraFileInputRef.current) kraFileInputRef.current.value = ''

    const successfulResult = uploadResults.find(r => r.status === 'success')
    if (successfulResult && successfulResult.data) {
      setKraAnalysisResult(successfulResult.data)
      setKraResults([])
    } else {
      const failed = uploadResults.find(r => r.status === 'error')
      if (failed) {
        if (failed.errorData && typeof failed.errorData === 'object' && failed.errorData.code === 'MISSING_JD') {
          setMissingJdEmpDetails({ id: kraEmployeeId, name: kraEmployeeName })
          setShowMissingJdModal(true)
        } else {
          alert(failed.message || 'Processing failed')
        }
      }
    }
  }


  const handlePublish = async (jdId: string) => {
    setPublishingId(jdId)
    try {
      await publishAdminReferenceJD(jdId)
      setPublishedIds(prev => new Set(prev).add(jdId))
      fetchJDs()
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
      setPreviewData(await fetchAdminReferenceJDPreview(jdId))
    } catch {
      alert('Failed to load preview')
      setShowPreview(false)
    } finally {
      setLoadingPreview(false)
    }
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

      setIsEditingJD(false);
      alert("Job Description updated successfully!");
    } catch (err: any) {
      alert(err.message || "Failed to update Job Description");
    } finally {
      setSavingEditedJd(false);
    }
  };

  const handleDownloadFromResult = (resultData: { structured_data?: ReferenceJDStructuredData; role_title: string; department: string }) => {
    if (resultData?.structured_data) {
      downloadJDPdfClient(resultData.structured_data, resultData.role_title, resultData.department)
    }
  }

  const handleDownloadFromJD = (jd: ReferenceJDRecord) => {
    if (jd?.structured_data) {
      downloadJDPdfClient(jd.structured_data, jd.role_title, jd.department)
    }
  }

  const successCount = results.filter(r => r.status === 'success').length
  const errorCount = results.filter(r => r.status === 'error').length

  const formatDate = (dateStr: string) => formatDateTime(dateStr)

  return (
    <div className="w-full">
      {/* Tab Switcher */}
      <div className="flex items-center gap-1 mb-8 bg-slate-100 p-1.5 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('upload')}
          className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'upload' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >Upload JD</button>
        <button
          onClick={() => setActiveTab('upload_kra')}
          className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'upload_kra' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >Upload KRA/KPI</button>
        <button
          onClick={() => setActiveTab('library')}
          className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-all ${activeTab === 'library' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
        >Reference Library</button>
      </div>

      {activeTab === 'upload' && (
        <div className="max-w-3xl">
          {/* Upload Card */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-100"><Upload className="w-6 h-6 text-blue-600" /></div>
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Upload Job Descriptions</h2>
                <p className="text-slate-600 mt-1">Import and process JD PDFs and Docx using AI analysis</p>
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
                <label className="block text-sm font-medium text-slate-700 mb-2">Select Files (PDF or DOCX) *</label>
                <div className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${files.length > 0 ? 'border-blue-400 bg-blue-50/30' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'}`}
                  onClick={() => !uploading && fileInputRef.current?.click()}>
                  <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.doc" onChange={handleFileSelect} className="hidden" disabled={uploading} />
                  <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                  <p className="text-slate-600 text-sm">{files.length > 0 ? `${files.length} file(s) selected` : 'Click to browse or drag and drop'}</p>
                  <p className="text-slate-400 text-xs mt-1">Supported: PDF, DOCX, DOC | Maximum file size: 10MB</p>
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
                {results.map((result, index) => {
                  const resultData = result.data
                  return (
                    <div key={index} className={`p-5 rounded-xl border ${result.status === 'success' ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {result.status === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <X className="w-5 h-5 text-red-500" />}
                          <div>
                            <p className="font-medium text-slate-800">{result.file}</p>
                            <p className="text-sm text-slate-500">{result.message}</p>
                            {resultData?.role_title && <p className="text-sm text-blue-600 font-medium mt-1">Role: {resultData.role_title}</p>}
                          </div>
                        </div>
                      </div>
                      {result.status === 'success' && resultData && (
                        <div className="mt-4 pt-4 border-t border-slate-200 flex flex-wrap gap-3">
                          <button onClick={() => handlePreview(resultData.id)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                            <Eye className="w-4 h-4" />View JD
                          </button>
                          <button onClick={() => handleDownloadFromResult(resultData)}
                            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-all shadow-sm">
                            <Download className="w-4 h-4" />Download PDF
                          </button>
                          {publishedIds.has(resultData.id) ? (
                            <span className="flex items-center gap-2 px-4 py-2.5 bg-emerald-50 text-emerald-600 rounded-lg text-sm font-medium border border-emerald-200">
                              <CheckCircle className="w-4 h-4" />Published
                            </span>
                          ) : (
                            <button onClick={() => handlePublish(resultData.id)} disabled={publishingId === resultData.id}
                              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all shadow-sm disabled:opacity-50">
                              {publishingId === resultData.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                              {publishingId === resultData.id ? 'Publishing...' : 'Publish to Employee'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setResults([])} className="mt-4 text-sm text-slate-400 hover:text-slate-600">Clear Results</button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'upload_kra' && (
        <div className="max-w-6xl">
          {/* Input Mode Switcher */}
          <div className="flex gap-2 mb-6 bg-slate-100/80 p-1 rounded-xl w-fit border border-slate-200/50">
            <button
              onClick={() => { setKraInputMode('file'); setKraAnalysisResult(null); }}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${kraInputMode === 'file' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <FileText className="w-3.5 h-3.5" />
              File Upload Mode
            </button>
            <button
              onClick={() => { setKraInputMode('paste'); setKraResults([]); }}
              className={`px-4 py-2 text-xs font-medium rounded-lg transition-all flex items-center gap-2 ${kraInputMode === 'paste' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Paste Text Canvas
            </button>
          </div>

          {!kraAnalysisResult ? (
            <div className="max-w-3xl bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <div className="flex items-center gap-4 mb-8">
                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  {kraInputMode === 'file' ? <Upload className="w-6 h-6 text-indigo-600" /> : <Sparkles className="w-6 h-6 text-indigo-600" />}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">
                    {kraInputMode === 'file' ? 'Upload KRA/KPI Document' : 'KRA/KPI Paste Canvas'}
                  </h2>
                  <p className="text-slate-600 mt-1">
                    {kraInputMode === 'file' 
                      ? 'Import and parse existing employee KRA & KPI documents using AI analysis' 
                      : 'Paste raw KRA/KPA points directly to extract structure and deploy to employee dashboard'}
                  </p>
                </div>
              </div>

              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Employee ID *</label>
                    <input type="text" value={kraEmployeeId} onChange={(e) => setKraEmployeeId(e.target.value)} placeholder="e.g., EMP001"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" disabled={kraUploading || analyzingKra} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Employee Name *</label>
                    <input type="text" value={kraEmployeeName} onChange={(e) => setKraEmployeeName(e.target.value)} placeholder="e.g., John Manager"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all" disabled={kraUploading || analyzingKra} />
                  </div>
                </div>

                {kraInputMode === 'file' ? (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">Select Files (PDF, DOCX, or Excel) *</label>
                      <div className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${kraFiles.length > 0 ? 'border-indigo-400 bg-indigo-50/30' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'}`}
                        onClick={() => !kraUploading && kraFileInputRef.current?.click()}>
                        <input ref={kraFileInputRef} type="file" multiple accept=".pdf,.docx,.doc,.xlsx,.xls" onChange={handleKraFileSelect} className="hidden" disabled={kraUploading} />
                        <Upload className="w-10 h-10 mx-auto text-slate-400 mb-3" />
                        <p className="text-slate-600 text-sm">{kraFiles.length > 0 ? `${kraFiles.length} file(s) selected` : 'Click to browse or drag and drop'}</p>
                        <p className="text-slate-400 text-xs mt-1">Supported: PDF, DOCX, Excel (.xlsx / .xls) | Maximum file size: 10MB</p>
                      </div>
                    </div>
                    {kraFiles.length > 0 && (
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                        <h3 className="text-sm font-medium text-slate-700 mb-3">Selected Files:</h3>
                        <div className="space-y-2">
                          {kraFiles.map((file, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm text-slate-600 bg-white rounded-lg px-3 py-2 border border-slate-100">
                              <FileText className="w-4 h-4 text-indigo-500" /><span className="flex-1">{file.name}</span>
                              <span className="text-slate-400">{(file.size / 1024).toFixed(1)} KB</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    <button onClick={processKraFiles} disabled={kraUploading || kraFiles.length === 0 || !kraEmployeeId || !kraEmployeeName}
                      className={`w-full py-4 px-6 rounded-xl font-medium text-sm transition-all ${kraUploading || kraFiles.length === 0 || !kraEmployeeId || !kraEmployeeName ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200'}`}>
                      {kraUploading ? (<span className="flex items-center justify-center gap-3"><Loader2 className="w-5 h-5 animate-spin" />Processing {currentKraFileIndex} of {kraFiles.length}...</span>) : `Upload & Process KRA/KPI`}
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-slate-700">Paste KRA / KPA Text Canvas *</label>
                        <span className="text-xs text-slate-400">Pasted characters: {kraPasteContent.length}</span>
                      </div>
                      <textarea
                        value={kraPasteContent}
                        onChange={(e) => setKraPasteContent(e.target.value)}
                        placeholder="Paste your unstructured KRA/KPA content here... Examples:
- Focus on maintaining 99.9% system uptime
- Conduct weekly code reviews and mentor 3 junior engineers
- Deliver sprint items on time with under 2% bug leakage
- Standardize REST API integration and write OpenAPI schemas"
                        className="w-full min-h-[250px] p-5 bg-white border border-slate-200 rounded-xl text-slate-800 placeholder-slate-400 font-mono text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 shadow-inner resize-y transition-all"
                        disabled={analyzingKra}
                      />
                    </div>
                    <button
                      onClick={handleAnalyzePaste}
                      disabled={analyzingKra || !kraPasteContent.trim() || !kraEmployeeId || !kraEmployeeName}
                      className={`w-full py-4 px-6 rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 ${analyzingKra || !kraPasteContent.trim() || !kraEmployeeId || !kraEmployeeName ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-200'}`}
                    >
                      {analyzingKra ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          AI is analyzing raw text content...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-5 h-5" />
                          Analyze Paste & Preview KRAs/KPIs
                        </>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Paste Canvas Analysis Preview Panel */
            <div className="space-y-8">
              <div className="bg-slate-50 border border-slate-200 p-6 rounded-2xl flex items-center justify-between shadow-sm">
                <div>
                  <div className="flex items-center gap-2 text-indigo-700 font-semibold text-sm">
                    <Sparkles className="w-4 h-4 animate-pulse" />
                    Structured KRA/KPI AI Preview
                  </div>
                  <h2 className="text-xl font-bold text-slate-900 mt-1">
                    {kraAnalysisResult.jd?.role_title || 'Untitled Role'} — {kraAnalysisResult.jd?.department || 'General'}
                  </h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    For {kraEmployeeName} ({kraEmployeeId}) • Level: {kraAnalysisResult.jd?.level || 'Mid'}
                  </p>
                </div>
                <button
                  onClick={() => setKraAnalysisResult(null)}
                  className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm font-medium bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors shadow-sm"
                >
                  <ArrowLeft className="w-4 h-4" />
                  {kraInputMode === 'file' ? 'Back to Upload' : 'Edit Text Canvas'}
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Inferred Job Profile */}
                <div className="lg:col-span-1 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <h3 className="text-md font-semibold text-slate-900 border-b border-slate-100 pb-3 mb-4 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-500" />
                      Inferred Job Profile
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Role Summary</span>
                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{kraAnalysisResult.jd?.purpose}</p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Reports To</span>
                        <p className="text-sm text-slate-700 font-medium mt-0.5">{kraAnalysisResult.jd?.working_relationships?.reports_to || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Department</span>
                        <p className="text-sm text-slate-700 font-medium mt-0.5">{kraAnalysisResult.jd?.department || 'N/A'}</p>
                      </div>
                      <div>
                        <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Core Skills</span>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {kraAnalysisResult.jd?.skills?.slice(0, 8).map((skill: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600">{skill}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Structured KRAs & KPIs */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
                      <h3 className="text-md font-semibold text-slate-900 flex items-center gap-2">
                        <Target className="w-4 h-4 text-indigo-500" />
                        Key Result Areas (KRAs)
                      </h3>
                      {kraAnalysisResult.kra_kpi?.kras?.some((k: any) => k.weight) && (
                        <span className="text-xs font-semibold px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg">
                          Total Weight: {kraAnalysisResult.kra_kpi?.kras?.reduce((acc: number, item: any) => acc + (item.weight || 0), 0)}%
                        </span>
                      )}
                    </div>

                    {/* Weight distribution visualizer bar */}
                    {kraAnalysisResult.kra_kpi?.kras?.some((k: any) => k.weight) && (
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden flex mb-6">
                        {kraAnalysisResult.kra_kpi?.kras?.map((kra: any, idx: number) => {
                          const colors = ['bg-indigo-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-blue-500'];
                          const color = colors[idx % colors.length];
                          return (
                            <div
                              key={idx}
                              className={`${color} h-full`}
                              style={{ width: `${kra.weight || 20}%` }}
                              title={`${kra.title}: ${kra.weight}%`}
                            />
                          );
                        })}
                      </div>
                    )}

                    <div className="space-y-4">
                      {kraAnalysisResult.kra_kpi?.kras?.map((kra: any, idx: number) => (
                        <div key={idx} className="border border-slate-150 rounded-xl overflow-hidden shadow-sm bg-white hover:border-slate-200 transition-colors">
                          <div className="bg-slate-50/70 p-4 border-b border-slate-150 flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <span className="text-xs text-indigo-600 font-bold uppercase tracking-wider flex items-center gap-2">
                                KRA {idx + 1}
                                {isEditingPreview && (
                                  <button
                                    onClick={() => handleDeleteKra(idx)}
                                    type="button"
                                    className="text-red-500 hover:text-red-700 transition-colors ml-2"
                                    title="Delete KRA"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </span>
                              {isEditingPreview ? (
                                <input
                                  type="text"
                                  value={kra.title}
                                  onChange={(e) => handleUpdateKraField(idx, 'title', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-sm font-semibold text-slate-900 mt-1 focus:outline-none focus:border-indigo-500"
                                />
                              ) : (
                                <h4 className="text-sm font-semibold text-slate-900 mt-0.5">{kra.title}</h4>
                              )}
                            </div>
                            <div>
                              {isEditingPreview ? (
                                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 w-20">
                                  <input
                                    type="number"
                                    value={kra.weight ?? 0}
                                    onChange={(e) => handleUpdateKraField(idx, 'weight', e.target.value)}
                                    className="w-full bg-transparent text-xs text-center font-semibold text-indigo-700 outline-none"
                                    placeholder="Weight"
                                  />
                                  <span className="text-xs font-semibold text-slate-400 select-none">%</span>
                                </div>
                              ) : kra.weight ? (
                                <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-semibold text-indigo-700">
                                  Weight: {kra.weight}%
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="p-4 space-y-4">
                            <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Description</label>
                              {isEditingPreview ? (
                                <textarea
                                  value={kra.description}
                                  onChange={(e) => handleUpdateKraField(idx, 'description', e.target.value)}
                                  className="w-full bg-white border border-slate-200 rounded px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:border-indigo-500"
                                  rows={2}
                                />
                              ) : (
                                <p className="text-xs text-slate-500 leading-relaxed">{kra.description}</p>
                              )}
                            </div>
                            
                            <div className="border-t border-slate-100 pt-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Key Performance Indicators (KPIs)</span>
                                {isEditingPreview && (
                                  <button
                                    onClick={() => handleAddKpi(idx)}
                                    type="button"
                                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1"
                                  >
                                    <Plus className="w-3 h-3" />
                                    Add KPI
                                  </button>
                                )}
                              </div>
                              <div className="space-y-3 mt-2">
                                {(kra.kpis || []).map((kpi: any, kIdx: number) => (
                                  <div key={kIdx} className="bg-slate-50/50 p-3 rounded-lg border border-slate-100/50 text-xs relative group/kpi">
                                    {isEditingPreview && (
                                      <button
                                        onClick={() => handleDeleteKpi(idx, kIdx)}
                                        type="button"
                                        className="absolute top-2 right-2 text-slate-450 hover:text-red-500 transition-colors"
                                        title="Delete KPI"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {isEditingPreview ? (
                                      <div className="space-y-2 pr-6">
                                        <input
                                          type="text"
                                          value={kpi.title}
                                          onChange={(e) => handleUpdateKpiField(idx, kIdx, 'title', e.target.value)}
                                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-750 focus:outline-none focus:border-indigo-500"
                                          placeholder="KPI Title"
                                        />
                                        <textarea
                                          value={kpi.description}
                                          onChange={(e) => handleUpdateKpiField(idx, kIdx, 'description', e.target.value)}
                                          className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs text-slate-650 focus:outline-none focus:border-indigo-500"
                                          placeholder="KPI Description/Metric"
                                          rows={2}
                                        />
                                      </div>
                                    ) : (
                                      <>
                                        <div className="font-semibold text-slate-700">{kpi.title}</div>
                                        <div className="text-slate-500 mt-0.5">{kpi.description}</div>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}

                      {isEditingPreview && (
                        <button
                          onClick={handleAddKra}
                          type="button"
                          className="w-full py-4 border-2 border-dashed border-slate-250 hover:border-slate-350 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 flex items-center justify-center gap-2 transition-all"
                        >
                          <Plus className="w-4 h-4" />
                          Add KRA Goal
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-4">
                    <button
                      onClick={() => setKraAnalysisResult(null)}
                      className="flex-1 py-3 px-4 border border-slate-200 rounded-xl text-sm font-medium bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                    >
                      {kraInputMode === 'file' ? 'Cancel & Re-upload' : 'Cancel & Re-edit Text'}
                    </button>
                    <button
                      onClick={() => setIsEditingPreview(!isEditingPreview)}
                      type="button"
                      className="flex-1 py-3 px-4 border border-slate-200 rounded-xl text-sm font-medium bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                    >
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      {isEditingPreview ? 'Done Editing' : 'Edit Framework'}
                    </button>
                    <button
                      onClick={handleConfirmPaste}
                      disabled={confirmingKra}
                      className="flex-1 py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-sm font-medium shadow-md shadow-emerald-100 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                    >
                      {confirmingKra ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Saving to Employee Dashboard...
                        </>
                      ) : (
                        <>
                          <CheckCircle className="w-4 h-4" />
                          Approve & Deploy to Dashboard
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Results for document uploads */}
          {kraInputMode === 'file' && kraResults.length > 0 && (
            <div className="mt-8 bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-6">Processing Results</h2>
              <div className="space-y-4">
                {kraResults.map((result, index) => {
                  const resultData = result.data
                  return (
                    <div key={index} className={`p-5 rounded-xl border ${result.status === 'success' ? 'border-emerald-200 bg-emerald-50/30' : 'border-red-200 bg-red-50/30'}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {result.status === 'success' ? <CheckCircle className="w-5 h-5 text-emerald-500" /> : <X className="w-5 h-5 text-red-500" />}
                          <div>
                            <p className="font-medium text-slate-800">{result.file}</p>
                            <p className="text-sm text-slate-500">{result.message}</p>
                            {resultData && (
                              <div className="text-sm text-slate-600 mt-2 space-y-1 bg-white p-3 rounded-lg border border-slate-100">
                                <p><strong className="text-slate-700">Role:</strong> {resultData.role_title} ({resultData.department})</p>
                                <p><strong className="text-slate-700">Employee:</strong> {resultData.employee_name} ({resultData.employee_id})</p>
                                <p><strong className="text-slate-700">KRAs Imported:</strong> {resultData.kras_count}</p>
                                <p className="text-emerald-600 font-medium mt-1">✓ Dashboard JDSession & KRAKPISession confirmed and active.</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <button onClick={() => setKraResults([])} className="mt-4 text-sm text-slate-400 hover:text-slate-600">Clear Results</button>
            </div>
          )}
        </div>
      )}


      {activeTab === 'library' && (
        <div className="max-w-7xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">JD Reference Library</h2>
              <p className="text-slate-600 mt-1">Manage processed job descriptions</p>
            </div>
          </div>
          {loadingJDs ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
          ) : jds.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
              <FileTextIcon className="w-16 h-16 mx-auto text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-slate-700 mb-2">No Job Descriptions</h3>
              <p className="text-slate-500 text-sm">Upload JD PDFs or Word documents to build your reference library</p>
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
                <button onClick={() => { setShowPreview(false); setPreviewData(null); setIsEditingJD(false); }}
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
                <PdfDocumentView data={previewData.jd_structured} roleTitle={previewData.reference_data?.role_title} dept={previewData.reference_data?.department} />
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
              )
            )}
          </div>
        </div>
      )}

      {/* Missing JD Warning Modal */}
      {showMissingJdModal && missingJdEmpDetails && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-md relative p-6 space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-50 rounded-xl text-amber-600 border border-amber-100 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-semibold text-slate-900">Job Description Required</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Employee <strong className="text-slate-950">{missingJdEmpDetails.name}</strong> (<span className="font-mono text-xs text-indigo-600">{missingJdEmpDetails.id}</span>) does not have a prepared or approved Job Description (JD) yet.
                </p>
                <p className="text-sm text-slate-500 leading-relaxed">
                  You must upload or define a Job Description for this employee before their KRA & KPI framework can be uploaded or paste-confirmed.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowMissingJdModal(false);
                  setMissingJdEmpDetails(null);
                }}
                className="flex-1 py-2.5 px-4 border border-slate-200 rounded-xl text-sm font-medium bg-white text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowMissingJdModal(false);
                  setMissingJdEmpDetails(null);
                  setActiveTab('upload');
                  // Pre-fill fields in JD tab
                  setEmployeeId(missingJdEmpDetails.id);
                  setEmployeeName(missingJdEmpDetails.name);
                }}
                className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium shadow-md shadow-indigo-100 transition-all flex items-center justify-center gap-1.5"
              >
                Go to JD Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
