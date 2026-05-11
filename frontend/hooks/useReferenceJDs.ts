// frontend/hooks/useReferenceJDs.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

async function fetchReferenceJDs(employeeId: string) {
  const res = await fetch(`/api/admin/jds/employee/${employeeId}/my-jds`)
  if (!res.ok) throw new Error('Failed to fetch reference JDs')
  return res.json()
}

async function deleteReferenceJD(jdId: string) {
  const res = await fetch(`/api/admin/jds/${jdId}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Failed to delete JD')
  return res.json()
}

export function useReferenceJDs(employeeId: string | null) {
  return useQuery({
    queryKey: ['reference-jds', employeeId],
    queryFn: () => fetchReferenceJDs(employeeId!),
    enabled: !!employeeId,
  })
}

export function useDeleteReferenceJD() {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: deleteReferenceJD,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reference-jds'] })
    },
  })
}
