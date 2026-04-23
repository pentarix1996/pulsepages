'use client'

interface FilterState {
  projectId: string | null
  componentId: string | null
  dateFrom: string | null
  dateTo: string | null
}

interface FilterBarProps {
  projects: { id: string; name: string }[]
  componentNames: { name: string; projectCount: number }[]
  filters: FilterState
  onFilterChange: (filters: Partial<FilterState>) => void
  isLoading?: boolean
  showProjectSelect?: boolean
}

export function FilterBar({
  projects,
  componentNames,
  filters,
  onFilterChange,
  isLoading,
  showProjectSelect = true,
}: FilterBarProps) {
  const hasActiveFilters = Object.values(filters).some((v) => v !== null)

  const handleClearFilters = () => {
    onFilterChange({
      projectId: null,
      componentId: null,
      dateFrom: null,
      dateTo: null,
    })
  }

  return (
    <div className="filter-bar">
      <div className="filter-bar-controls">
        {showProjectSelect && (
          <select
            className="filter-select"
            value={filters.projectId || ''}
            onChange={(e) => onFilterChange({ projectId: e.target.value || null })}
            disabled={isLoading}
            aria-label="Filter by project"
          >
            <option value="">All Projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        )}

        <select
          className="filter-select"
          value={filters.componentId || ''}
          onChange={(e) => onFilterChange({ componentId: e.target.value || null })}
          disabled={isLoading}
          aria-label="Filter by component"
        >
          <option value="">All Components</option>
          {componentNames.map((comp) => (
            <option key={comp.name} value={comp.name}>
              {comp.name}
              {comp.projectCount > 1 && ` (${comp.projectCount} projects)`}
            </option>
          ))}
        </select>

        <div className="filter-date-range">
          <input
            type="date"
            className="date-input"
            value={filters.dateFrom || ''}
            onChange={(e) => onFilterChange({ dateFrom: e.target.value || null })}
            disabled={isLoading}
            aria-label="From date"
            placeholder="From"
          />
          <span className="date-separator">to</span>
          <input
            type="date"
            className="date-input"
            value={filters.dateTo || ''}
            onChange={(e) => onFilterChange({ dateTo: e.target.value || null })}
            disabled={isLoading}
            aria-label="To date"
            placeholder="To"
          />
        </div>

        {hasActiveFilters && (
          <button
            className="filter-clear-btn"
            onClick={handleClearFilters}
            disabled={isLoading}
            aria-label="Clear all filters"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
