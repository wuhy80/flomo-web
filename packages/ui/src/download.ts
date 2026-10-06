/**
 * Browser-only file download.
 *
 * Used for the export buttons. It is a no-op without a DOM, which keeps
 * {@link FlomoApp} renderable on a server or in a test without a shim.
 *
 * @module @flomo/ui/download
 */

/**
 * Save a string to the user's downloads folder.
 * @param filename - the suggested name.
 * @param text - the file contents.
 * @param mimeType - the media type; charset is appended.
 * @returns whether a download was started.
 */
export function downloadText(
  filename: string,
  text: string,
  mimeType = 'text/plain',
): boolean {
  const doc = globalThis.document
  if (!doc) return false

  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = doc.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  doc.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next tick rather than immediately, so the click has
  // certainly been handed to the download manager first.
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
