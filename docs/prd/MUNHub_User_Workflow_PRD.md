# MUNHub — User / Participant Workflow PRD

## 1. Objective

Define the complete participant journey from discovering a MUN on the marketplace to creating an account, maintaining a reusable participant profile, registering for a MUN, and viewing the submitted information in the user's profile.

**Core principle:** Create the participant profile once, then reuse verified profile information across MUN registrations while allowing each MUN to collect its own additional questions.

---

## 2. Primary User Journey

```text
Marketplace
  ↓
Search / Browse MUNs
  ↓
MUN Details
  ↓
Click "Register"
  ↓
Authenticated?
  ├─ YES → Continue to MUN Registration
  └─ NO  → Sign In / Sign Up
                ↓
          Create Participant Profile
                ↓
          Account Created
                ↓
          Return to Selected MUN
                ↓
          MUN Registration Form
                ↓
          Profile fields pre-filled
                ↓
          MUN-specific fields
                ↓
          Committee / Portfolio / Registration Type
                ↓
          Review
                ↓
          Payment
                ↓
          Confirmation
                ↓
          Dashboard + Profile
```

---

## 3. Marketplace Entry

The participant can:

- Browse MUNs
- Search MUNs
- Filter MUNs
- Open MUN details
- See registration availability and price
- Click **Register**

The Register CTA must work for both authenticated and unauthenticated users.

---

## 4. MUN Details Page

Show, where available:

- MUN name
- Organizer
- Date
- Venue
- City
- Registration status
- Registration types
- Price
- Available committees
- Conference description
- Registration deadline
- Rules/documents
- Accommodation information
- Public Executive Board information
- Register CTA

When Register is clicked, preserve the selected MUN.

---

## 5. Authentication Gate

If the participant is not authenticated:

```text
MUN A → Register
       ↓
/sign-in?redirect=/muns/mun-a/register
```

After successful sign-in/sign-up:

```text
Authentication
    ↓
Original MUN registration destination
```

**Never make the participant search for the MUN again.**

Support states:

- Unauthenticated
- Sign in
- Sign up
- Email verification if enabled
- Authenticated
- Authentication error

---

## 6. Sign In

Fields:

- Email
- Password

Actions:

- Sign In
- Forgot Password
- Create Account

If the participant arrived from a MUN's Register button, preserve the intended registration destination.

---

# 7. Sign Up — Participant Profile Creation

Sign Up is not just an authentication form. It creates the participant's reusable MUNHub profile.

Use clearly separated sections:

1. Account Details
2. Personal Details
3. Contact Details
4. Academic Details
5. Parent / Emergency Contact
6. Previous MUN Experience & Achievements
7. Profile Preferences
8. Consent & Account Creation

Avoid one enormous undifferentiated form.

---

## 8. Account Details

Required:

- Email
- Password
- Confirm Password

Validation:

- Valid email format
- Email must be unique
- Password must satisfy the configured policy
- Password confirmation must match

If email verification is enabled:

```text
Create Account
  ↓
Verification Email
  ↓
Verify Email
  ↓
Continue
```

---

## 9. Personal Details

Required:

- First Name
- Last Name
- Date of Birth
- Gender

Optional/configurable:

- Preferred Name
- Profile Photo
- Nationality
- City
- State
- Country

Only collect fields that are genuinely required/useful.

---

## 10. Contact Details

Required:

- Primary Mobile Number

Optional:

- Alternate Mobile Number
- Address
- City
- State
- Country
- Postal Code

These values can later be reused in MUN registrations.

---

## 11. Academic Details

Collect reusable academic information.

Fields:

- School / College / University Name
- Course / Program
- Year of Study
- Graduation Year

Optional:

- Department
- Student ID
- Academic Email

Keep reusable academic information separate from MUN-specific questions.

---

## 12. Parent / Emergency Contact

This is an important participant profile section.

### Required

- Parent / Guardian Name
- Parent / Guardian Contact Number
- Relationship

### Optional

- Alternate Emergency Contact Name
- Alternate Emergency Contact Number
- Alternate Contact Relationship

Example:

```text
Parent / Emergency Contact

Parent / Guardian Name *
[________________________]

Relationship *
[ Father ▼ ]

Contact Number *
[________________________]

[ + Add Alternate Emergency Contact ]
```

Validation:

- Name cannot be empty
- Valid phone number
- Relationship required
- Support country codes
- Reject obviously invalid phone numbers

Emergency information is private and must not appear on public participant profiles or marketplace pages.

---

## 13. Previous MUN Experience & Achievements

### Previous MUN Experience

Fields:

- Has attended an MUN before? Yes / No
- Number of MUNs attended
- Previous MUN experience / description

### Previous Achievements

Provide a clearly visible field:

```text
Previous Achievements

[ Tell us about your previous MUN awards,
  leadership positions, academic achievements,
  or other relevant accomplishments... ]
```

Examples a participant may enter:

- Best Delegate
- High Commendation
- Special Mention
- Honorable Mention
- Chairing experience
- Secretariat experience
- Other relevant achievements

For the initial implementation, a structured free-text field is sufficient. Design the data layer so structured achievements can be introduced later without breaking historical registrations.

---

## 14. Profile Preferences

Optional:

- Profile Photo
- Short Bio
- Areas of Interest
- Languages
- Public Profile Visibility

Public profile visibility must be **opt-in**.

Default:

```text
Public Profile: OFF
```

Never expose private participant information publicly.

---

## 15. Consent

Before account creation, show:

- Terms of Service
- Privacy Policy
- Required consent
- Guardian/age acknowledgement where legally required

Required consent should be stored with timestamp and policy/version information.

---

# 16. Profile Creation

On Sign Up submission:

```text
Validate
  ↓
Create User
  ↓
Create Participant Profile
  ↓
Store Profile Information
  ↓
Authenticate
  ↓
Return to Intended MUN
```

Account/profile creation must be transactional enough to avoid misleading half-created accounts.

---

# 17. Return to the Selected MUN

After account creation:

```text
Profile Created
    ↓
Authentication Complete
    ↓
Selected MUN Registration
```

Example:

```text
Welcome!

Continue your registration for
Oxford MUN 2026

[ Continue Registration ]
```

Do not redirect the user randomly to the marketplace/homepage.

---

# 18. MUN Registration Form

The MUN registration form combines:

### A. Reusable Participant Profile Data

Automatically populate:

- Name
- Date of Birth
- Gender
- Email
- Phone
- College
- Course
- Year of Study
- Parent/Guardian Name
- Parent/Guardian Contact
- Previous MUN Experience
- Previous Achievements

### B. MUN-Specific Data

Defined by the organizer using the existing Registration Form Builder.

Examples:

- Committee preference
- Portfolio preference
- Accommodation requirement
- Food preference
- T-shirt size
- Travel information
- Special requirements
- Organizer-specific questions

**Do not create a second form-builder system. Reuse the existing MUNHub registration-form infrastructure.**

---

# 19. Profile Data vs Registration Data

This distinction is critical.

## Participant Profile

```text
Participant
 ├─ Personal Information
 ├─ Contact Information
 ├─ Academic Information
 ├─ Emergency Information
 └─ Previous Achievements
```

## MUN Registration

```text
Registration
 ├─ MUN
 ├─ Registration Type
 ├─ Committee
 ├─ Portfolio
 ├─ MUN-specific Answers
 ├─ Payment
 └─ Registration Status
```

Do not rely entirely on live profile references for historical registration data.

At submission time, preserve the relevant submitted participant information as a registration snapshot.

Example:

```text
Profile at registration:
KLH University

Historical registration:
KLH University
```

If the participant later changes their college, the old registration must still show the value submitted at that conference.

---

# 20. Editing Profile During Registration

If a participant notices incorrect profile information:

```text
College
KLH University

[ Edit Profile ]
```

After editing:

```text
Profile Updated
  ↓
Return to Current Registration
  ↓
Updated values displayed
```

Do not lose the current MUN registration progress.

Once a registration is submitted, later profile edits must not silently modify the historical registration snapshot.

---

# 21. Registration Types

Support organizer-defined registration types such as:

- Delegate
- IP Delegate
- International Delegate
- Press
- Executive Board
- Campus Ambassador

The selected type can determine:

- Price
- Capacity
- Eligibility
- Required MUN-specific fields
- Available committees/portfolios
- Registration rules

Reusable participant profile information remains available across registration types.

---

# 22. Committee & Portfolio Selection

Where configured:

```text
Committee Preference

1. UNGA
2. UNHRC
3. Lok Sabha
```

Then:

```text
Portfolio Preference

1. India
2. United States
3. United Kingdom
```

Only show options that are currently available according to organizer rules and capacity.

Backend validation must enforce availability.

---

# 23. Review Screen

Before payment, show a complete review.

```text
Review Registration

Participant
Name
Email
Phone
College

Emergency Contact
Parent Name
Parent Contact

Previous Achievements
...

MUN
Oxford MUN 2026

Registration Type
Delegate

Committee
UNHRC

Portfolio
India

Price
₹1,499

[ Edit Profile ]
[ Edit Registration ]
[ Proceed to Payment ]
```

The participant must be able to correct information before payment.

---

# 24. Payment

Flow:

```text
Proceed to Payment
  ↓
Payment Gateway
  ↓
Payment Success
  ↓
Registration Confirmed
```

Payment status must be determined server-side using the payment gateway/webhook.

Do not trust frontend payment-success state.

---

# 25. Confirmation

After successful registration:

```text
Registration Confirmed

Oxford MUN 2026

Registration ID
MUN-2026-XXXX

Registration Type
Delegate

Committee
UNHRC

Portfolio
India

Payment
Paid

[ View Registration ]
[ Go to Dashboard ]
```

The registration must appear in the user's dashboard.

---

# 26. User Dashboard

Provide:

## Upcoming MUNs

Show:

- MUN name
- Date
- Committee
- Portfolio
- Registration type
- Registration status
- Registration ID

## Past MUNs

Show historical registrations.

## Statuses

Examples:

- Draft
- Pending Payment
- Payment Processing
- Confirmed
- Waitlisted
- Cancelled
- Completed

## Account/Profile

Provide direct access to profile management.

---

# 27. User Profile

The profile must reflect the information collected during Sign Up.

Recommended structure:

```text
My Account

├── Profile
│   ├── Personal Details
│   ├── Contact Details
│   ├── Academic Details
│   ├── Emergency Contact
│   ├── MUN Experience
│   └── Previous Achievements
│
├── Registrations
├── Payments
├── Documents
└── Account Settings
```

The same information reused during registration should be visible here.

---

# 28. Profile Editing

Users can edit:

- Personal details
- Contact details
- Academic details
- Emergency contact
- MUN experience
- Previous achievements
- Profile photo/bio where supported

After saving:

```text
Profile Updated Successfully
```

Profile changes apply to future registrations.

Historical registrations remain unchanged.

---

# 29. Profile Completion

Show completion based on actual required fields.

Example:

```text
Profile Completion

████████░░ 80%

✓ Personal Details
✓ Contact Details
✓ Academic Details
✓ Emergency Contact
○ Optional Profile Photo
```

Do not block marketplace browsing because optional fields are incomplete.

---

# 30. Returning User Flow

For an authenticated user:

```text
Marketplace
  ↓
MUN Details
  ↓
Register
  ↓
MUN Registration
  ↓
Profile information auto-filled
  ↓
MUN-specific questions
  ↓
Committee / Portfolio
  ↓
Review
  ↓
Payment
  ↓
Confirmation
```

No Sign Up step is required.

---

# 31. Existing Account With Incomplete Profile

If an existing account is missing newly required profile fields:

```text
Register
  ↓
Check required profile fields
  ↓
Missing fields?
  ├─ NO → Continue
  └─ YES
       ↓
     Complete Profile
       ↓
     Return to Selected MUN
```

Example:

```text
Complete your profile to continue.

3 required details are missing:

• Parent / Guardian Name
• Parent / Guardian Contact
• College

[ Complete Profile ]
```

Always preserve the selected MUN.

---

# 32. Data Model

Reuse existing MUNHub entities where they already exist. Do not create duplicate systems.

Conceptually:

```text
User
 ├─ id
 ├─ email
 ├─ authentication data
 └─ account status

ParticipantProfile
 ├─ userId
 ├─ firstName
 ├─ lastName
 ├─ dateOfBirth
 ├─ gender
 ├─ phone
 ├─ academic information
 ├─ parent/emergency information
 ├─ previous MUN experience
 ├─ previous achievements
 ├─ photo
 ├─ bio
 └─ profile visibility

Registration
 ├─ userId
 ├─ munId
 ├─ registrationTypeId
 ├─ committeeId
 ├─ portfolioId
 ├─ status
 ├─ payment status
 ├─ submittedAt
 └─ participant snapshot

RegistrationResponse
 ├─ registrationId
 ├─ fieldId
 └─ response
```

Inspect the existing schema first and map this model onto existing tables.

---

# 33. Security & Privacy

Participant information is private by default.

Private information includes:

- Phone
- Parent/guardian name
- Parent/guardian contact
- Address
- Date of birth
- Registration responses

Never expose these through public marketplace APIs.

A participant can:

- Read their own profile
- Update their own profile
- Read their own registrations
- Read their own payment status
- Update only registration fields permitted by the workflow

A participant must never be able to:

- Read another participant's profile
- Modify another participant's registration
- Access another MUN's participant data
- Manipulate registration price/capacity
- Set their own registration/payment status

Organizers should only receive participant data required for conferences they manage and according to MUNHub authorization rules.

---

# 34. UX Requirements

## Never lose context

A Register click for MUN A must always return to MUN A.

## Progressive form

Prefer:

```text
1 Account
2 Personal
3 Contact
4 Academic
5 Emergency
6 Achievements
7 Review
```

or clearly separated collapsible sections.

## Required fields

Clearly mark:

```text
* Required
```

## Preserve entered data

Validation errors must not clear completed fields.

## Mobile-first

The entire workflow must work comfortably on mobile.

## Draft preservation

Where practical, preserve partially completed form data.

## Avoid duplicate questions

If profile data already exists, pre-fill it.

---

# 35. Edge Cases

### Unauthenticated Register click

Redirect to Sign In/Sign Up while preserving the MUN.

### Existing email during Sign Up

Show:

```text
An account already exists with this email.

[ Sign In ]
[ Forgot Password ]
```

### User abandons Sign Up

Do not present an incomplete account as a fully completed participant profile.

### Profile complete, payment abandoned

Profile remains saved. Registration remains in the appropriate draft/pending state.

### MUN registration closes during registration

Backend must reject the registration if it is no longer available.

### Capacity fills during checkout

Backend capacity enforcement decides whether registration can be created.

### Payment succeeds but confirmation page fails

Webhook/backend processing must still recover the registration and payment state.

### Profile changed after registration

Historical registration snapshot remains unchanged.

---

# 36. Recommended Route Structure

Adapt to the existing Next.js application.

Conceptually:

```text
/
├── muns
│   └── [slug]
│       ├── page
│       └── register
│
├── sign-in
├── sign-up
│
├── account
│   ├── profile
│   ├── registrations
│   ├── payments
│   └── settings
│
└── registration
    └── [registrationId]
```

Inspect the current routing structure before adding routes.

---

# 37. Server-Side Rules

Server-side validation is mandatory for:

- Authentication
- Profile creation
- Profile updates
- MUN registration eligibility
- Registration type availability
- Committee capacity
- Portfolio availability
- Registration creation
- Payment state
- Registration status
- Authorization

Never trust client-controlled:

- Price
- Availability
- User ID
- Registration status
- Payment status
- Hidden fields

---

# 38. Claude Code Implementation Rules

Before changing code:

1. Inspect the current Next.js application.
2. Identify the existing authentication/session implementation.
3. Identify the current User/Profile schema.
4. Identify existing registration tables/actions.
5. Identify the existing Registration Form Builder.
6. Identify the current MUN registration route.
7. Reuse existing actions/components where possible.
8. Do not create duplicate authentication/profile/registration systems.
9. Preserve current marketplace and registration functionality.
10. Add server-side and integration tests for new mutations.
11. Keep profile data and historical registration snapshots distinct.
12. Ensure emergency/parent information is never exposed through public APIs.
13. Preserve the selected MUN across authentication and profile-completion redirects.

---

# 39. Implementation Order

## Phase 1 — Authentication

- Sign In
- Sign Up
- Session/auth state
- Redirect preservation
- Forgot password
- Email verification if enabled

## Phase 2 — Participant Profile

Implement:

- Personal details
- Contact details
- Academic details
- Parent/emergency details
- Previous MUN experience
- Previous achievements
- Profile completion
- Profile editing

## Phase 3 — Registration Integration

Connect:

```text
Participant Profile
        ↓
MUN Registration
```

Automatically pre-fill reusable fields.

## Phase 4 — MUN-Specific Registration

Integrate the existing Registration Form Builder:

```text
Profile Fields
+
Organizer-Defined Fields
=
Complete MUN Registration
```

## Phase 5 — Review & Payment

- Review
- Server-side price validation
- Capacity validation
- Payment
- Webhook
- Confirmation

## Phase 6 — Account Area

- Profile
- Profile editing
- Registration history
- Payment status/history
- Documents where supported

## Phase 7 — Hardening

- Authorization tests
- Validation tests
- Redirect tests
- Registration concurrency tests
- Payment failure/recovery tests
- Mobile UX testing
- Security/privacy review

---

# 40. Acceptance Criteria

## Marketplace

- [ ] User can discover a MUN.
- [ ] User can open MUN details.
- [ ] User can click Register without signing in.

## Authentication

- [ ] Unauthenticated user reaches Sign In/Sign Up.
- [ ] Selected MUN is preserved.
- [ ] Existing user can sign in.
- [ ] New user can create an account.
- [ ] Successful authentication returns to the selected MUN registration.

## Participant Profile

- [ ] Personal details are collected.
- [ ] Contact details are collected.
- [ ] Academic details are collected.
- [ ] Parent/guardian emergency details are collected.
- [ ] Previous MUN experience can be recorded.
- [ ] Previous Achievements field exists and is stored.
- [ ] Profile is persisted.
- [ ] Profile is visible in the user's account.
- [ ] Profile can be edited.

## MUN Registration

- [ ] Profile fields automatically populate the registration.
- [ ] MUN-specific fields are displayed.
- [ ] User can complete organizer-defined questions.
- [ ] Registration type rules are enforced.
- [ ] Committee/portfolio availability is enforced.
- [ ] User can review information before payment.
- [ ] Server-side validation is used.

## Payment & Confirmation

- [ ] Payment uses the configured gateway.
- [ ] Backend/webhook establishes final payment state.
- [ ] Successful registration receives a registration ID.
- [ ] Registration appears in the user dashboard.

## Data Integrity

- [ ] Historical registrations preserve submitted participant information.
- [ ] Profile edits do not silently rewrite historical registrations.
- [ ] Emergency information is private.
- [ ] Users cannot access other users' data.
- [ ] Client-side manipulation cannot change price, capacity, or registration status.

---

# 41. Final Product Experience

```text
DISCOVER
Marketplace
   ↓
SELECT
MUN Details
   ↓
REGISTER
Register
   ↓
AUTHENTICATE
Sign In / Sign Up
   ↓
CREATE PROFILE
Personal + Contact + Academic
+ Parent/Emergency
+ Previous Achievements
   ↓
RETURN
Selected MUN
   ↓
AUTO-FILL
Reusable Profile Information
   ↓
CUSTOMIZE
MUN-specific Questions
+ Committee
+ Portfolio
+ Registration Type
   ↓
REVIEW
Confirm Information
   ↓
PAY
Payment Gateway
   ↓
CONFIRM
Registration ID
   ↓
MANAGE
Dashboard + Profile + Registrations
```

## Core Product Rule

> **MUNHub should behave as a reusable participant identity layer. A participant enters their core information once, and future MUN registrations reuse that information while preserving conference-specific answers and historical registration data.**
