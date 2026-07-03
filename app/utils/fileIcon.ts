// app/utils/fileIcon.ts
/** Lucide icon name for a file's mimetype — used across file lists, evidence, hojas, etc. */
export function fileIcon(mime: string): string {
  if (mime.startsWith('image/')) return 'i-lucide-image'
  if (mime === 'application/pdf') return 'i-lucide-file-text'
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'i-lucide-table'
  if (mime.includes('word') || mime.includes('document')) return 'i-lucide-file-text'
  if (mime.startsWith('video/')) return 'i-lucide-video'
  return 'i-lucide-file'
}

/** Whether a mimetype can be previewed inline by FileViewerModal. */
export function isPreviewable(mime: string | null | undefined): boolean {
  return !!mime && (mime.startsWith('image/') || mime === 'application/pdf')
}