# MUNHub — Registration Form Builder PRD

**Audience:** Claude Code / engineering agent  
**Scope:** Organizer Registration Form Builder  
**Primary platform:** Next.js `app/` + `lib/`  
**Parent feature:** Registration & Delegation Management

## 1. Objective

Build the complete **Registration Form Builder** for MUNHub organizers.

Organizers must be able to create and configure the form participants complete when registering for a specific MUN and registration type.

The result must be a real production form-builder experience, not a placeholder CRUD page.

Core capabilities:

- Create, edit, archive and reorder fields
- Required/optional fields
- Field validation
- Choice options
- Conditional visibility
- Registration-type-specific fields
- Preview
- Draft/published state
- Participant-facing rendering
- Server-side validation
- Persistent registration responses
- Historical response preservation

## 2. Current Codebase Reality

The production path is the **Next.js application**.

The existing backend already contains registration-form functionality for:

- Fields
- Reordering
- Conditional logic

The organizer Registration Form page is still a placeholder. The current status marks `REGISTRATION_FORM` as **PARTIAL**: backend exists, Next UI is incomplete. fileciteturn5file3L184-L198

The broader Registration & Delegation work is split into slices; Form Builder UI is one of the remaining slices. fileciteturn5file0L31-L40

### Critical rule

**Do not create a second form system.**

Inspect and extend the existing `lib/actions/registration-form.ts`, schema, validation, and response architecture.

Do not migrate this feature to Vite as part of this task. Next.js remains the working product until the planned SPA cutover. fileciteturn5file0L12-L27

---

## 3. Non-Goals

Do not implement:

- Delegation management
- Committee/portfolio allocation
- Waitlist
- Refund processing
- Real payment gateway
- Email delivery infrastructure
- Vite migration
- Go-Live pipeline replacement
- Analytics

Integrate with these systems where necessary, but do not rebuild them.

---

## 4. Product Model

Conceptually:

```text
MUN
 └── Registration Types
       └── Registration Form Configuration
             └── Form Fields
                   └── Participant Responses
```

A form belongs to one MUN.

Registration Types already exist and may include:

```text
Delegate
Reporter
Observer
Faculty
Custom
```

Different registration types may require different questions.

Example:

**Delegate**
- Full Name
- Email
- Phone
- Institution
- City
- Country
- MUN Experience
- Dietary Requirements

**Reporter**
- Full Name
- Email
- Phone
- Institution
- Publication / Media Organization
- Journalism Experience

Do not hard-code these forms.

---

# 5. Supported Field Types

At minimum:

```text
SHORT_TEXT
LONG_TEXT
EMAIL
PHONE
NUMBER
DATE
SELECT
RADIO
MULTI_SELECT
CHECKBOX
FILE
```

`FILE` should only be enabled if the existing storage/upload architecture safely supports it.

Do not introduce a new storage provider solely for the form builder.

---

# 6. Field Properties

A field should support, where applicable:

```text
id
type
label
description
placeholder
required
order
active
options
validation
conditionalRules
```

Example:

```text
Field
Institution Name

Type
Short text

Required
Yes

Placeholder
School / College / University

Description
Use the official institution name.
```

---

# 7. System Fields vs Custom Fields

Separate:

### System / identity fields

Examples:

- Name
- Email
- Phone

Inspect the existing user/profile/registration schema before duplicating these.

### Registration-specific fields

Examples:

- Institution
- MUN experience
- Dietary preference
- T-shirt size
- Emergency contact
- Previous conference experience

These should be stored as registration-specific responses where appropriate.

The same user may register for multiple MUNs and provide different answers.

---

# 8. Organizer UX

Recommended route:

```text
Organizer
→ MUN
→ Setup
→ Registration Form
```

Recommended layout:

```text
┌─────────────────────────────────────────────────────────┐
│ Registration Form                         [Preview]     │
│ Delegate Registration                                   │
│ 12 fields · Draft                                       │
├───────────────────────┬─────────────────────────────────┤
│ FIELD LIBRARY         │ FORM CANVAS                     │
│                       │                                 │
│ + Short text         │ Full Name                       │
│ + Long text          │ Email                           │
│ + Email              │ Institution                     │
│ + Phone              │ MUN Experience                  │
│ + Number             │                                 │
│ + Date               │ + Add field                     │
│ + Select             │                                 │
│ + Radio              │                                 │
│ + Multi-select       │                                 │
│ + Checkbox           │                                 │
│ + File               │                                 │
└───────────────────────┴─────────────────────────────────┘
```

The UI should feel like a modern operational form builder, not a generic admin CRUD screen.

---

# 9. Form Header

Show:

- Form name
- Registration type/context
- Field count
- Draft/published status
- Save state
- Preview
- Save

Example:

```text
Delegate Registration Form

12 fields
Draft

[Preview] [Save]
```

Avoid unnecessary analytics or decorative content.

---

# 10. Field Library

Provide a compact picker:

```text
Add field

Text
  Short text
  Long text

Contact
  Email
  Phone

Choice
  Select
  Radio
  Multi-select
  Checkbox

Other
  Number
  Date
  File
```

Clicking a type creates a field and immediately opens its editor.

---

# 11. Field Editor

Example:

```text
Institution Name

Field type
[ Short text ]

Label
[ Institution Name ]

Description
[ Enter your official institution name ]

Placeholder
[ School / College / University ]

Required
[ ON ]

Validation
[ None ▼ ]

Conditional logic
[ Add condition ]

[Delete / Archive field]
```

The editor must change based on field type.

---

# 12. Field-Specific Configuration

### Short text

- Minimum length
- Maximum length
- Optional pattern/regex if safely supported

### Long text

- Minimum length
- Maximum length

### Email

- Server-side email validation

### Phone

- Project-wide phone validation strategy
- Server-side validation

### Number

- Minimum
- Maximum
- Integer/decimal

### Date

- Minimum date
- Maximum date

### Select / Radio

Organizer can:

- Add option
- Edit option
- Remove option
- Reorder options

### Multi-select

- Minimum selections
- Maximum selections

### Checkbox

Useful for:

```text
I agree to the conference terms.
```

Support required state.

### File

If supported:

- Allowed file types
- Maximum size
- Required/optional

Validate file constraints server-side.

---

# 13. Reordering

Fields must be reorderable.

Example:

```text
1. Full Name
2. Email
3. Phone
4. Institution
5. Experience
```

Organizer changes order:

```text
1. Full Name
2. Institution
3. Email
4. Phone
5. Experience
```

Persist ordering server-side.

For accessibility, provide keyboard/button alternatives:

```text
↑ Move up
↓ Move down
```

---

# 14. Conditional Logic

The existing backend supports conditional logic. The UI must expose it cleanly.

Example:

```text
Have you attended an MUN before?
[ Yes / No ]
```

Rule:

```text
IF
Have you attended an MUN before?
=
Yes

THEN SHOW
How many MUNs have you attended?
```

Another example:

```text
IF
Registration type
=
Faculty

THEN SHOW
Number of students accompanying you
```

Keep the initial rule system simple.

Preferred operators:

```text
equals
not_equals
```

Only add more if the existing backend already supports them.

---

# 15. Conditional Logic Model

Conceptually:

```text
sourceField
operator
value
action
targetField
```

Example:

```text
source:
previous_mun_experience

operator:
equals

value:
YES

action:
SHOW

target:
number_of_muns
```

---

# 16. Conditional Logic Safety

Prevent:

- Self-reference
- Missing field references
- Cross-MUN references
- Invalid option values
- Circular dependencies

Invalid:

```text
A → B
B → C
C → A
```

Do not allow circular conditions.

If a field used by a condition is archived/deleted, surface the broken dependency and require repair before publishing.

---

# 17. Registration-Type-Specific Fields

Organizers should be able to configure field applicability.

Example:

```text
Publication Name

Shown for:

[x] Reporter
[ ] Delegate
[ ] Observer
[ ] Faculty
```

Use the existing Registration Type architecture.

If the backend already models this through eligibility/conditions, use that instead of adding duplicate schema.

The desired outcome is:

> Participants only answer questions relevant to their selected registration type.

---

# 18. Required Fields

Required validation must exist in:

### Client

For immediate feedback.

### Server

As the authoritative layer.

Never rely solely on HTML `required`.

A crafted request must not be able to submit an incomplete registration.

---

# 19. Server Validation

Before accepting registration responses, verify:

```text
MUN exists
+
registration type exists
+
registration type is active
+
field belongs to MUN
+
field applies to registration type
+
required fields are present
+
values match field types
+
values satisfy constraints
+
conditional rules are satisfied
```

Return structured errors.

Example:

```text
field: institution
code: REQUIRED
message: Institution is required.
```

---

# 20. Response Storage

Responses must belong to:

```text
Registration
+
Form Field
```

Do not associate registration answers only with a user.

Example:

```text
User: Aarav

MUN A
Institution: ABC School

MUN B
Institution: XYZ College
```

These must remain independent.

Inspect the existing response schema before making any database changes.

---

# 21. Historical Response Integrity

When an organizer changes a form:

**Do not silently destroy historical registration answers.**

Example:

```text
Old form:
T-shirt size

New form:
T-shirt size removed
```

Existing registrations must retain their historical response.

Prefer archiving/deactivating fields that already have responses rather than destructive deletion.

---

# 22. Draft vs Published

Support a safe distinction between:

```text
DRAFT
PUBLISHED
```

Draft changes should not unexpectedly break an active registration experience.

If the existing lifecycle has another equivalent mechanism, use the existing mechanism.

---

# 23. Publish Validation

Before publishing, validate:

- At least one usable registration type exists
- Required fields are valid
- Choice fields have options
- No broken conditional references
- No circular rules
- Conditional values are valid
- File constraints are valid
- All fields belong to the correct MUN

Example:

```text
Cannot publish form

3 issues need attention:

• Country has no options
• Previous MUNs references a deleted field
• Institution has an invalid maximum length
```

---

# 24. Preview

Provide a participant-facing preview using the same renderer as the real registration form wherever practical.

Example:

```text
Delegate Registration

Full Name
[________________]

Email
[________________]

Institution
[________________]

Have you attended an MUN before?
[ Yes ▼ ]

How many MUNs have you attended?
[________________]

[Continue]
```

Preview must demonstrate conditional behavior.

---

# 25. Participant Form Renderer

The real registration flow must be driven by the configured form.

Renderer flow:

```text
Load MUN
→ Load registration type
→ Resolve applicable fields
→ Render persisted order
→ Client validation
→ Conditional evaluation
→ Submit
→ Server validation
→ Save responses
```

Do not hard-code registration questions into the participant page.

---

# 26. Autosave

Autosave is optional for the first production implementation.

If implemented:

- Debounce writes
- Prevent stale writes overwriting newer data
- Show save state
- Handle failures
- Scope drafts to the correct registration/session

Explicit Save is acceptable if it fits the current registration architecture better.

---

# 27. Unsaved Changes

If the organizer has unsaved changes and navigates away:

```text
You have unsaved changes.

Leave without saving?

[Stay] [Leave]
```

Do not show this warning when there are no changes.

---

# 28. Delete / Archive

If a field has historical responses:

**Do not hard-delete its data.**

Prefer:

```text
active = false
```

or the existing archive semantics.

Show:

```text
This field has responses from existing registrations.

Removing it from the active form will not delete historical responses.
```

---

# 29. Stable Field IDs

Internal identifiers must be stable.

Example:

```text
institution_name
previous_mun_count
dietary_requirements
```

Do not use the visible label as the permanent identity.

If:

```text
Institution Name
```

becomes:

```text
School / College
```

historical responses must still point to the same field.

---

# 30. Server Actions / API

Reuse existing registration-form actions.

Potential operations:

```text
getRegistrationForm
createRegistrationField
updateRegistrationField
deleteOrArchiveRegistrationField
reorderRegistrationFields
updateFieldConditions
publishRegistrationForm
saveRegistrationForm
```

Names are illustrative.

Do not create duplicates if equivalent actions already exist.

Every mutation:

```text
Authentication
→ Authorization
→ MUN ownership
→ Input validation
→ Business validation
→ Database mutation
```

---

# 31. Authorization

An organizer can only manage forms for MUNs they are authorized to manage.

Explicitly protect:

```text
Organizer A
→ submits MUN B ID
→ attempts to edit MUN B form
```

This must fail server-side.

Do not trust route parameters, hidden inputs, or client state.

---

# 32. Database Rules

Before changing the schema:

1. Inspect the existing registration-form tables/models.
2. Inspect field storage.
3. Inspect condition storage.
4. Inspect response storage.
5. Inspect Registration Type schema.
6. Identify existing capabilities.
7. Add only what is missing.

Do not blindly create new `Form`, `FormField`, `FormResponse`, or `Condition` tables if equivalent structures already exist.

---

# 33. UX Principles

Priorities:

1. Clear hierarchy
2. Fast field creation
3. Easy editing
4. Obvious required state
5. Easy reordering
6. Simple conditional logic
7. Safe publishing
8. Clear errors
9. Minimal clutter

Avoid:

- Huge decorative cards
- Excessive modals
- Deep nested configuration
- Database terminology
- Overly complex rule builders

Use the existing Tailwind/shadcn/component system.

---

# 34. Suggested Components

Reuse existing project components.

Potential components:

```text
RegistrationFormBuilder
FormFieldList
FormFieldCard
FormFieldEditor
FieldTypePicker
FieldOptionsEditor
ConditionBuilder
FormPreview
FormPublishDialog
FieldValidationEditor
```

These are suggestions, not mandatory filenames.

---

# 35. Error States

### Save failure

```text
Couldn't save your changes.
Your edits are still here.
[Retry]
```

### Broken condition

```text
This condition references a field that no longer exists.
```

### Publish failure

```text
Your form can't be published yet.
Fix 2 issues first.
```

### Authorization failure

```text
You don't have permission to edit this MUN's registration form.
```

---

# 36. Testing

## Field CRUD

- Create
- Edit
- Archive
- Reorder
- Duplicate prevention

## Validation

- Required
- Min/max
- Email
- Phone
- Number
- Date
- Options
- File constraints

## Conditional logic

- Show
- Hide
- Equals
- Not equals
- Deleted dependency
- Self dependency
- Circular dependency

## Registration types

- Delegate-only field
- Reporter-only field
- Shared field
- Inapplicable field rejected server-side

## Responses

- Valid response
- Missing required response
- Invalid type
- Invalid option
- Cross-MUN field submission
- Historical response preservation

## Publishing

- Valid form publishes
- Invalid form rejected
- Broken condition rejected
- Empty choice options rejected

## Security

- Cross-organizer access rejected
- Cross-MUN mutation rejected
- Tampered field IDs rejected
- Tampered registration type rejected

---

# 37. Acceptance Criteria

The feature is complete when an organizer can:

### Build

- Open Registration Form Builder
- Add fields
- Edit fields
- Archive fields
- Reorder fields
- Configure required state
- Configure validation
- Configure choice options

### Logic

- Create conditional fields
- Configure registration-type-specific fields
- Invalid/circular conditions are prevented

### Preview

- Preview the real participant experience
- Conditional behavior works in preview

### Publish

- Validate the complete form
- See actionable errors
- Publish a valid form

### Participant

- Participant receives the correct form for their registration type
- Fields render in organizer-defined order
- Conditional fields work
- Required fields are enforced
- Responses are stored against the correct registration

### Integrity

- Historical responses remain intact after form changes
- Cross-MUN access is blocked
- Server-side validation cannot be bypassed

---

# 38. Implementation Order

## Step 1 — Audit

Inspect:

```text
lib/actions/registration-form.ts
registration form schema
registration response schema
registration products/types
current organizer form route
current participant registration route
existing UI components
existing validation helpers
```

Document:

- Existing actions
- Existing models
- Existing condition format
- Existing field format
- Existing response format
- Missing UI capabilities

Do not modify architecture before this audit.

## Step 2 — Organizer Builder Shell

Build:

```text
Registration Form
├── Header
├── Field Library
├── Field List
├── Field Editor
└── Preview
```

Connect reads to the existing backend.

## Step 3 — Field Editing

Implement:

- Create
- Edit
- Archive
- Required
- Options
- Validation
- Reordering

Use existing backend actions.

## Step 4 — Conditional Logic

Connect existing conditional logic to the UI.

Add validation for:

- Missing dependencies
- Self-dependencies
- Circular rules
- Invalid values

## Step 5 — Registration Types

Ensure correct field resolution for:

```text
Delegate
Reporter
Observer
Faculty
Custom types
```

## Step 6 — Participant Renderer

Make the real registration flow consume the configured form.

## Step 7 — Preview + Publish

Implement:

- Preview
- Full validation
- Publish state
- Safe error handling

## Step 8 — Testing / Hardening

Run:

- Unit tests
- Integration tests
- Authorization tests
- Conditional logic tests
- Registration submission tests
- Existing regression suite

Then perform a complete UI/UX pass.

---

# 39. Claude Code Execution Rules

### Rule 1 — Inspect first

Do not assume schema or action names.

### Rule 2 — Reuse existing backend

The backend already contains registration-form capabilities. Extend them.

### Rule 3 — No parallel form system

Never create a second form schema or duplicate action layer.

### Rule 4 — Server is authoritative

Client validation is for UX. Server validation determines correctness.

### Rule 5 — Preserve historical data

Changing a form must not silently destroy previous answers.

### Rule 6 — Strict MUN boundaries

Every query/mutation must verify organizer access to the MUN.

### Rule 7 — No fake publish

Persist and validate the real form lifecycle state.

### Rule 8 — Follow existing design system

Use the repository's current UI/component conventions.

### Rule 9 — Don't rebuild Go-Live

The form builder is one organizer module inside the existing lifecycle.

### Rule 10 — Test business rules

Especially:

- Conditional logic
- Historical responses
- Authorization
- Server validation
- Cross-MUN isolation

---

# 40. Definition of Done

A real organizer can:

```text
Open MUN
   ↓
Registration Form
   ↓
Create Delegate form
   ↓
Add fields
   ↓
Reorder fields
   ↓
Configure required fields
   ↓
Add conditional questions
   ↓
Preview
   ↓
Validate
   ↓
Publish
   ↓
Student selects Delegate
   ↓
Student receives configured form
   ↓
Student completes it
   ↓
Server validates it
   ↓
Responses are stored against registration
   ↓
Organizer sees collected information
```

The final result should feel like a **modern, reliable form builder embedded inside MUNHub**, while remaining fully consistent with the existing architecture and registration lifecycle.
