import { gasCall, newId } from './gas'
import * as repo from './repo'
import { ensure, mutate, opCreate, opDelete, updateOp, byCreated, byCreatedDesc, type Row, type MutateOp } from './repo'
import { dataUrlParts, extForMime, forgetFile } from './files'
import { type Handler, str, num, notFound, badReq, pickFields, imagesOf, imageUrl } from './handlers-core'

const MAX_URL_LEN = 3_000_000
const withImages = (m: Row) => ({ ...m, images: imagesOf(m.id) })

// ------------------------------------------------------------------ materials
export const materials: Handler = async ({ method, query, body }) => {
  await ensure(['materials', 'materialImages'])
  if (method === 'GET') {
    const q = (query.get('q') ?? '').toLowerCase(), category = query.get('category') ?? ''
    const list = repo.where('materials', (m) =>
      m.active && (!category || m.category === category) &&
      (!q || [m.name, m.code, m.brand, m.specification].some((f) => String(f).toLowerCase().includes(q))))
      .sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)))
    return { materials: list.map(withImages) }
  }
  if (!body?.name || !body?.code) throw badReq('code and name required')
  if (repo.rows('materials').some((m) => String(m.code).toLowerCase() === str(body.code).toLowerCase())) throw badReq('Material code already exists')
  const res = await mutate([opCreate('materials', {
    code: str(body.code), category: str(body.category, 'Other'), name: str(body.name), brand: str(body.brand), model: str(body.model),
    specification: str(body.specification), size: str(body.size), unit: str(body.unit, 'Pcs'), packSize: num(body.packSize, 1),
    packUnit: str(body.packUnit, 'Pcs'), supplierId: str(body.supplierId), purchasePrice: num(body.purchasePrice), sellingPrice: num(body.sellingPrice),
    stockQty: num(body.stockQty), minStock: num(body.minStock),
  }, newId())], 'Add material')
  return { __status: 201, material: res.results[0].row }
}

export const materialById: Handler = async ({ method, body }, [id]) => {
  await ensure(['materials'])
  if (method === 'DELETE') {
    await mutate([updateOp('materials', id, { active: false })], 'Archive material')
    return { success: true }
  }
  const prev = repo.get('materials', id)
  if (!prev) throw notFound('Material not found')
  const data = pickFields(body, ['category', 'name', 'brand', 'model', 'specification', 'size', 'unit', 'packUnit', 'supplierId'],
    [['packSize', 0], ['purchasePrice', 0], ['sellingPrice', 0], ['stockQty', 0], ['minStock', 0]], ['active'])
  const ops: MutateOp[] = [updateOp('materials', id, data)]
  const newP = data.purchasePrice ?? prev.purchasePrice, newS = data.sellingPrice ?? prev.sellingPrice
  if (newP !== prev.purchasePrice || newS !== prev.sellingPrice) {
    ops.push(opCreate('priceHistory', { materialId: id, oldPurchase: prev.purchasePrice, newPurchase: newP, oldSelling: prev.sellingPrice, newSelling: newS, note: str(body.priceChangeNote, 'Price update') }, newId()))
  }
  const res = await mutate(ops, 'Update material')
  return { material: res.results[0].row }
}

// ------------------------------------------------------------------ material photos (Drive)
function checkDataUrl(url: string) {
  if (!url) throw badReq('url required')
  if (url.length > MAX_URL_LEN) throw badReq('Image too large (max ~2MB)')
  if (!/^data:image\/(jpeg|png|webp)/.test(url)) throw badReq('Only JPEG/PNG/WebP data URLs are accepted')
  const parts = dataUrlParts(url)
  if (!parts) throw badReq('Invalid image data')
  return parts
}
const asImage = (i: Row) => ({ ...i, url: imageUrl(i) })

export const materialImages: Handler = async ({ method, body }, [id]) => {
  await ensure(['materials', 'materialImages'])
  const material = repo.get('materials', id)
  if (!material) throw notFound('Material not found')
  if (method === 'GET') return { images: imagesOf(id) }
  const { mime, b64 } = checkDataUrl(str(body?.url))
  const res = await gasCall<{ file: Row; image: Row }>('file.upload', {
    category: 'Material_Images', name: `${material.code}-${Date.now().toString(36)}.${extForMime(mime)}`, data: b64,
    entityType: 'material', entityId: id, attach: { materialId: id, caption: str(body?.caption) },
  }, { write: true, label: 'Upload material photo', timeoutMs: 150_000 })
  repo.invalidate(['materialImages', 'files'])
  return { __status: 201, image: asImage(res.image) }
}

export const materialImageById: Handler = async ({ method, body, query }, [id, imageId]) => {
  await ensure(['materials', 'materialImages'])
  const material = repo.get('materials', id)
  if (!material) throw notFound('Material not found')
  const prev = repo.get('materialImages', imageId)
  if (!prev || prev.materialId !== id) throw notFound('Image not found')
  const siblings = () => repo.where('materialImages', (i) => i.materialId === id)

  if (method === 'DELETE') {
    const ops: MutateOp[] = [opDelete('materialImages', imageId)]
    const rest = siblings().filter((i) => i.id !== imageId)
    if (!rest.some((i) => i.isPrimary)) {
      const first = [...rest].sort((a, b) => (Number(a.isSample) - Number(b.isSample)) || (Number(b.isPrimary) - Number(a.isPrimary)) || (a.sortOrder - b.sortOrder))[0]
      if (first) ops.push(updateOp('materialImages', first.id, { isPrimary: true }))
    }
    await mutate(ops, 'Delete material photo')
    if (prev.fileId) forgetFile(prev.fileId)
    repo.invalidate(['files'])
    void query
    return { success: true }
  }

  // PATCH: replace photo / caption / primary
  let result: Row = prev
  if ('url' in body) {
    const { mime, b64 } = checkDataUrl(str(body.url))
    const res = await gasCall<{ image: Row }>('file.upload', {
      category: 'Material_Images', name: `${material.code}-${Date.now().toString(36)}.${extForMime(mime)}`, data: b64,
      entityType: 'material', entityId: id, attach: { materialId: id, replaceImageId: imageId, caption: 'caption' in body ? str(body.caption) : undefined },
    }, { write: true, label: 'Replace material photo', timeoutMs: 150_000 })
    if (prev.fileId) forgetFile(prev.fileId)
    repo.invalidate(['materialImages', 'files'])
    result = res.image
    await ensure(['materialImages'], { force: true })
  }
  const ops: MutateOp[] = []
  const data: Row = {}
  if ('caption' in body && !('url' in body)) data.caption = str(body.caption)
  if ('isPrimary' in body) data.isPrimary = body.isPrimary === true
  if (Object.keys(data).length) ops.push(updateOp('materialImages', imageId, data))
  if (data.isPrimary) for (const s of siblings()) if (s.id !== imageId && s.isPrimary) ops.push(updateOp('materialImages', s.id, { isPrimary: false }))
  if (ops.length) {
    await mutate(ops, 'Update material photo')
    result = repo.get('materialImages', imageId)!
  }
  // keep exactly one primary per material
  const after = siblings()
  if (!after.some((i) => i.isPrimary)) {
    const first = [...after].sort((a, b) => (Number(a.isSample) - Number(b.isSample)) || (a.sortOrder - b.sortOrder))[0]
    if (first) await mutate([updateOp('materialImages', first.id, { isPrimary: true })], 'Set primary photo')
  }
  return { image: asImage(repo.get('materialImages', imageId) ?? result) }
}

// ------------------------------------------------------------------ stock
export const stock: Handler = async ({ method, query, body }) => {
  if (method === 'POST') {
    const materialId = str(body?.materialId), quantity = num(body?.quantity, 0)
    if (!materialId || quantity <= 0) throw badReq('materialId & quantity required')
    const r = await repo.command<{ success: boolean; stockQty: number; clamped: boolean }>('stock.move', {
      materialId, type: str(body?.type, 'IN'), quantity, projectId: body?.projectId ? str(body.projectId) : '', reference: str(body?.reference), note: str(body?.note),
    }, ['materials', 'stockMovements'], 'Stock movement')
    return { __status: 201, success: true, stockQty: r.stockQty, clamped: r.clamped }
  }
  await ensure(['stockMovements', 'materials', 'materialImages', 'projects'])
  const materialId = query.get('materialId') ?? ''
  const mats = new Map(repo.rows('materials').map((m) => [m.id, m]))
  const prj = new Map(repo.rows('projects').map((p) => [p.id, p]))
  const movements = repo.where('stockMovements', (m) => !materialId || m.materialId === materialId).sort(byCreatedDesc).slice(0, 200).map((m) => {
    const mat = mats.get(m.materialId), p = m.projectId ? prj.get(m.projectId) : undefined
    return { ...m, projectId: m.projectId || null, material: mat ? { name: mat.name, code: mat.code, unit: mat.unit } : null, project: p ? { name: p.name, code: p.code } : null }
  })
  const list: Row[] = repo.where('materials', (m) => m.active).sort((a, b) => String(a.name).localeCompare(String(b.name))).map((m) => ({ ...m, images: imagesOf(m.id) }))
  return { movements, materials: list, lowStock: list.filter((m) => m.stockQty <= m.minStock) }
}

// ------------------------------------------------------------------ suppliers
export const suppliers: Handler = async ({ method, body }) => {
  await ensure(['suppliers', 'materials'])
  if (method === 'GET') {
    const counts: Record<string, number> = {}
    for (const m of repo.where('materials', (x) => x.active && x.supplierId)) counts[m.supplierId] = (counts[m.supplierId] ?? 0) + 1
    return { suppliers: [...repo.rows('suppliers')].sort((a, b) => String(a.name).localeCompare(String(b.name))).map((s) => ({ ...s, materialCount: counts[s.id] ?? 0 })) }
  }
  if (!body?.name) throw badReq('Supplier name required')
  const res = await mutate([opCreate('suppliers', { name: str(body.name), contactPerson: str(body.contactPerson), phone: str(body.phone), email: str(body.email), address: str(body.address), notes: str(body.notes) }, newId())], 'Add supplier')
  return { __status: 201, supplier: res.results[0].row }
}
export const supplierById: Handler = async ({ method, body }, [id]) => {
  await ensure(['suppliers', 'materials'])
  if (method === 'DELETE') {
    if (repo.rows('materials').some((m) => m.supplierId === id && m.active)) throw badReq('Supplier has linked materials; unlink first')
    await mutate([opDelete('suppliers', id)], 'Delete supplier')
    return { success: true }
  }
  const res = await mutate([updateOp('suppliers', id, pickFields(body, ['name', 'contactPerson', 'phone', 'email', 'address', 'notes']))], 'Update supplier')
  return { supplier: res.results[0].row }
}

void byCreated
