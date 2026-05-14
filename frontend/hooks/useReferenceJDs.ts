import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchAdminReferenceJDs } from '@/lib/api'

export function useReferenceJDs(enabled: boolean) {
  return useQuery({
    queryKey: ['reference-jds'],
    queryFn: fetchAdminReferenceJDs,
    enabled,
  })
}

export function useInvalidateReferenceJDs() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => true,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reference-jds'] })
    },
  })
}
