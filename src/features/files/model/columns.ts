export interface ColumnOptions {
  permissions: boolean
}

export function fileGridTemplate(columns: ColumnOptions): string {
  return columns.permissions ? "minmax(0,1fr) 84px 128px 64px" : "minmax(0,1fr) 84px 128px"
}
