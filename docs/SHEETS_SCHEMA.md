# Google Sheet structure (auto-generated from `apps-script/Config.gs`)

> Do not edit the sheet's header row, rename or reorder columns, and do not edit data by hand while people are using the app. All writes must go through the Apps Script gateway (it validates, checks permissions, bumps versions and writes the audit log).

Every tab starts with the system columns **id, createdAt, updatedAt, rev** (rev = revision counter used to detect two people editing the same record).

Role letters: A = SUPER_ADMIN, E = ENGINEER, S = SALES, I = INVENTORY, V = VIEWER. “project scope” = a row is only visible/changeable if the user is admin, the project owner, or listed in the project's members.

## Users  `(users)`

Read: A · Create: — · Update: — · Delete: — · unique: email

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| email | text | required; max 200 chars |
| name | text | required; max 120 chars |
| role | text | one of: SUPER_ADMIN / ENGINEER / SALES / INVENTORY / VIEWER; default "VIEWER" |
| passwordHash | text | max 300 chars; never sent to browser |
| active | TRUE/FALSE | default true |
| mustChange | TRUE/FALSE | default false |
| tokenVersion | integer | default 1; never sent to browser |
| lastLoginAt | text | max 40 chars |

## Company  `(company)`

Read: AESIV · Create: A · Update: A · Delete: —

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| name | text | default "My Company"; max 200 chars |
| logoText | text | max 200 chars |
| address | text | max 500 chars |
| phone | text | max 80 chars |
| email | text | max 200 chars |
| licenseNo | text | max 100 chars |
| vatRegNo | text | max 100 chars |
| quotationTerms | text | max 10000 chars |
| paymentTerms | text | max 5000 chars |
| deliveryTerms | text | max 5000 chars |

## DesignRules  `(designRules)`

Read: AESIV · Create: AE · Update: AE · Delete: A · unique: key

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| key | text | required; max 120 chars |
| value | text | max 500 chars |
| label | text | max 300 chars |
| system | text | default "general"; max 40 chars |

## Settings  `(settings)`

Read: AESIV · Create: AE · Update: AE · Delete: A

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| value | text | max 2000 chars |

## AuditLog  `(auditLog)`

Read: A · Create: — · Update: — · Delete: —

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| userId | text | max 60 chars |
| userName | text | max 120 chars |
| action | text | required; max 80 chars |
| entity | text | max 80 chars |
| entityId | text | max 80 chars |
| details | text | max 2000 chars |

## Projects  `(projects)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · unique: code · deletes also: floors.projectId, circuits.projectId, estimateItems.projectId, boqOverrides.projectId, drawings.projectId, quotations.projectId, purchaseOrders.projectId

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| code | text | required; max 60 chars |
| name | text | required; max 200 chars |
| clientName | text | max 200 chars |
| clientAddress | text | max 500 chars |
| clientPhone | text | max 80 chars |
| location | text | max 300 chars |
| buildingType | text | default "Apartment"; max 60 chars |
| supplyType | text | default "1-PHASE"; max 20 chars |
| totalFloors | integer | default 1; ≥ 0; ≤ 200 |
| occupants | integer | default 0; ≥ 0; ≤ 100000 |
| startDate | text | max 30 chars |
| estimationDate | text | max 30 chars |
| description | text | max 10000 chars |
| notes | text | max 10000 chars |
| status | text | one of: DRAFT / ESTIMATION / DESIGN_REVIEW / QUOTATION / APPROVED / COMPLETED; default "DRAFT" |
| isDemo | TRUE/FALSE | default false |
| archived | TRUE/FALSE | default false |
| unitLength | text | max 10 chars |
| unitArea | text | max 10 chars |
| ownerId | text | max 60 chars |
| members | text | max 2000 chars |
| driveFolderId | text | max 120 chars |

## Floors  `(floors)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope** · deletes also: rooms.floorId

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| floorNumber | integer | default 1; ≥ -10; ≤ 300 |
| name | text | required; max 120 chars |
| height | number | default 3.05; ≥ 0; ≤ 100 |
| area | number | default 0; ≥ 0; ≤ 100000000 |
| planFile | text | max 300 chars |

## Rooms  `(rooms)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope** · deletes also: points.roomId, fixtures.roomId

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | max 60 chars |
| floorId | text | required; max 60 chars; → floors.id |
| name | text | required; max 120 chars |
| roomType | text | default "Bedroom"; max 60 chars |
| length | number | default 0; ≥ 0; ≤ 100000 |
| width | number | default 0; ≥ 0; ≤ 100000 |
| height | number | default 3.05; ≥ 0; ≤ 100 |
| doorCount | integer | default 1; ≥ 0; ≤ 500 |
| windowCount | integer | default 0; ≥ 0; ≤ 500 |
| notes | text | max 5000 chars |

## ElectricalPoints  `(points)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | max 60 chars |
| roomId | text | required; max 60 chars; → rooms.id |
| pointType | text | required; max 60 chars |
| quantity | integer | default 1; ≥ 0; ≤ 100000 |
| location | text | max 300 chars |
| mountingHeight | number | default 2.7; ≥ 0; ≤ 100 |
| connectedLoadW | number | default 0; ≥ 0; ≤ 10000000 |
| specification | text | max 500 chars |
| notes | text | max 5000 chars |

## PlumbingFixtures  `(fixtures)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | max 60 chars |
| roomId | text | required; max 60 chars; → rooms.id |
| fixtureType | text | required; max 60 chars |
| quantity | integer | default 1; ≥ 0; ≤ 100000 |
| connectionType | text | default "Cold"; max 40 chars |
| pipeDiameter | text | max 40 chars |
| system | text | default "Cold Water"; max 40 chars |
| notes | text | max 5000 chars |

## Circuits  `(circuits)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| floorId | text | max 60 chars |
| floorName | text | max 120 chars |
| name | text | required; max 200 chars |
| circuitType | text | required; max 40 chars |
| phase | text | default "1P"; max 10 chars |
| loadW | number | default 0; ≥ 0; ≤ 1000000000 |
| designAmps | number | default 0; ≥ 0; ≤ 10000000 |
| breakerRating | text | max 40 chars |
| breakerType | text | default "MCB"; max 20 chars |
| rccb | TRUE/FALSE | default false |
| cableSize | text | max 60 chars |
| cableLength | number | default 0; ≥ 0; ≤ 100000000 |
| pointsCount | integer | default 0; ≥ 0; ≤ 1000000 |
| remarks | text | max 2000 chars |

## EstimateItems  `(estimateItems)`

Read: AESIV · Create: AE · Update: AE · Delete: AE · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| floorId | text | max 60 chars |
| floorName | text | max 120 chars |
| roomId | text | max 60 chars |
| roomName | text | max 120 chars |
| system | text | required; one of: ELECTRICAL / PLUMBING |
| category | text | required; max 80 chars |
| name | text | required; max 300 chars |
| brand | text | max 120 chars |
| specification | text | max 500 chars |
| size | text | max 80 chars |
| unit | text | default "Pcs"; max 30 chars |
| mode | text | one of: AUTO / DRAWING; default "AUTO" |
| qty | number | default 0; ≥ 0; ≤ 10000000000 |
| formula | text | max 1000 chars |
| assumptions | JSON text | default "[]" |
| wastagePct | number | default 0; ≥ 0; ≤ 1000 |
| sourceRef | text | max 300 chars |
| materialId | text | max 60 chars |

## BoqOverrides  `(boqOverrides)`

Read: AESIV · Create: AE · Update: — · Delete: A · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| itemKey | text | required; max 600 chars |
| qty | number | required; ≥ 0; ≤ 10000000000 |
| reason | text | max 1000 chars |
| userName | text | max 120 chars |

## Drawings  `(drawings)`

Read: AESIV · Create: — · Update: — · Delete: A · **project scope** · unique: projectId+floorNumber

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| floorNumber | integer | default 0; ≥ -10; ≤ 300 |
| fileId | text | max 120 chars |
| scalePxPerMeter | number | default 40; ≥ 0.0001; ≤ 10000000 |
| calibrated | TRUE/FALSE | default false |
| sizeBytes | integer | default 0 |
| sha256 | text | max 80 chars |
| bgFileId | text | max 60 chars |

## Materials  `(materials)`

Read: AESIV · Create: AEI · Update: AEI · Delete: AI · unique: code · deletes also: materialImages.materialId, priceHistory.materialId, stockMovements.materialId

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| code | text | required; max 80 chars |
| category | text | default "Other"; max 80 chars |
| name | text | required; max 300 chars |
| brand | text | max 120 chars |
| model | text | max 120 chars |
| specification | text | max 500 chars |
| size | text | max 80 chars |
| unit | text | default "Pcs"; max 30 chars |
| packSize | number | default 1; ≥ 0; ≤ 1000000000 |
| packUnit | text | default "Pcs"; max 30 chars |
| supplierId | text | max 60 chars |
| purchasePrice | number | default 0; ≥ 0; ≤ 10000000000 |
| sellingPrice | number | default 0; ≥ 0; ≤ 10000000000 |
| stockQty | number | default 0; ≥ 0; ≤ 10000000000 |
| minStock | number | default 0; ≥ 0; ≤ 10000000000 |
| active | TRUE/FALSE | default true |

## MaterialImages  `(materialImages)`

Read: AESIV · Create: AEI · Update: AEI · Delete: AEI

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| materialId | text | required; max 60 chars; → materials.id |
| url | text | max 500 chars |
| fileId | text | max 60 chars |
| isSample | TRUE/FALSE | default false |
| isPrimary | TRUE/FALSE | default false |
| caption | text | max 300 chars |
| sortOrder | integer | default 0; ≥ 0; ≤ 100000 |

## PriceHistory  `(priceHistory)`

Read: AESIV · Create: AEI · Update: — · Delete: —

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| materialId | text | required; max 60 chars; → materials.id |
| oldPurchase | number | default 0 |
| newPurchase | number | default 0 |
| oldSelling | number | default 0 |
| newSelling | number | default 0 |
| note | text | max 500 chars |
| changedBy | text | max 120 chars |

## Suppliers  `(suppliers)`

Read: AESIV · Create: AI · Update: AI · Delete: AI

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| name | text | required; max 200 chars |
| contactPerson | text | max 120 chars |
| phone | text | max 80 chars |
| email | text | max 200 chars |
| address | text | max 500 chars |
| notes | text | max 5000 chars |

## Quotations  `(quotations)`

Read: AESIV · Create: — · Update: AS · Delete: AS · **project scope** · unique: quotationNo

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| quotationNo | text | required; max 120 chars |
| quotationType | text | one of: ELECTRICAL / PLUMBING / COMBINED; default "COMBINED" |
| revision | integer | default 0; ≥ 0; ≤ 1000 |
| parentId | text | max 60 chars |
| status | text | one of: DRAFT / SENT / APPROVED / REJECTED / REVISED / EXPIRED; default "DRAFT" |
| date | text | max 30 chars |
| validUntil | text | max 30 chars |
| items | JSON text | default "[]" |
| subtotal | number | default 0 |
| discountType | text | one of: FLAT / PERCENT; default "FLAT" |
| discountValue | number | default 0; ≥ 0 |
| otherCharges | number | default 0; ≥ 0 |
| otherChargesLabel | text | max 200 chars |
| vatPct | number | default 0; ≥ 0; ≤ 100 |
| grandTotal | number | default 0 |
| totalCost | number | default 0 |
| paymentTerms | text | max 5000 chars |
| deliveryTerms | text | max 5000 chars |
| terms | text | max 10000 chars |
| notes | text | max 10000 chars |
| createdBy | text | max 120 chars |

## StockMovements  `(stockMovements)`

Read: AESIV · Create: — · Update: — · Delete: A · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | max 60 chars |
| materialId | text | required; max 60 chars; → materials.id |
| type | text | required; one of: IN / OUT / RETURN / WASTAGE |
| quantity | number | default 0; ≥ 0; ≤ 10000000000 |
| reference | text | max 200 chars |
| note | text | max 1000 chars |
| userName | text | max 120 chars |

## PurchaseOrders  `(purchaseOrders)`

Read: AESIV · Create: AEI · Update: AEI · Delete: AEI · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | required; max 60 chars; → projects.id |
| supplierId | text | max 60 chars |
| poNo | text | max 80 chars |
| status | text | one of: DRAFT / ORDERED / RECEIVED / CANCELLED; default "DRAFT" |
| items | JSON text | default "[]" |
| totalAmount | number | default 0 |
| note | text | max 2000 chars |

## Files  `(files)`

Read: AESIV · Create: — · Update: — · Delete: — · **project scope**

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| projectId | text | max 60 chars |
| floorId | text | max 60 chars |
| roomId | text | max 60 chars |
| entityType | text | max 40 chars |
| entityId | text | max 60 chars |
| category | text | required; one of: Drawings / Images / Documents / Reports / Material_Images |
| name | text | required; max 250 chars |
| mime | text | max 120 chars |
| sizeBytes | integer | default 0 |
| sha256 | text | max 80 chars |
| driveFileId | text | max 120 chars |
| mirrorId | text | max 120 chars |
| status | text | one of: ACTIVE / DELETED / MISSING; default "ACTIVE" |
| uploadedBy | text | max 120 chars |

## Backups  `(backups)`

Read: A · Create: — · Update: — · Delete: —

| Column | Type | Rules |
|---|---|---|
| id | text | primary key |
| createdAt / updatedAt | ISO time | set by server |
| rev | integer | +1 on every update |
| kind | text | max 20 chars |
| status | text | max 20 chars |
| driveFileId | text | max 120 chars |
| sizeBytes | integer | default 0 |
| sha256 | text | max 80 chars |
| tableCounts | JSON text | default "{}" |
| fileCount | integer | default 0 |
| missingFiles | integer | default 0 |
| startedAt | text | max 40 chars |
| finishedAt | text | max 40 chars |
| createdBy | text | max 120 chars |
| error | text | max 2000 chars |
| note | text | max 1000 chars |

## Files that are not rows

* **Drawings** — the editable drawing JSON (geometry, scale, layers, symbols, routes) is a file in Drive › Projects/<code>_<id>/Drawings; the `Drawings` row points to it through `fileId` (a `Files.id`).
* **Large values** — any text/JSON longer than 40 000 characters (a Sheets cell holds 50 000) is moved to Drive › System_Data/Blobs and the cell holds `@blob:<driveFileId>`; the gateway reads it back transparently.
