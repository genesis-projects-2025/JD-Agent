// frontend/components/jd/ReferenceJDList.tsx
'use client'

import { useEffect, useState } from 'react'
import { FileText, Briefcase, Users, CheckCircle } from 'lucide-react'
import ReferenceJDCard from './ReferenceJDCard'
import { useAuth } from '@/components/providers/auth-provider'
import { getCurrentUser } from '@/lib/api'
import { downloadJDPdfClient } from '@/lib/download-jd-pdf'

interface ReferenceJD {
  id: string
  role_title: string
  department: string
  level: string
  structured_data: any
  uploaded_at: string
  pdf_filename?: string
}

interface ReferenceJDListProps {
  employeeId: string
  onUseReference?: (jd: ReferenceJD) => void
}

export default function ReferenceJDList({ employeeId, onUseReference }: ReferenceJDListProps) {
  const [jds, setJDs] = useState<ReferenceJD[]>([])
  const [loading, setLoading] = useState(true)
  const { isAuthenticated } = useAuth()
  const user = isAuthenticated ? getCurrentUser() : null

  useEffect(() => {
    if (employeeId) {
      fetchJDs()
    }
  }, [employeeId])

  const fetchJDs = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
      const res = await fetch(`${apiUrl}/admin/jds/`, {
        headers: { 'Content-Type': 'application/json' }
      })
      if (res.ok) {
        const data = await res.json()
        setJDs(data.data || [])
      }
    } catch (error) {
      console.error('Failed to fetch reference JDs:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleViewDetails = (jd: ReferenceJD) => {
    // This would typically open a modal or navigate to a details page
    // For now, we'll just log it - in a real implementation, this would show a modal
    console.log('Viewing JD details:', jd)
    alert(`Viewing JD: ${jd.role_title}\n\n${JSON.stringify(jd.structured_data, null, 2)}`)
  }

  const handleDownloadPDF = (jd: ReferenceJD) => {
    if (jd.structured_data) {
      downloadJDPdfClient(jd.structured_data, jd.role_title, jd.department)
    } else {
      alert('No structured data available for this JD')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  if (jds.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3" />
        <p className="text-gray-500 text-sm">No reference JDs available</p>
        {user?.role === 'admin' && (
          <p className="text-blue-600 text-sm mt-1">
            Upload JDs in the JD Library
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Briefcase className="w-4 h-4 text-blue-600" />
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