# SKILL: BLL System API (General)

These methods leverage a real-time Server-Sent Events (SSE) socket connection to the user's browser, allowing you to instantly push toasts or halt execution for confirmation.

---

## 1. system.info(message: string)
**Purpose:** Dispatches a non-blocking "fire-and-forget" info toast to the user's UI.

This method instantly pushes a blue info toast to the top-right corner of the user's screen via SSE. It does **not** stop the execution of your BLL code. It is ideal for notifying the user of background progress or providing non-critical feedback.

**Example:**
```javascript
static async onInit(context) {
  // Instantly shows a toast to the user as soon as they click "New"
  context.system.info('Fetching default values from external service...');
  
  // Execution continues normally...
  context.record.amount = 100;
}
```

---

## 2. system.error(message: string)
**Purpose:** Throws a custom error, halts BLL execution, aborts the database transaction, and shows a red error toast to the user.

This method immediately stops the execution of the current hook. Any pending database changes for this request are canceled.

**Example:**
```javascript
static async amount_onValidate(context) {
  if (context.value < 0) {
    // Stops execution and shows a red error toast on the UI
    context.system.error('Amount cannot be negative.');
  }
  return { record: context.record };
}
```

---

## 3. system.confirm(message: string)
**Purpose:** Pauses BLL execution and prompts the user with a Yes/No modal. It returns a boolean `true` if the user clicks "Yes", and `false` if the user clicks "No".

This is a true-blocking asynchronous function. When you `await context.system.confirm()`, the Node.js execution pauses and sends a modal to the user's browser. Once the user clicks "Yes" or "No", the Promise resolves with the corresponding boolean value, and your BLL code resumes exactly where it left off.

*(Note: If the user ignores the prompt or closes the tab, the promise will automatically reject after 2 minutes to prevent memory leaks).*

**Example:**
```javascript
static async onUpdate(context) {
  // Check if a sensitive field is being changed
  if (context.record.status === 'Approved' && context.existing.status !== 'Approved') {
    
    // Pops a modal on the UI and waits for the user's response
    const isSure = await context.system.confirm('You are about to approve this record. Are you absolutely sure?');
    
    if (isSure) {
      context.system.info('Record approved.');
    } else {
      context.system.error('Approval cancelled.');
    }
  }
}
```
