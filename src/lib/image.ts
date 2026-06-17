/**
 * Downscale + re-encode an image File to a small square blob for use as an avatar.
 * Keeps stored avatars tiny (a 256px webp is a few KB) regardless of the source
 * photo, so uploads are fast and storage stays cheap. Center-crops to a square.
 */
export async function squareDownscale(file: File, size = 256): Promise<Blob> {
  const bitmap = await loadBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  if ('close' in bitmap) bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    // webp is broadly supported in evergreen browsers and ~30% smaller than jpeg.
    canvas.toBlob(resolve, 'image/webp', 0.85),
  )
  if (!blob) throw new Error('Could not encode image')
  return blob
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      /* fall through to the <img> path (e.g. Safari quirks) */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Could not read image'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
