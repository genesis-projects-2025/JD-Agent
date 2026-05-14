'use client'

import { useEffect, useState } from 'react'
import { Briefcase, FileText } from 'lucide-react'

import ReferenceJDCard from './ReferenceJDCard'
import { fetchEmployeeJDs, fetchJD, getCurrentUser } from '@/lib/api'
import { downloadJDPdfClient } from '@/lib/download-jd-pdf'
import type { ReferenceJDRecord } from '@/types/reference-jd'
import type { SessionDetail, SessionListItem } from '@/types/session'

interface ReferenceJDListProps {
  employeeId: string
  onUseReference?: (jd: ReferenceJDRecord) => void
}

function toReferenceJD(session: SessionDetail): ReferenceJDRecord {
  const structured = session.jd_structured ?? {}
  const employeeInfo = (structured.employee_information as Record<string, unknown> | undefined) ?? {}
  const identityContext =
    ((session.responses?.identity_context as Record<string, unknown> | undefined) ?? {})
  const roleTitle =
    String(
      structured.role_title ??
        structured.title ??
        employeeInfo.job_title ??
        session.title ??
        'Job Description',
    )
  const department =
    String(
      structured.department ??
        employeeInfo.department ??
        identityContext.department ??
        '',
    )
  const level = String(structured.experience_level ?? structured.level ?? 'Internal')

  return {
    id: session.id,
    role_title: roleTitle,
    department,
    level,
    employee_id: session.employee_id,
    employee_name: String(
      identityContext.employee_name ?? session.employee_id,
    ),
    processing_status: session.status,
    uploaded_at: session.updated_at,
    structured_data: structured,
  }
}

export default function ReferenceJDList({ employeeId, onUseReference }: ReferenceJDListProps) {
  const [jds, setJds] = useState<ReferenceJDRecord[]>([])
  const [loading, setLoading] = useState(true)
  const user = getCurrentUser()

  useEffect(() => {
    let active = true

    const load = async () => {
      try {
        const sessions = await fetchEmployeeJDs(employeeId)
        const referenceCandidates = sessions.filter((session: SessionListItem) =>
          ['approved', 'sent_to_manager', 'sent_to_hr'].includes(session.status),
        )

        const detailed = await Promise.all(
          referenceCandidates.slice(0, 6).map((session: SessionListItem) => fetchJD(session.id)),
        )

        if (!active) return
        setJds(detailed.map(toReferenceJD))
      } catch (error) {
        console.error('Failed to fetch employee reference JDs:', error)
        if (active) setJds([])
      } finally {
        if (active) setLoading(false)
      }
    }

    if (employeeId) {
      void load()
    }

    return () => {
      active = false
    }
  }, [employeeId])

  const handleViewDetails = (jd: ReferenceJDRecord) => {
    alert(`Viewing JD: ${jd.role_title}\n\n${JSON.stringify(jd.structured_data, null, 2)}`)
  }

  const handleDownloadPDF = (jd: ReferenceJDRecord) => {
    if (!jd.structured_data) {
      alert('No structured data available for this JD')
      return
    }
    downloadJDPdfClient(jd.structured_data, jd.role_title, jd.department)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    )
  }

  if (jds.length === 0) {
    return (
      <div className="py-8 text-center">
        <FileText className="mx-auto mb-3 h-12 w-12 text-gray-300" />
        <p className="text-sm text-gray-500">No employee-visible reference JDs available</p>
        {user?.role === 'admin' && (
          <p className="mt-1 text-sm text-blue-600">Publish JDs from the admin library first</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="mb-4 flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-gray-900">Reference JDs</h3>
        <span className="text-xs text-gray-400">({jds.length})</span>
      </div>

      <div className="space-y-4">
        {jds.map((jd) => (
          <ReferenceJDCard
            key={jd.id}
            jd={jd}
            onUseAsReference={onUseReference}
            onViewDetails={handleViewDetails}
            onDownloadPDF={handleDownloadPDF}
          />
        ))}
      </div>
    </div>
  )
}
