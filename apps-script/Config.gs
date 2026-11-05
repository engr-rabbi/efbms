/**
 * ElectroFlow BMS — Google Apps Script gateway
 * File 1/10: Config.gs  — constants, table schema, role policy.
 *
 * All files in this folder share one global scope (Apps Script V8). The order of
 * the files does not matter for function declarations, but `Config.gs` only
 * declares data, so it is safe wherever it sits.
 */

var APP = {
  NAME: 'ElectroFlow BMS',
  VERSION: '1.0.0',
  SCHEMA_VERSION: 1,
  TOKEN_TTL_SEC: 12 * 3600,          // session lifetime
  TOKEN_REFRESH_SEC: 6 * 3600,       // issue a fresh token when less than this remains
  MAX_REQUEST_CHARS: 18 * 1024 * 1024,
  MAX_BATCH_OPS: 1000,
  BLOB_THRESHOLD: 40000,             // a Sheets cell holds max 50,000 chars → larger values go to Drive
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024, // decoded size of one uploaded file
  PBKDF_ITERATIONS: 1000,
  RATE_LIMIT_PER_MIN: 240,           // authenticated requests / user / minute
  LOGIN_MAX_FAILS: 5,
  LOGIN_LOCK_SEC: 900,
  IDEMPOTENCY_TTL_SEC: 6 * 3600,     // CacheService maximum
  BACKUP_KEEP_SCHEDULED: 30,
  MIRROR_FILES_DEFAULT: true,
  ROLES: ['SUPER_ADMIN', 'ENGINEER', 'SALES', 'INVENTORY', 'VIEWER'],
  ROOT_FOLDER_NAME: 'Website_Data'
};

var ENUMS = {
  role: ['SUPER_ADMIN', 'ENGINEER', 'SALES', 'INVENTORY', 'VIEWER'],
  projectStatus: ['DRAFT', 'ESTIMATION', 'DESIGN_REVIEW', 'QUOTATION', 'APPROVED', 'COMPLETED'],
  system: ['ELECTRICAL', 'PLUMBING'],
  mode: ['AUTO', 'DRAWING'],
  quotationStatus: ['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'REVISED', 'EXPIRED'],
  quotationType: ['ELECTRICAL', 'PLUMBING', 'COMBINED'],
  discountType: ['FLAT', 'PERCENT'],
  stockType: ['IN', 'OUT', 'RETURN', 'WASTAGE'],
  poStatus: ['DRAFT', 'ORDERED', 'RECEIVED', 'CANCELLED'],
  fileCategory: ['Drawings', 'Images', 'Documents', 'Reports', 'Material_Images'],
  fileStatus: ['ACTIVE', 'DELETED', 'MISSING']
};

function fld_(name, type, o) {
  o = o || {};
  o.name = name;
  o.type = type; // s=string n=number i=integer b=boolean j=JSON string
  return o;
}
var S_ = function (n, o) { return fld_(n, 's', o); };
var N_ = function (n, o) { return fld_(n, 'n', o); };
var I_ = function (n, o) { return fld_(n, 'i', o); };
var B_ = function (n, o) { return fld_(n, 'b', o); };
var J_ = function (n, o) { return fld_(n, 'j', o); };

/**
 * Every table additionally gets the system columns: id, createdAt, updatedAt, rev.
 *  - sheet     : tab name in the Google Sheet
 *  - projectCol: true when rows carry a `projectId` used for row-level access control
 *  - fk        : hard foreign keys (validated on create, parent must exist)
 *  - children  : tables deleted together with this row ([table, column])
 *  - unique    : fields that must be unique
 *  - hidden    : fields never sent to the browser
 */
var SCHEMA = {
  users: {
    sheet: 'Users', unique: ['email'], hidden: ['passwordHash', 'tokenVersion'],
    fields: [
      S_('email', { req: 1, max: 200, lower: 1, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ }),
      S_('name', { req: 1, max: 120 }),
      S_('role', { enum: 'role', def: 'VIEWER' }),
      S_('passwordHash', { max: 300 }),
      B_('active', { def: true }),
      B_('mustChange', { def: false }),
      I_('tokenVersion', { def: 1 }),
      S_('lastLoginAt', { max: 40 })
    ]
  },
  company: {
    sheet: 'Company',
    fields: [
      S_('name', { def: 'My Company', max: 200 }), S_('logoText', { max: 200 }), S_('address', { max: 500 }),
      S_('phone', { max: 80 }), S_('email', { max: 200 }), S_('licenseNo', { max: 100 }), S_('vatRegNo', { max: 100 }),
      S_('quotationTerms', { max: 10000 }), S_('paymentTerms', { max: 5000 }), S_('deliveryTerms', { max: 5000 })
    ]
  },
  designRules: {
    sheet: 'DesignRules', unique: ['key'],
    fields: [S_('key', { req: 1, max: 120 }), S_('value', { max: 500 }), S_('label', { max: 300 }), S_('system', { def: 'general', max: 40 })]
  },
  settings: {
    sheet: 'Settings', customId: true,
    fields: [S_('value', { max: 2000 })]
  },
  auditLog: {
    sheet: 'AuditLog',
    fields: [S_('userId', { max: 60 }), S_('userName', { max: 120 }), S_('action', { req: 1, max: 80 }), S_('entity', { max: 80 }), S_('entityId', { max: 80 }), S_('details', { max: 2000 })]
  },
  projects: {
    sheet: 'Projects', unique: ['code'], projectCol: false,
    children: [['floors', 'projectId'], ['circuits', 'projectId'], ['estimateItems', 'projectId'], ['boqOverrides', 'projectId'],
               ['drawings', 'projectId'], ['quotations', 'projectId'], ['purchaseOrders', 'projectId']],
    fields: [
      S_('code', { req: 1, max: 60 }), S_('name', { req: 1, max: 200 }), S_('clientName', { max: 200 }), S_('clientAddress', { max: 500 }),
      S_('clientPhone', { max: 80 }), S_('location', { max: 300 }), S_('buildingType', { def: 'Apartment', max: 60 }),
      S_('supplyType', { def: '1-PHASE', max: 20 }), I_('totalFloors', { def: 1, min: 0, maxv: 200 }), I_('occupants', { def: 0, min: 0, maxv: 100000 }),
      S_('startDate', { max: 30 }), S_('estimationDate', { max: 30 }), S_('description', { max: 10000 }), S_('notes', { max: 10000 }),
      S_('status', { enum: 'projectStatus', def: 'DRAFT' }), B_('isDemo', { def: false }), B_('archived', { def: false }),
      S_('unitLength', { max: 10 }), S_('unitArea', { max: 10 }),
      S_('ownerId', { max: 60 }), S_('members', { max: 2000 }), S_('driveFolderId', { max: 120 })
    ]
  },
  floors: {
    sheet: 'Floors', projectCol: true, fk: { projectId: 'projects' }, children: [['rooms', 'floorId']],
    fields: [S_('projectId', { req: 1, max: 60 }), I_('floorNumber', { def: 1, min: -10, maxv: 300 }), S_('name', { req: 1, max: 120 }),
             N_('height', { def: 3.05, min: 0, maxv: 100 }), N_('area', { def: 0, min: 0, maxv: 1e8 }), S_('planFile', { max: 300 })]
  },
  rooms: {
    sheet: 'Rooms', projectCol: true, fk: { floorId: 'floors' }, children: [['points', 'roomId'], ['fixtures', 'roomId']],
    fields: [S_('projectId', { max: 60 }), S_('floorId', { req: 1, max: 60 }), S_('name', { req: 1, max: 120 }), S_('roomType', { def: 'Bedroom', max: 60 }),
             N_('length', { def: 0, min: 0, maxv: 1e5 }), N_('width', { def: 0, min: 0, maxv: 1e5 }), N_('height', { def: 3.05, min: 0, maxv: 100 }),
             I_('doorCount', { def: 1, min: 0, maxv: 500 }), I_('windowCount', { def: 0, min: 0, maxv: 500 }), S_('notes', { max: 5000 })]
  },
  points: {
    sheet: 'ElectricalPoints', projectCol: true, fk: { roomId: 'rooms' },
    fields: [S_('projectId', { max: 60 }), S_('roomId', { req: 1, max: 60 }), S_('pointType', { req: 1, max: 60 }), I_('quantity', { def: 1, min: 0, maxv: 100000 }),
             S_('location', { max: 300 }), N_('mountingHeight', { def: 2.7, min: 0, maxv: 100 }), N_('connectedLoadW', { def: 0, min: 0, maxv: 1e7 }),
             S_('specification', { max: 500 }), S_('notes', { max: 5000 })]
  },
  fixtures: {
    sheet: 'PlumbingFixtures', projectCol: true, fk: { roomId: 'rooms' },
    fields: [S_('projectId', { max: 60 }), S_('roomId', { req: 1, max: 60 }), S_('fixtureType', { req: 1, max: 60 }), I_('quantity', { def: 1, min: 0, maxv: 100000 }),
             S_('connectionType', { def: 'Cold', max: 40 }), S_('pipeDiameter', { max: 40 }), S_('system', { def: 'Cold Water', max: 40 }), S_('notes', { max: 5000 })]
  },
  circuits: {
    sheet: 'Circuits', projectCol: true, fk: { projectId: 'projects' },
    fields: [S_('projectId', { req: 1, max: 60 }), S_('floorId', { max: 60 }), S_('floorName', { max: 120 }), S_('name', { req: 1, max: 200 }), S_('circuitType', { req: 1, max: 40 }),
             S_('phase', { def: '1P', max: 10 }), N_('loadW', { def: 0, min: 0, maxv: 1e9 }), N_('designAmps', { def: 0, min: 0, maxv: 1e7 }),
             S_('breakerRating', { max: 40 }), S_('breakerType', { def: 'MCB', max: 20 }), B_('rccb', { def: false }), S_('cableSize', { max: 60 }),
             N_('cableLength', { def: 0, min: 0, maxv: 1e8 }), I_('pointsCount', { def: 0, min: 0, maxv: 1e6 }), S_('remarks', { max: 2000 })]
  },
  estimateItems: {
    sheet: 'EstimateItems', projectCol: true, fk: { projectId: 'projects' },
    fields: [S_('projectId', { req: 1, max: 60 }), S_('floorId', { max: 60 }), S_('floorName', { max: 120 }), S_('roomId', { max: 60 }), S_('roomName', { max: 120 }),
             S_('system', { enum: 'system', req: 1 }), S_('category', { req: 1, max: 80 }), S_('name', { req: 1, max: 300 }), S_('brand', { max: 120 }),
             S_('specification', { max: 500 }), S_('size', { max: 80 }), S_('unit', { def: 'Pcs', max: 30 }), S_('mode', { enum: 'mode', def: 'AUTO' }),
             N_('qty', { def: 0, min: 0, maxv: 1e10 }), S_('formula', { max: 1000 }), J_('assumptions', { def: '[]' }), N_('wastagePct', { def: 0, min: 0, maxv: 1000 }),
             S_('sourceRef', { max: 300 }), S_('materialId', { max: 60 })]
  },
  boqOverrides: {
    sheet: 'BoqOverrides', projectCol: true, fk: { projectId: 'projects' },
    fields: [S_('projectId', { req: 1, max: 60 }), S_('itemKey', { req: 1, max: 600 }), N_('qty', { req: 1, min: 0, maxv: 1e10 }), S_('reason', { max: 1000 }), S_('userName', { max: 120 })]
  },
  drawings: {
    sheet: 'Drawings', projectCol: true, fk: { projectId: 'projects' }, unique: ['projectId+floorNumber'],
    fields: [S_('projectId', { req: 1, max: 60 }), I_('floorNumber', { def: 0, min: -10, maxv: 300 }), S_('fileId', { max: 120 }),
             N_('scalePxPerMeter', { def: 40, min: 0.0001, maxv: 1e7 }), B_('calibrated', { def: false }), I_('sizeBytes', { def: 0 }), S_('sha256', { max: 80 }), S_('bgFileId', { max: 60 })]
  },
  materials: {
    sheet: 'Materials', unique: ['code'], children: [['materialImages', 'materialId'], ['priceHistory', 'materialId'], ['stockMovements', 'materialId']],
    fields: [S_('code', { req: 1, max: 80 }), S_('category', { def: 'Other', max: 80 }), S_('name', { req: 1, max: 300 }), S_('brand', { max: 120 }), S_('model', { max: 120 }),
             S_('specification', { max: 500 }), S_('size', { max: 80 }), S_('unit', { def: 'Pcs', max: 30 }), N_('packSize', { def: 1, min: 0, maxv: 1e9 }),
             S_('packUnit', { def: 'Pcs', max: 30 }), S_('supplierId', { max: 60 }), N_('purchasePrice', { def: 0, min: 0, maxv: 1e10 }), N_('sellingPrice', { def: 0, min: 0, maxv: 1e10 }),
             N_('stockQty', { def: 0, min: 0, maxv: 1e10 }), N_('minStock', { def: 0, min: 0, maxv: 1e10 }), B_('active', { def: true })]
  },
  materialImages: {
    sheet: 'MaterialImages', fk: { materialId: 'materials' },
    fields: [S_('materialId', { req: 1, max: 60 }), S_('url', { max: 500 }), S_('fileId', { max: 60 }), B_('isSample', { def: false }), B_('isPrimary', { def: false }),
             S_('caption', { max: 300 }), I_('sortOrder', { def: 0, min: 0, maxv: 100000 })]
  },
  priceHistory: {
    sheet: 'PriceHistory', fk: { materialId: 'materials' },
    fields: [S_('materialId', { req: 1, max: 60 }), N_('oldPurchase', { def: 0 }), N_('newPurchase', { def: 0 }), N_('oldSelling', { def: 0 }), N_('newSelling', { def: 0 }),
             S_('note', { max: 500 }), S_('changedBy', { max: 120 })]
  },
  suppliers: {
    sheet: 'Suppliers',
    fields: [S_('name', { req: 1, max: 200 }), S_('contactPerson', { max: 120 }), S_('phone', { max: 80 }), S_('email', { max: 200 }), S_('address', { max: 500 }), S_('notes', { max: 5000 })]
  },
  quotations: {
    sheet: 'Quotations', projectCol: true, fk: { projectId: 'projects' }, unique: ['quotationNo'],
    fields: [S_('projectId', { req: 1, max: 60 }), S_('quotationNo', { req: 1, max: 120 }), S_('quotationType', { enum: 'quotationType', def: 'COMBINED' }), I_('revision', { def: 0, min: 0, maxv: 1000 }),
             S_('parentId', { max: 60 }), S_('status', { enum: 'quotationStatus', def: 'DRAFT' }), S_('date', { max: 30 }), S_('validUntil', { max: 30 }), J_('items', { def: '[]' }),
             N_('subtotal', { def: 0 }), S_('discountType', { enum: 'discountType', def: 'FLAT' }), N_('discountValue', { def: 0, min: 0 }), N_('otherCharges', { def: 0, min: 0 }),
             S_('otherChargesLabel', { max: 200 }), N_('vatPct', { def: 0, min: 0, maxv: 100 }), N_('grandTotal', { def: 0 }), N_('totalCost', { def: 0 }),
             S_('paymentTerms', { max: 5000 }), S_('deliveryTerms', { max: 5000 }), S_('terms', { max: 10000 }), S_('notes', { max: 10000 }), S_('createdBy', { max: 120 })]
  },
  stockMovements: {
    sheet: 'StockMovements', projectCol: true, optionalProject: true, fk: { materialId: 'materials' },
    fields: [S_('projectId', { max: 60 }), S_('materialId', { req: 1, max: 60 }), S_('type', { enum: 'stockType', req: 1 }), N_('quantity', { def: 0, min: 0, maxv: 1e10 }),
             S_('reference', { max: 200 }), S_('note', { max: 1000 }), S_('userName', { max: 120 })]
  },
  purchaseOrders: {
    sheet: 'PurchaseOrders', projectCol: true, fk: { projectId: 'projects' },
    fields: [S_('projectId', { req: 1, max: 60 }), S_('supplierId', { max: 60 }), S_('poNo', { max: 80 }), S_('status', { enum: 'poStatus', def: 'DRAFT' }),
             J_('items', { def: '[]' }), N_('totalAmount', { def: 0 }), S_('note', { max: 2000 })]
  },
  files: {
    sheet: 'Files', projectCol: true, optionalProject: true,
    fields: [S_('projectId', { max: 60 }), S_('floorId', { max: 60 }), S_('roomId', { max: 60 }), S_('entityType', { max: 40 }), S_('entityId', { max: 60 }),
             S_('category', { enum: 'fileCategory', req: 1 }), S_('name', { req: 1, max: 250 }), S_('mime', { max: 120 }), I_('sizeBytes', { def: 0 }), S_('sha256', { max: 80 }),
             S_('driveFileId', { max: 120 }), S_('mirrorId', { max: 120 }), S_('status', { enum: 'fileStatus', def: 'ACTIVE' }), S_('uploadedBy', { max: 120 })]
  },
  backups: {
    sheet: 'Backups',
    fields: [S_('kind', { max: 20 }), S_('status', { max: 20 }), S_('driveFileId', { max: 120 }), I_('sizeBytes', { def: 0 }), S_('sha256', { max: 80 }), J_('tableCounts', { def: '{}' }),
             I_('fileCount', { def: 0 }), I_('missingFiles', { def: 0 }), S_('startedAt', { max: 40 }), S_('finishedAt', { max: 40 }), S_('createdBy', { max: 120 }),
             S_('error', { max: 2000 }), S_('note', { max: 1000 })]
  }
};

/** Tables included in a backup, in dependency order (parents first). */
var BACKUP_TABLES = ['users', 'company', 'designRules', 'settings', 'suppliers', 'materials', 'materialImages', 'priceHistory',
  'projects', 'floors', 'rooms', 'points', 'fixtures', 'circuits', 'estimateItems', 'boqOverrides', 'drawings',
  'quotations', 'purchaseOrders', 'stockMovements', 'files', 'auditLog'];

/**
 * Role policy. `read` = roles that may read the table at all; row-level project
 * scoping is applied on top (see Policy.gs). `write` lists roles per operation.
 */
var A_ = 'SUPER_ADMIN', E_ = 'ENGINEER', SA_ = 'SALES', IN_ = 'INVENTORY', V_ = 'VIEWER';
var ALL_ROLES = [A_, E_, SA_, IN_, V_];
var POLICY = {
  users:          { read: [A_],       write: { create: [], update: [], delete: [] } },        // only via users.* commands
  company:        { read: ALL_ROLES,  write: { create: [A_], update: [A_], delete: [] } },
  designRules:    { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_] } },
  settings:       { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_] } },
  auditLog:       { read: [A_],       write: { create: [], update: [], delete: [] } },
  projects:       { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  floors:         { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  rooms:          { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  points:         { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  fixtures:       { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  circuits:       { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  estimateItems:  { read: ALL_ROLES,  write: { create: [A_, E_], update: [A_, E_], delete: [A_, E_] } },
  boqOverrides:   { read: ALL_ROLES,  write: { create: [A_, E_], update: [], delete: [A_] } },
  drawings:       { read: ALL_ROLES,  write: { create: [], update: [], delete: [A_] } },       // saved via drawing.save
  materials:      { read: ALL_ROLES,  write: { create: [A_, E_, IN_], update: [A_, E_, IN_], delete: [A_, IN_] } },
  materialImages: { read: ALL_ROLES,  write: { create: [A_, E_, IN_], update: [A_, E_, IN_], delete: [A_, E_, IN_] } },
  priceHistory:   { read: ALL_ROLES,  write: { create: [A_, E_, IN_], update: [], delete: [] } },
  suppliers:      { read: ALL_ROLES,  write: { create: [A_, IN_], update: [A_, IN_], delete: [A_, IN_] } },
  quotations:     { read: ALL_ROLES,  write: { create: [], update: [A_, SA_], delete: [A_, SA_] } }, // create via quotation.* commands
  stockMovements: { read: ALL_ROLES,  write: { create: [], update: [], delete: [A_] } },            // create via stock.move
  purchaseOrders: { read: ALL_ROLES,  write: { create: [A_, E_, IN_], update: [A_, E_, IN_], delete: [A_, E_, IN_] } },
  files:          { read: ALL_ROLES,  write: { create: [], update: [], delete: [] } },            // via file.* commands
  backups:        { read: [A_],       write: { create: [], update: [], delete: [] } }
};

/** Settings keys a non-admin role may write. Everything else is SUPER_ADMIN only. */
var SETTINGS_WRITABLE_PREFIXES = ['units.'];
/** Cost fields hidden from VIEWER on the server (not only in the UI). */
var VIEWER_HIDDEN = { quotations: ['totalCost'], materials: [] };
