// app/data/repositories/mock/blobStore.ts
/**
 * Minimal IndexedDB-backed store for uploaded file bytes.
 *
 * Kept deliberately separate from the localStorage-based mock DB
 * (`mock-db-v1`), which only ever holds lightweight JSON metadata (name,
 * size, mimeType, etc. — see FileAsset). localStorage is capped around
 * 5-10MB *per origin, shared with every other record in the app*, and
 * `saveDb()` silently swallows quota errors — so embedding actual file
 * bytes (even base64-encoded) in that same blob would risk silently
 * breaking persistence for the entire app once the quota is hit.
 * IndexedDB has no such shared ceiling and stores Blob/File objects
 * natively (no base64 inflation), so it's a much better fit here.
 */

const DB_NAME = 'contract-manager-files'
const DB_VERSION = 1
const STORE_NAME = 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('El almacenamiento de archivos no está disponible en este navegador.'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir el almacenamiento de archivos.'))
  })
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(blob, id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar el archivo.'))
      tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar el archivo.'))
    })
  } finally {
    db.close()
  }
}

export async function getBlob(id: string): Promise<Blob | null> {
  const db = await openDb()
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const req = tx.objectStore(STORE_NAME).get(id)
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null)
      req.onerror = () => reject(req.error ?? new Error('No se pudo leer el archivo.'))
    })
  } finally {
    db.close()
  }
}

export async function deleteBlob(id: string): Promise<void> {
  return deleteBlobs([id])
}

export async function deleteBlobs(ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      for (const id of ids) store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('No se pudieron eliminar los archivos.'))
      tx.onabort = () => reject(tx.error ?? new Error('No se pudieron eliminar los archivos.'))
    })
  } finally {
    db.close()
  }
}

export async function clearAllBlobs(): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo limpiar el almacenamiento de archivos.'))
      tx.onabort = () => reject(tx.error ?? new Error('No se pudo limpiar el almacenamiento de archivos.'))
    })
  } finally {
    db.close()
  }
}