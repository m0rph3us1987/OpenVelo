# SKILL: Business Logic Layer (BLL)

## Overview
OpenVeloCRM utilizes a dynamic Business Logic Layer (BLL) to handle data interception (Insert, Update, Delete) and real-time field-level UI validations (onBlur). This layer acts as a bridge between the frontend UI and the backend database, allowing developers to execute custom server-side logic via a strict convention-over-configuration design.

**The BLL is a mandatory component for every entity.** Even if an entity does not require custom logic, the BLL file must still exist and export an empty class.

The BLL relies on pure JavaScript files located directly within the entity's metadata directory.

## BLL File Location
For any given entity, its BLL code must be placed at:
`packages/backend/metadata/entities/<entityName>/<entityName>.js`

For example, for the `contacts` entity, the file would be `packages/backend/metadata/entities/contacts/contacts.js`.

This file is automatically loaded and cached by the backend's `bllRegistry.ts` during runtime.

## BLL Structure and Methods
The BLL file must export a **JavaScript class** containing specific static lifecycle and validation methods.

### 1. Lifecycle Methods
Lifecycle methods are triggered before the corresponding database operation. They can be used to mutate the data being inserted/updated, validate conditions, or trigger side effects.

- `static async onInit(context)`: Executed when a user clicks the "New" button in the UI. Used to initialize default values for a new record.
- `static async onInsert(context)`: Executed before a new record is created.
- `static async onUpdate(context)`: Executed before an existing record is updated.
- `static async onDelete(context)`: Executed before a record is deleted.

**The `context` object:**
```javascript
{
  entityName: string, // The name of the entity (e.g., 'invoices')
  record: Object,     // The data payload from the frontend (for init/insert/update) or the existing record (for delete)
  existing: Object,   // The existing record from the DB (for update/delete)
  system: Object      // The system API (getRecord, etc.)
}
```

### 2. Field-Level Validation (onValidate)
When a user modifies a field in the UI and the field loses focus (`onBlur`), the frontend automatically calls the backend validation API. 

The backend will look for a dynamically named **static method** in your BLL class using the exact convention:
`static async <fieldName>_onValidate(context)`

**Rules for Validation Methods:**
- **Naming:** Must strictly match `<fieldName>_onValidate` (e.g., if the database field is `unitPrice`, the function must be named `unitPrice_onValidate`).
- **Primary Keys:** You should **never** create a validation function for the primary key (Id) field of an entity.
- **State Mutation, Not Blocking:** `onValidate` functions are designed to perform state mutation in RAM (e.g., recalculating a `totalPrice` based on the new `unitPrice`). They do **not** prevent saving.
- **Return Value:** The function must return an object containing the mutated record (e.g., `{ record: context.record }`), which will then immediately update the form state on the screen.

**The validation `context` object:**
```javascript
{
  entityName: string,
  fieldName: string,
  value: any,                 // The new value of the field being blurred
  record: Object,             // The entire current state of the form
  existingValue: any,         // The value currently in the database
  existingRecord: Object|null, // The record currently in the database
  system: Object              // The system API (getRecord, etc.)
}
```

### 3. Smart Records (Active Record Pattern)
The `system` API allows you to fetch and instantiate **Smart Records** using familiar Dynamics NAV-style loop and filter constructs. A Smart Record is a JavaScript Proxy that wraps the database cursor/data and provides direct access to DB operations and custom BLL methods.

**Capabilities of a Smart Record:**
- **NAV 5-Style Filters & Cursors:** Use methods like `setRange`, `setFilter`, `setCurrentKey`, `findSet`, `next()`, `findFirst()`, `modify()`, `insert()`, etc.
- **Data Access:** Access database fields directly (e.g., `record.city`).
- **Validation:** Call `.validate(fieldName, value)` to trigger that entity's validation logic. This automatically mutates the record in memory.
- **Custom Methods:** Call any static method defined in that entity's BLL class directly on the record instance. The record itself is automatically passed as the first argument.

**Common Active Record Methods:**
- `system.createRecord(entityName)`: Creates an empty query/cursor builder object.
- `system.getRecord(entityName, id)`: Fetches an existing record by PK.
- `record.setRange(field, fromValue, toValue?)`: Sets a range filter.
- `record.setFilter(field, operator, value)`: Sets an SQL operator filter (e.g., `>`, `<`, `LIKE`).
- `record.setCurrentKey(fields, descending?)`: Sets the `ORDER BY` dynamically.
- `record.findFirst()`: Queries the DB and populates the record with the first match (Returns true if found).
- `record.findSet()`: Queries the DB and populates the cursor with all matches. Use `await record.next()` to iterate.
- `record.insert(runHooks)`: Inserts the record into the DB and runs `onInsert`.
- `record.modify(runHooks)`: Updates the record in the DB and runs `onUpdate`.
- `record.delete(runHooks)`: Deletes the record and runs `onDelete`.

## Example BLL with Smart Records

```javascript
// packages/backend/metadata/entities/contacts/contacts.js

class ContactsBLL {
  // Logic to pull address from account or create a new account on insert
  static async onInsert(context) {
    const { record, system } = context;

    if (!record.accountId) {
      // Create a brand new account using the Active Record pattern
      const newAccount = system.createRecord('accounts');
      await newAccount.init();
      newAccount.name = `${record.lastName} Household`;
      
      // Save it to the DB
      await newAccount.insert(true);
      
      // Link the contact to this new account
      record.accountId = newAccount.accountId;
      record.city = newAccount.city;
      
      system.info('Created a new default account for this contact.');
    } else if (!record.city && record.accountId) {
      // 1. Fetch the related Account as a Smart Record
      const account = await system.getRecord('accounts', record.accountId);

      if (account) {
        // 2. Trigger account validation logic manually (optional)
        await account.validate('name', record.lastName);

        // 3. Call a custom method defined in AccountsBLL
        if (typeof account.logAccess === 'function') {
          await account.logAccess('Contact Link');
        }

        // 4. Update the account via Active Record pattern
        account.lastAccessed = new Date().toISOString();
        await account.modify(true);

        // 5. Access data directly
        record.city = account.city;
        record.country = account.country;
      }
    }
  }

  // Example of using NAV-style looping
  static async onUpdate(context) {
    const { record, system } = context;
    if (record.status === 'Inactive') {
      let logs = system.createRecord('logs');
      logs.setRange('contactId', record.contactId);
      logs.setCurrentKey('createdAt', true); // Sort DESC

      if (await logs.findSet()) {
        do {
           logs.status = 'Archived';
           await logs.modify(true);
        } while (await logs.next() !== 0);
      }
    }
  }
}
```
