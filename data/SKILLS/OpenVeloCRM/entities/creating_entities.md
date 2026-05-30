# SKILL: Creating OpenVeloCRM Entities

## Overview
OpenVeloCRM is a fully metadata-driven application. This means you **do not** need to write frontend React views, backend API routes, or manual database migration scripts to create a new entity. 

Instead, everything is driven by JSON metadata files located in `packages/backend/metadata/entities/<entityName>/`.

When instructed to "Build a new entity XYZ", follow this standard operating procedure.

## Step-by-Step Implementation Guide

### 1. Create the Metadata Directory
Create a new directory for the entity in the backend metadata folder. Use plural, lowercase names for entities (e.g., `invoices`, `products`).
```bash
mkdir -p packages/backend/metadata/entities/<entityName>
```

### 2. Define `entity.json`
This is the core definition of the entity and its database schema.
Create `packages/backend/metadata/entities/<entityName>/entity.json`.

**Requirements:**
- `tableName`: The exact name of the table (usually the same as the entity name).
- `primaryKey`: The primary key field. **Rule: Primary keys must always be of type UUID, and the field is always named as the singular entity name + 'Id'. (e.g. `quoteId` for Quotes, `invoiceHeaderId` for InvoiceHeaders).**
- `displayName`: The **singular** display name of the entity used in the UI (e.g., "Invoice").
- `label`: The plural display name of the entity (e.g., "Invoices").
- `fields`: An array of `EntityFieldDefinition` objects. This completely replaces manual Knex migrations.
  - Types: `string`, `number`, `boolean`, `datetime`.
  - Properties: `name`, `type`, `required` (boolean), `primaryKey` (boolean), `unique` (boolean), `references` (for foreign keys).

*(Note: To add this entity to the sidebar, you must also update `packages/backend/metadata/system/sidepanel.json`. See the Sidepanel Navigation SKILL).*

**Example:**
```json
{
  "tableName": "invoices",
  "primaryKey": "invoiceId",
  "displayName": "Invoice",
  "label": "Invoices",
  "icon": null,
  "fields": [
    { "name": "invoiceId", "type": "string", "required": true, "primaryKey": true },
    { "name": "invoiceNumber", "type": "string", "required": true },
    { 
      "name": "accountId", 
      "type": "string", 
      "references": { "entity": "accounts", "field": "accountId", "onDelete": "SET NULL" } 
    },
    { "name": "totalAmount", "type": "number", "required": true }
  ],
  "joins": [],
  "hooks": {},
  "extensions": {}
}
```

### 3. Define Form Metadata
You must define three form metadata files to control the UI layout and behavior.

#### A. `list.json`
Controls the data grid / table view.
- Defines `displayFields`, `searchFields`, `sortableColumns`, and `filterableColumns`.

#### B. `main.json`
Controls the detail view (Master Main Form) when opening a record.
- Uses a hierarchical layout: `tabs` -> `containers`.
- Inside a container, you can define `columns` (strictly 3-columns) -> `groups` -> `fields`.
- **Alternatively**, a container can host a **subcomponent** to display related records (e.g. related contacts for an account). A subcomponent uses `type: "sublist"` (read-only) or `"subgrid"` (editable), and specifies an `"entity"`, a foreign key `"field"`, and a `"view"`.

#### C. `quick-create.json`
Controls the slide-out drawer used to quickly create a record.
- Usually contains a flat list of the most essential fields required to create the entity.

#### D. `views/` Directory (Optional)
If this entity acts as a child to another entity (e.g., Contacts belonging to an Account), you can define custom views in `packages/backend/metadata/entities/<entityName>/views/<viewName>.json`.
- These JSON files use the `"type": "view"` property and have a similar structure to `list.json` (`displayFields`, `sortableColumns`, `filterableColumns`, etc.).
- The foreign key column (e.g., `accountId`) **MUST** be included in the `list.json`'s `filterableColumns` array so the backend permits filtering by the parent record.

*Tip: Look at `packages/backend/metadata/entities/contacts/` or `packages/backend/metadata/entities/accounts/` for exact JSON structure templates for these forms.*

### 4. Define Business Logic Layer (Required)
Every entity **MUST** have a corresponding JavaScript file named after the entity inside the entity's metadata directory:
`packages/backend/metadata/entities/<entityName>/<entityName>.js`

This file must export an ES6 class containing static methods such as `onInit`, `onInsert`, `onUpdate`, `onDelete`, and field validation (e.g., `static async unitPrice_onValidate(context)`). Even if no custom logic is required, you must still create this file and export an empty class.

See the `SKILLS/OpenVeloCRM/business_logic/business_logic_layer.md` skill for the complete API and examples.

### 5. Database Migrations
**DO NOT WRITE MANUAL MIGRATION FILES.**
OpenVeloCRM features an `autoMigrator` that runs on backend startup. 
1. The migrator reads your `entity.json` -> `fields` array.
2. It automatically creates the table if it's missing.
3. It automatically adds any new columns if the schema changed.
4. *Note on Renames:* If you rename a field, you can set `"previousName": "oldFieldName"` in `entity.json`. The auto-migrator will rename the column in the DB and automatically run a find-and-replace across `main.json`, `list.json`, etc., to keep the frontend in sync!

### 6. Start / Restart the Backend
For the auto-migrator to detect the new entity and create the SQLite tables, simply restart the backend server.
```bash
npm run build --workspaces --if-present
node packages/backend/dist/index.js
```

### 7. Frontend Routing
You do **not** need to touch React Router. The frontend uses `useDynamicRoutes.tsx` which automatically queries the backend `EntityRegistry` and generates routes like `/<entityName>` and `/<entityName>/:id` on the fly. 

Once the backend boots up, the new entity will magically appear in the Sidebar and have fully functional List, Quick Create, and Main Detail views!
