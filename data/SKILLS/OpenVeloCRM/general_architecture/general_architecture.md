# SKILL: OpenVeloCRM Architecture & System Overview

## Core Philosophy
OpenVeloCRM is a **Metadata-Driven Application**. Instead of writing boilerplate code (e.g., specific controllers, React components, or SQL migrations) for every new feature or entity, the system relies on JSON metadata to dynamically generate the database schema, API routes, and frontend UI at runtime.

When instructed to modify or extend the system, always prioritize updating metadata files or generic systems rather than hardcoding entity-specific logic.

## Monorepo Structure
The project uses a standard monorepo structure with three main packages:
1. `packages/common`: Shared TypeScript interfaces and types.
2. `packages/backend`: Node.js + Express backend with Knex (SQLite).
3. `packages/frontend`: React frontend using Vite and React Router.

---

## How Things Are Wired Up

### 1. The Source of Truth: Metadata
All entity definitions live in `packages/backend/metadata/entities/<entityName>/`. This is the brain of the CRM.
- **`entity.json`**: Defines the database schema, including the table name, display names, and a `fields` array containing all columns, types, nullability, primary keys, and foreign keys.
- **`list.json`**: Defines the data-grid view (columns to display, sort, and filter).
- **`main.json`**: Defines the layout of the detailed view (Master Main Form), organized into Tabs -> Containers -> Columns -> Groups. Containers can also host **Subcomponents** (sublists/subgrids).
- **`quick-create.json`**: Defines the slide-out drawer used for rapid record creation.
- **`views/<viewName>.json`**: Defines customized views for related entity sub-grids or sub-lists.

System-level configurations (like the navigation menu) live in `packages/backend/metadata/system/`.

### 2. Database Auto-Migration (Backend)
There are **no manual database migration scripts**. 
When the backend starts, the `autoMigrator` runs automatically. It:
- Reads all `entity.json` files.
- Checks the current SQLite database schema using Knex.
- Automatically executes `CREATE TABLE` and `ALTER TABLE` commands to add new tables, add new columns, or rename existing columns (if a `previousName` is supplied).

### 3. Generic API Controllers (Backend)
Instead of having a controller for Accounts and another for Contacts, the backend uses a single `genericController`.
- Routes are structured generically: `GET /api/data/:entity`, `POST /api/data/:entity`, `PUT /api/data/:entity/:id`, etc.
- The controller dynamically queries the SQLite database based on the requested `:entity` parameter.

### 4. Dynamic Routing (Frontend)
You **do not** need to manually add routes for new entities.
- `useDynamicRoutes.tsx` fetches the list of available entities from the backend `EntityRegistry` on application load.
- It automatically maps `/<entity>` to the generic `MasterListForm` and `/<entity>/:id` to the generic `MasterMainForm`.

### 5. Master Forms (Frontend)
The frontend UI is completely generalized using Master components:
- **`MasterListForm`**: Fetches `list.json` metadata to render a dynamic table, complete with sorting, pagination, and bulk selection.
- **`MasterMainForm`**: Fetches `main.json` metadata to render the detailed view. It recursively renders Tabs, Containers (collapsible), Columns (always 3 columns), Groups, and finally generic field components.
- **`MasterSubList` / `MasterSubGrid`**: Components embedded within a container of the `MasterMainForm`. They render related entity records based on metadata from the `views/` directory. `MasterSubGrid` provides an instantly editable inline table that saves on blur.
- **`MasterQuickCreateForm`**: Fetches `quick-create.json` metadata to render a slide-out side drawer for rapidly creating a new record without navigating away from the current view.
- **Field Components**: E.g., `LookupField`, `TextField`, `DateField`. These components automatically bind to the underlying `react-hook-form` state.

## Business Logic Layer (BLL)
The Business Logic Layer is a **mandatory** component for every entity. It handles data interception (e.g., validating conditions before saving) and real-time field-level UI mutations.
- Logic is defined in pure JavaScript classes in `packages/backend/metadata/entities/<entityName>/<entityName>.js`.
- The backend dynamically loads and caches these files, executing static `onInit`, `onInsert`, `onUpdate`, `onDelete` hooks, and `<fieldName>_onValidate` for field-level validations.
- **Note:** Even if an entity requires no custom logic, this file must still exist and export an empty ES6 class.

## Golden Rules for AI Agents
1. **Never write hardcoded UI forms or API routes** for a specific entity. Everything must flow through the generic Master Forms and Generic Controllers.
2. **Never write static Knex migration files.** Define fields in `entity.json` and restart the backend.
3. **Always use UUIDs** for primary keys, named with the singular entity name + `Id` (e.g., `accountId`, `contactId`).
4. **Use `displayName`** in metadata for user-facing singular labels.
5. When modifying the structure of metadata, always ensure you update the validation schemas in `packages/backend/src/metadata/schemas.ts` and the types in `packages/common`.
