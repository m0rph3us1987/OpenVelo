# SKILL: Sidepanel Navigation & System Metadata

## Overview
OpenVeloCRM uses a distinct separation between **Entity Metadata** (which defines database schemas and forms) and **System Metadata** (which defines global configurations like the navigation menu).

The left navigation sidebar is exclusively controlled by the system metadata file located at:
`packages/backend/metadata/system/sidepanel.json`

## Modifying the Navigation Menu
To add, remove, or reorder items in the sidebar, you must edit `sidepanel.json`. 
**Do not** look for `menuGroup` or `sortOrder` properties inside `entity.json` files; those have been deprecated and removed.

### The `sidepanel.json` Structure
The file defines an array of `groups`, each containing a `label` and an array of `items`.

**Example:**
```json
{
  "groups": [
    {
      "label": "Master Data",
      "items": [
        { "type": "entity", "entity": "accounts" },
        { "type": "entity", "entity": "contacts" }
      ]
    },
    {
      "label": "Sales",
      "items": [
        { "type": "entity", "entity": "invoices" }
      ]
    }
  ]
}
```

### Entity Linking
When an item is of `"type": "entity"`, the frontend's Sidebar component will dynamically fetch the display details (like `displayName` and `icon`) from the `EntityRegistry`.
- The `"entity"` property must match the exact directory name of the entity in `packages/backend/metadata/entities/<entityName>`.

### Orphaned Entities
If an entity is defined in the backend but **not** listed in `sidepanel.json`, it is considered an "Orphaned Entity".
- Orphaned entities will be completely **hidden** from the sidebar.
- However, their dynamic routes (e.g., `/<entityName>`) remain fully active and accessible via URL or programmatic navigation. This is useful for junction tables or sub-entities that shouldn't clutter the main menu.

## Applying Changes
After modifying `sidepanel.json`, simply refresh the frontend application in your browser. The frontend fetches the system metadata dynamically on load, so no backend restart is required just for sidepanel changes!
