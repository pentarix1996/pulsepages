'use client'

interface PaginationProps {
  page: number
  limit: number
  totalCount: number
  onPageChange: (page: number) => void
  isLoading?: boolean
}

function getPagePills(page: number, totalPages: number): number[] {
  if (totalPages <= 5) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  if (page <= 3) {
    return [1, 2, 3, 4, 5]
  }
  if (page >= totalPages - 2) {
    return [totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
  }
  return [page - 2, page - 1, page, page + 1, page + 2]
}

export function Pagination({ page, limit, totalCount, onPageChange, isLoading }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit))
  const startItem = totalCount === 0 ? 0 : (page - 1) * limit + 1
  const endItem = Math.min(page * limit, totalCount)
  const pills = getPagePills(page, totalPages)

  const canGoPrev = page > 1
  const canGoNext = page < totalPages

  return (
    <div className="pagination-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)' }}>
        <button
          className="pagination-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={!canGoPrev || isLoading}
          aria-label="Previous page"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span style={{ marginLeft: 'var(--space-4)' }}>Prev</span>
        </button>

        {/* Desktop: page pills */}
        <div className="pagination-pills" style={{ display: 'flex', gap: 'var(--space-4)' }}>
          {pills.map((p) => (
            <button
              key={p}
              className={`pagination-btn ${p === page ? 'pagination-btn-active' : ''}`}
              onClick={() => onPageChange(p)}
              disabled={isLoading}
              aria-label={`Page ${p}`}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          className="pagination-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={!canGoNext || isLoading}
          aria-label="Next page"
        >
          <span style={{ marginRight: 'var(--space-4)' }}>Next</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      </div>

      <div className="pagination-status">
        {/* Mobile status */}
        <span className="pagination-status-mobile" style={{ display: 'none' }}>
          Page {page} of {totalPages}
        </span>
        {/* Desktop status */}
        <span className="pagination-status-desktop">
          {totalCount === 0 ? 'No incidents' : `Showing ${startItem}-${endItem} of ${totalCount} incidents`}
        </span>
      </div>
    </div>
  )
}
