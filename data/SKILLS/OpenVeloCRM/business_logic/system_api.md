# SKILL: BLL System API

## Overview
The `context.system` object inside any Business Logic Layer (BLL) hook provides powerful tools to interact with the database and communicate with the frontend UI in real-time.

To keep documentation clean, the System API has been broken down into two main categories.

## Categories

### 1. [Records API](./system_api/records.md)
The Records API enables Active Record-style CRUD operations and NAV 5-style data manipulation dynamically within your BLL code.
- `system.createRecord()`
- `system.getRecord()`
- `SmartRecord` methods: `setRange`, `setFilter`, `findSet`, `findFirst`, `next`, `insert`, `modify`, `delete`, etc.

### 2. [General API](./system_api/general.md)
The General API leverages Server-Sent Events (SSE) to push instant notifications, errors, and modal confirmations to the user's screen.
- `system.info()`
- `system.error()`
- `system.confirm()`
