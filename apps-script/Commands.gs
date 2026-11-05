/** File 7/10: Commands.gs — operations that must be atomic or need server-side numbering. */

var Commands = {
  // ---------------------------------------------------------------- stock
  stockMove: function (user, p) {
    if (['SUPER_ADMIN', 'INVENTORY'].indexOf(user.role) < 0) throw E.forbidden('Only INVENTORY or SUPER_ADMIN may move stock');
    var mat = Store.get('materials', String(p.materialId || ''));
    if (!mat) throw E.notFound('Material not found');
    var rec = sanitize_('stockMovements', {
      projectId: p.projectId || '', materialId: mat.id, type: p.type || 'IN', quantity: p.quantity,
      reference: p.reference || '', note: p.note || '', userName: user.name
    }, 'create');
    if (!(rec.quantity > 0)) throw E.validation('Quantity must be greater than zero');
    if (rec.projectId) Policy.assertProject(user, rec.projectId);
    var delta = rec.type === 'IN' || rec.type === 'RETURN' ? rec.quantity : -rec.quantity;
    var raw = mat.stockQty + delta, newQty = Math.max(0, raw);
    rec.id = uid_();
    try {
      Store.update('materials', mat.id, { stockQty: newQty });
      Store.insert('stockMovements', rec);
      pushAudit_(user, 'STOCK_' + rec.type, 'Material', mat.id, mat.code + ' ' + (delta >= 0 ? '+' : '') + delta + ' → ' + newQty);
      Store.commit();
    } catch (e) { Store.rollback(); throw e; }
    return { success: true, stockQty: newQty, clamped: raw < 0 };
  },

  // ---------------------------------------------------------------- quotations
  totals: function (items, discountType, discountValue, vatPct, otherCharges) {
    var n = function (v) { v = Number(v); return isFinite(v) ? v : 0; };
    var subtotal = items.reduce(function (a, i) { return a + n(i && i.lineTotal); }, 0);
    var discount = discountType === 'PERCENT' ? subtotal * n(discountValue) / 100 : n(discountValue);
    var after = subtotal - discount;
    var vat = after * n(vatPct) / 100;
    return {
      subtotal: round2_(subtotal),
      grandTotal: round2_(after + vat + n(otherCharges)),
      totalCost: round2_(items.reduce(function (a, i) { return a + n(i && i.totalCost); }, 0))
    };
  },
  parseItems: function (raw) {
    var items = typeof raw === 'string' ? (function () { try { return JSON.parse(raw); } catch (e) { throw E.validation('items must be valid JSON'); } })() : raw;
    if (!Array.isArray(items) || items.length > 3000) throw E.validation('items must be a list (max 3000 lines)');
    items.forEach(function (i) { if (!isObj_(i)) throw E.validation('each quotation line must be an object'); });
    return items;
  },
  uniqueQuotationNo: function (base) {
    var no = base, k = 1;
    while (Store.find('quotations', function (q) { return q.quotationNo.toLowerCase() === no.toLowerCase(); })) { k++; no = base + '-' + k; }
    return no;
  },

  quotationCreate: function (user, p) {
    Policy.assertRole(user, 'quotations', 'update');
    var project = Store.get('projects', String(p.projectId || ''));
    if (!project) throw E.notFound('Project not found');
    Policy.assertProject(user, project.id);
    var items = Commands.parseItems(p.items);
    var tot = Commands.totals(items, p.discountType, p.discountValue, p.vatPct, p.otherCharges);
    var now = new Date(), count = Store.filter('quotations', function (q) { return q.projectId === project.id; }).length;
    var base = p.quotationNo ? String(p.quotationNo) :
      'QT-' + project.code + '-' + String(now.getFullYear()).slice(2) + ('0' + (now.getMonth() + 1)).slice(-2) + '-' + ('00' + (count + 1)).slice(-3);
    var data = pick_(p, ['quotationType', 'revision', 'parentId', 'status', 'date', 'validUntil', 'discountType', 'discountValue', 'otherCharges',
      'otherChargesLabel', 'vatPct', 'paymentTerms', 'deliveryTerms', 'terms', 'notes']);
    data.projectId = project.id; data.items = JSON.stringify(items); data.subtotal = tot.subtotal; data.grandTotal = tot.grandTotal; data.totalCost = tot.totalCost;
    data.createdBy = user.name; data.date = data.date || now.toISOString().slice(0, 10);
    data.quotationNo = p.quotationNo ? base : Commands.uniqueQuotationNo(base);
    var rec = sanitize_('quotations', data, 'create');
    checkUnique_('quotations', rec, null);
    rec.id = uid_();
    try {
      if (rec.parentId) {
        var parent = Store.get('quotations', rec.parentId);
        if (!parent || parent.projectId !== project.id) throw E.validation('parentId is invalid');
        Store.update('quotations', parent.id, { status: 'REVISED' });
      }
      Store.insert('quotations', rec);
      if (['DRAFT', 'ESTIMATION', 'DESIGN_REVIEW'].indexOf(project.status) >= 0) Store.update('projects', project.id, { status: 'QUOTATION' });
      pushAudit_(user, 'CREATE_QUOTATION', 'Quotation', rec.id, rec.quotationNo + ' ৳' + rec.grandTotal);
      Store.commit();
    } catch (e) { Store.rollback(); throw e; }
    return { quotation: Policy.present(user, 'quotations', Store.get('quotations', rec.id)) };
  },

  quotationRevise: function (user, p) {
    Policy.assertRole(user, 'quotations', 'update');
    var src = Store.get('quotations', String(p.id || ''));
    if (!src) throw E.notFound('Quotation not found');
    Policy.assertProject(user, src.projectId);
    var items = Commands.parseItems(Store.expand('quotations', src).items);
    var kids = Store.filter('quotations', function (q) { return q.parentId === src.id; }).length + 1;
    var revision = p.revision !== undefined ? Math.round(Number(p.revision)) : src.revision + kids;
    var discountValue = p.discountValue !== undefined ? Number(p.discountValue) : src.discountValue;
    var otherCharges = p.otherCharges !== undefined ? Number(p.otherCharges) : src.otherCharges;
    var vatPct = p.vatPct !== undefined ? Number(p.vatPct) : src.vatPct;
    var tot = Commands.totals(items, src.discountType, discountValue, vatPct, otherCharges);
    var data = {
      projectId: src.projectId, quotationNo: Commands.uniqueQuotationNo(src.quotationNo + '-R' + revision), quotationType: src.quotationType,
      revision: revision, parentId: src.id, status: 'DRAFT', date: new Date().toISOString().slice(0, 10),
      validUntil: p.validUntil !== undefined ? p.validUntil : src.validUntil, items: JSON.stringify(items),
      subtotal: tot.subtotal, discountType: src.discountType, discountValue: discountValue, otherCharges: otherCharges,
      otherChargesLabel: src.otherChargesLabel, vatPct: vatPct, grandTotal: tot.grandTotal, totalCost: tot.totalCost,
      paymentTerms: src.paymentTerms, deliveryTerms: src.deliveryTerms, terms: src.terms,
      notes: p.notes !== undefined ? p.notes : src.notes, createdBy: user.name
    };
    var rec = sanitize_('quotations', data, 'create');
    rec.id = uid_();
    try {
      Store.insert('quotations', rec);
      Store.update('quotations', src.id, { status: 'REVISED' });
      pushAudit_(user, 'REVISE_QUOTATION', 'Quotation', rec.id, rec.quotationNo);
      Store.commit();
    } catch (e) { Store.rollback(); throw e; }
    return { quotation: Policy.present(user, 'quotations', Store.get('quotations', rec.id)) };
  }
};

// ====================================================================== integrity
var Integrity = {
  RELS: [
    ['floors', 'projectId', 'projects'], ['rooms', 'floorId', 'floors'], ['rooms', 'projectId', 'projects'],
    ['points', 'roomId', 'rooms'], ['points', 'projectId', 'projects'], ['fixtures', 'roomId', 'rooms'], ['fixtures', 'projectId', 'projects'],
    ['circuits', 'projectId', 'projects'], ['estimateItems', 'projectId', 'projects'], ['boqOverrides', 'projectId', 'projects'],
    ['drawings', 'projectId', 'projects'], ['drawings', 'fileId', 'files'], ['quotations', 'projectId', 'projects'],
    ['purchaseOrders', 'projectId', 'projects'], ['materialImages', 'materialId', 'materials'], ['priceHistory', 'materialId', 'materials'],
    ['stockMovements', 'materialId', 'materials']
  ],
  counts: function () {
    var out = {};
    Object.keys(SCHEMA).forEach(function (t) { out[t] = Store.count(t); });
    return out;
  },
  check: function (deep) {
    var issues = [], ids = {};
    Object.keys(SCHEMA).forEach(function (t) { ids[t] = {}; if (t !== 'auditLog') Store.all(t).forEach(function (r) { ids[t][r.id] = true; }); });
    Integrity.RELS.forEach(function (rel) {
      var bad = Store.all(rel[0]).filter(function (r) { return r[rel[1]] && !ids[rel[2]][r[rel[1]]]; });
      if (bad.length) issues.push({ type: 'ORPHAN', table: rel[0], column: rel[1], refers: rel[2], count: bad.length, sample: bad.slice(0, 3).map(function (r) { return r.id; }) });
    });
    var noImg = Store.all('materialImages').filter(function (r) { return !r.url && !(r.fileId && ids.files[r.fileId]); });
    if (noImg.length) issues.push({ type: 'IMAGE_WITHOUT_SOURCE', table: 'materialImages', count: noImg.length, sample: noImg.slice(0, 3).map(function (r) { return r.id; }) });
    var missing = [];
    if (deep) {
      Store.all('files').forEach(function (f) {
        if (f.status !== 'ACTIVE') return;
        try { var d = DriveApp.getFileById(f.driveFileId); if (d.isTrashed()) missing.push(f.id); } catch (e) { missing.push(f.id); }
      });
      if (missing.length) issues.push({ type: 'DRIVE_FILE_MISSING', table: 'files', count: missing.length, sample: missing.slice(0, 5) });
    }
    return { ok: issues.length === 0, issues: issues, counts: Integrity.counts(), missingFileIds: missing, checkedAt: nowIso_() };
  }
};

// ====================================================================== migration import
var Migration = {
  /** Import rows of one table, keeping original ids so relationships stay intact. Idempotent: existing ids are skipped. */
  importRows: function (user, p) {
    if (!Policy.isAdmin(user)) throw E.forbidden('Only SUPER_ADMIN may import data');
    var t = String(p.table || '');
    var allowed = ['company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory', 'projects', 'floors', 'rooms', 'points', 'fixtures',
      'circuits', 'estimateItems', 'boqOverrides', 'drawings', 'quotations', 'purchaseOrders', 'stockMovements'];
    if (allowed.indexOf(t) < 0) throw E.bad('Table ' + t + ' cannot be imported');
    var rows = p.rows;
    if (!Array.isArray(rows) || rows.length > 300) throw E.bad('rows[] required (max 300 per request)');
    var res = { table: t, created: 0, skipped: 0, errors: [] };
    Policy.reset();
    if (t === 'company' && rows.length) {   // singleton: the placeholder row made by setup() is replaced by the real company record
      var incoming = rows.map(function (r) { return r && r.id; });
      if (!Store.all('company').some(function (r) { return incoming.indexOf(r.id) >= 0; })) Store.all('company').slice().forEach(function (r) { Store.remove('company', r.id); });
    }
    rows.forEach(function (src) {
      var id = src && src.id;
      try {
        if (!validId_(id)) throw E.validation('invalid id');
        if (t === 'drawings') {
          var exists = Store.find('drawings', function (d) { return d.projectId === src.projectId && d.floorNumber === Number(src.floorNumber); });
          if (exists) { res.skipped++; return; }
          Files.saveDrawing(user, { projectId: src.projectId, floorNumber: src.floorNumber, data: src.data, scalePxPerMeter: src.scalePxPerMeter, calibrated: src.calibrated });
          res.created++; return;
        }
        if (Store.get(t, id)) { res.skipped++; return; }
        var rec = sanitize_(t, src, 'create');
        rec.id = id;
        if (SCHEMA[t].projectCol) { var pid = deriveProjectId_(user, t, rec); rec.projectId = pid; if (pid) { if (!Store.get('projects', pid)) throw E.validation('project ' + pid + ' not found'); } }
        assertFks_(t, rec);
        if (t === 'projects') { rec.ownerId = rec.ownerId || user.id; rec.driveFolderId = ''; try { rec.driveFolderId = Folders.createProject(rec.code, id); } catch (e) { logErr_('folder', e); } }
        if (t === 'materialImages' && typeof src.url === 'string' && src.url.indexOf('data:image/') === 0) {
          var m = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+\/=]+)$/.exec(src.url);
          if (!m) throw E.validation('unsupported image data');
          var created = [];
          var frow = Files.store(user, { category: 'Material_Images', name: id + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]), entityType: 'material', entityId: rec.materialId }, Utilities.base64Decode(m[2]), created);
          rec.fileId = frow.id; rec.url = '';
        } else if (t === 'materialImages' && rec.url && !/^(\/?images\/materials\/[A-Za-z0-9_.\-]+)$/.test(rec.url)) throw E.validation('unsupported image url');
        checkUnique_(t, rec, null);
        var createdAt = src.createdAt, updatedAt = src.updatedAt;
        if (typeof createdAt === 'string' && createdAt.length <= 40) rec.createdAt = createdAt;
        if (typeof updatedAt === 'string' && updatedAt.length <= 40) rec.updatedAt = updatedAt;
        Store.insertRaw(t, rec);
        res.created++;
      } catch (e) {
        res.errors.push({ id: id, message: e && e.message ? e.message : String(e) });
      }
    });
    pushAudit_(user, 'MIGRATION_IMPORT', t, '', 'created=' + res.created + ' skipped=' + res.skipped + ' errors=' + res.errors.length);
    Store.commit();
    return res;
  }
};
