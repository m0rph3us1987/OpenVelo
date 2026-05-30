# SKILL: BLL System API (Records)

These methods allow you to interact with database records dynamically via an Active Record pattern heavily inspired by Dynamics NAV C/AL logic.

---

## 1. Instantiating Records

### `system.createRecord(entityName: string)`
**Purpose:** Returns a completely blank query builder / cursor for the specified entity.
This is the standard starting point when you want to build a query (`setRange`, `findSet`) or insert a brand new record from scratch.

### `system.getRecord(entityName: string, id: string)`
**Purpose:** Fetches a specific record by its Primary Key and returns it as a Smart Record. 

---

## 2. Filtering & Sorting

Use these methods on a Smart Record instance to prepare a query before calling `findSet()`, `findFirst()`, `modifyAll()`, etc.

### `record.setRange(field: string, fromValue: any, toValue?: any)`
**Purpose:** Filters the dataset to records where the field matches the exact value, or falls between `fromValue` and `toValue`.

### `record.setFilter(field: string, operator: string, value: any)`
**Purpose:** Applies a safe SQL operator filter. E.g., `record.setFilter('balance', '>', 1000)`.

### `record.setCurrentKey(fields: string | string[], descending?: boolean)`
**Purpose:** Modifies the `ORDER BY` clause for subsequent queries.

### `record.reset()`
**Purpose:** Clears all applied filters and sorting rules.

---

## 3. Reading Data (Cursors)

These methods hit the database using the applied filters.

### `record.findFirst()`
**Purpose:** Retrieves the first record matching the filters.
**Returns:** `Promise<boolean>` - `true` if a record was found, populating the current object.

### `record.findSet()`
**Purpose:** Executes the query and loads all matching records into an internal cursor state.
**Returns:** `Promise<boolean>` - `true` if at least one record was found.

### `record.next(steps?: number)`
**Purpose:** Moves the internal cursor forward (or backward if negative).
**Returns:** `Promise<number>` - The number of steps successfully moved. Returns `0` if it reached the end of the set.

**Example Loop:**
```javascript
let account = system.createRecord('accounts');
account.setRange('status', 'Active');
if (await account.findSet()) {
  do {
    // Process account...
  } while (await account.next() !== 0);
}
```

---

## 4. Writing Data

These methods apply changes to the database and automatically invoke the entity's BLL hooks (`onInsert`, `onUpdate`, `onDelete`).

### `record.init()`
**Purpose:** Executes the `onInit` BLL hook to populate default values before insertion.

### `record.insert(runTrigger: boolean = true)`
**Purpose:** Inserts the current object state into the database. Returns the newly saved record.

**Example:**
```javascript
let account = system.createRecord('accounts');
await account.init();
account.name = 'New Account';
await account.insert(true);
```

### `record.modify(runTrigger: boolean = true)`
**Purpose:** Updates the current record in the database using its Primary Key.

### `record.delete(runTrigger: boolean = true)`
**Purpose:** Deletes the current record from the database.

### `record.modifyAll(field: string, value: any, runTrigger?: boolean)`
**Purpose:** Modifies a specific field for **all** records matching the current filters.

### `record.deleteAll(runTrigger?: boolean)`
**Purpose:** Deletes **all** records matching the current filters.

---

## 5. Utilities

### `record.transferFields(fromRecord: SmartRecord, initPrimaryKey?: boolean)`
**Purpose:** Copies all fields from `fromRecord` into the current record.

### `record.validate(fieldName: string, value?: any)`
**Purpose:** Executes the BLL validation hook (`<fieldName>_onValidate`) for the specified field. The record is mutated in memory.

### `record.count()`
**Purpose:** Returns the total number of records matching the current filters.
