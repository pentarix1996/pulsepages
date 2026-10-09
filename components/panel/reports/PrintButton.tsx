'use client'

import { Button } from '@/components/ui/Button'
import { DownloadIcon } from '@/components/ui/icons'

export function PrintButton() {
  return (
    <Button variant="primary" size="sm" icon={<DownloadIcon size={14} />} onClick={() => window.print()}>
      Print or save as PDF
    </Button>
  )
}
