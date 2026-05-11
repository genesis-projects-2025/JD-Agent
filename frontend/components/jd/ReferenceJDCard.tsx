// frontend/components/jd/ReferenceJDCard.tsx
import { FileText, CheckCircle, Clock, Download, Search } from 'lucide-react'

interface ReferenceJDCardProps {
  jd: {
    id: string
    role_title: string
    department: string
    level: string
    structured_data: any
    uploaded_at: string
    pdf_filename?: string
  }
  onUseAsReference?: (jd: any) => void
  onViewDetails?: (jd: any) => void
  onDownloadPDF?: (jd: any) => void
}

export default function ReferenceJDCard({ jd, onUseAsReference, onViewDetails, onDownloadPDF }: ReferenceJDCardProps) {
  const { structured_data } = jd
  
  const handleViewDetails = () => {
    if (onViewDetails) {
      onViewDetails(jd)
    }
  }

  const handleDownloadPDF = () => {
    if (onDownloadPDF && jd.id) {
      onDownloadPDF(jd)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-all duration-200">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{jd.role_title}</h3>
            <p className="text-sm text-gray-500">{jd.department} • {jd.level}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full">
          <CheckCircle className="w-3 h-3" />
          <span>Active</span>
        </div>
      </div>

      {/* Purpose */}
      {structured_data?.purpose && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-3">
          {structured_data.purpose}
        </p>
      )}

      {/* Key Details */}
      <div className="space-y-3 mb-4">
        {structured_data?.skills && structured_data.skills.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Key Skills</h4>
            <div className="flex flex-wrap gap-1">
              {structured_data.skills.slice(0, 4).map((skill: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded"
                >
                  {skill}
                </span>
              ))}
              {structured_data.skills.length > 4 && (
                <span className="text-xs text-gray-400">
                  +{structured_data.skills.length - 4} more
                </span>
              )}
            </div>
          </div>
        )}

        {structured_data?.tools && structured_data.tools.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Tools</h4>
            <div className="flex flex-wrap gap-1">
              {structured_data.tools.slice(0, 3).map((tool: string, i: number) => (
                <span
                  key={i}
                  className="px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded"
                >
                  {tool}
                </span>
              ))}
              {structured_data.tools.length > 3 && (
                <span className="text-xs text-gray-400">
                  +{structured_data.tools.length - 3} more
                </span>
              )}
            </div>
          </div>
        )}

        {structured_data?.priority_tasks && structured_data.priority_tasks.length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-gray-500 mb-1">Critical Tasks</h4>
            <ul className="text-sm text-gray-600 space-y-1">
              {structured_data.priority_tasks.slice(0, 2).map((task: string, i: number) => (
                <li key={i} className="flex items-start gap-1">
                  <span className="text-blue-500 mt-0.5">•</span>
                  <span>{task}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
        <span className="text-xs text-gray-400">
          Created {new Date(jd.uploaded_at).toLocaleDateString()}
        </span>
        <div className="flex gap-2">
          {onViewDetails && (
            <button
              onClick={handleViewDetails}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-1"
            >
              View Full JD
            </button>
          )}
          {onDownloadPDF && (
            <button
              onClick={handleDownloadPDF}
              className="text-sm text-green-600 hover:text-green-700 font-medium px-3 py-1"
            >
              Download PDF
            </button>
          )}
          {onUseAsReference && (
            <button
              onClick={() => onUseAsReference(jd)}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium px-3 py-1"
            >
              Use as Reference
            </button>
          )}
        </div>
      </div>
    </div>
  )
}