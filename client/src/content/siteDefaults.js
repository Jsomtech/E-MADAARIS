/**
 * Default public-site copy. Super admins can override any page from Platform → Site content;
 * these values are both the editor's starting point and the render fallback when nothing is saved.
 */

export const HOME_DEFAULT = {
  badge: 'School management, built for Somalia',
  headline: 'One platform. Everything your school needs.',
  tagline: 'Hal Nidaam, Dhammaan Baahiyaha Dugsiga',
  lead: 'Admissions, attendance, exams, fees, library, transport, HR and digital learning in a single multi-tenant system — with one secure login for every member of your school community.',
  primaryCta: 'Sign in',
  secondaryCta: 'Contact',
  meta: ['Somali & English', 'Tenant-isolated data', 'Public document verification', 'Your logo, your dashboard'],
  stats: [
    { value: '16', label: 'Connected modules' },
    { value: '2', label: 'Languages' },
    { value: '1', label: 'Isolated tenant per school' },
    { value: '100%', label: 'Server-enforced permissions' },
  ],
  workflow: {
    eyebrow: 'One school day',
    title: 'From the classroom to the parent portal',
    sub: 'Every action is recorded once and shared with exactly the people who need it.',
    steps: [
      'Attendance taken in class, synced to the parent portal',
      'Marks entered, approved and released as report cards',
      'Fee structures billed, payments receipted, dues tracked',
      'Announcements delivered to the exact roles that need them',
    ],
  },
  security: {
    eyebrow: 'Trust by design',
    title: 'Built for many schools, never mixed',
    sub: 'Row-level security, server-derived school IDs and audited permissions keep every record inside its own tenant.',
    items: [
      'Every school gets its own isolated tenant',
      'Somali and English interfaces',
      'Full audit trail of every change',
      'Public certificate and student-ID verification',
      'Each school can use its own logo across the platform',
    ],
  },
  pricing: {
    eyebrow: 'Simple pricing',
    title: 'Plans that scale with the school',
    sub: 'Prices and limits are published by the platform team — no hidden fees.',
  },
  faq: {
    title: 'Questions schools ask us',
    items: [
      'Is my school data separated from other schools?',
      'Can I change plan or add branches later?',
      'What happens when the trial ends?',
    ],
    allLabel: 'Read all questions',
  },
  cta: {
    title: 'Bring your school online this term',
    body: 'Our platform team onboards every school, sets up your plan and creates the administrator account.',
    primaryCta: 'Contact',
    secondaryCta: 'Sign in',
  },
  trust: [
    'Every school gets its own isolated tenant',
    'Somali and English interfaces',
    'Full audit trail of every change',
    'Public certificate and student-ID verification',
  ],
};

export const FAQ_DEFAULT = {
  title: 'Frequently asked questions',
  sub: 'How tenancy, plans, roles, accounts and data ownership work on E-MADAARIS.',
  groups: [
    {
      key: 'gettingStarted',
      title: 'Getting started',
      items: [
        {
          key: 'plans',
          q: 'What is the difference between the plans?',
          a: 'Plans differ in three ways: the ceilings (students, staff accounts, storage, branches), the feature switches (examinations, fees, parent portal, digital learning, analytics and so on) and the trial length. Prices and limits shown on the pricing page come straight from the plans published by the platform team, so they are always current.',
        },
        {
          key: 'trial',
          q: 'What happens when the trial ends?',
          a: 'The subscription moves out of trial status and the school administrator is notified in the app. Data is not deleted at trial end. Once billing is confirmed by the platform team, the school returns to active status with the full trial history intact.',
        },
        {
          key: 'limits',
          q: 'What happens when we reach a plan limit?',
          a: 'Limits are enforced when a record is created. You will see a clear message that the student, staff or storage ceiling has been reached, and nothing is deleted. The school can then move up a plan; existing records keep working exactly as before.',
        },
      ],
    },
    {
      key: 'security',
      title: 'Tenancy & security',
      items: [
        {
          key: 'tenancy',
          q: 'Is each school kept separate from the others?',
          a: 'Yes. E-MADAARIS is multi-tenant: a school is provisioned as its own tenant and every read and write is filtered by the school id taken from your verified session. Another school’s records cannot appear in your lists, reports or exports, and platform staff access to school data is recorded in the audit trail.',
        },
        {
          key: 'branches',
          q: 'Can one account run several branches?',
          a: 'Plans carry a branch ceiling. Extra branches are added under the same school registration so the head office sees consolidated reporting while each branch keeps its own classes, fee structures and staff. Ask the platform team if you need more branches than your plan allows.',
        },
        {
          key: 'ownership',
          q: 'Who owns the data we put in the system?',
          a: 'The school owns its records. You can export students, staff, attendance, results and finance data to CSV from the reports screens at any time. On exit or cancellation the tenant is deactivated and kept out of the active pool rather than reused by another school; retention and deletion requests follow the privacy policy.',
        },
        {
          key: 'verify',
          q: 'Can someone outside the school check a certificate or a student ID?',
          a: 'Yes. Certificates carry a reference number and student ID cards carry a verification code, both printed on the document. Anyone can enter them on the public verification page to see only the school name, holder name, document type and issue status — no other records are exposed.',
        },
      ],
    },
    {
      key: 'people',
      title: 'Accounts & people',
      items: [
        {
          key: 'roles',
          q: 'How does each person get the right access?',
          a: 'Every account is granted a role, and each role carries permission keys such as view, create, approve or export. The menu hides what a person cannot do and the API checks the same permission on every request, so access stays consistent across the dashboard and the public pages.',
        },
        {
          key: 'accounts',
          q: 'How do staff, students and parents get accounts?',
          a: 'The school administrator creates staff accounts with a first password and provisions student logins automatically when an admission is recorded. Students sign in with their student ID. Everyone can change their password after signing in.',
        },
        {
          key: 'lostpassword',
          q: 'I forgot my password.',
          a: 'Ask your school administrator. From Users they can reveal a password the system issued or reset it on the spot. Once you sign in, set your own password from Account & security — after that nobody, including the administrator, can read it.',
        },
      ],
    },
    {
      key: 'schools',
      title: 'For schools in Somalia',
      items: [
        {
          key: 'somali',
          q: 'Is the interface really available in Somali?',
          a: 'Yes — Somali and English are both first-class languages. Any signed-in user switches language from the header or from Account & security, and the choice is remembered for the next visit. Names, addresses and school terminology are stored as entered, so Somali text displays and prints correctly on reports and certificates.',
        },
        {
          key: 'offline',
          q: 'What about unreliable internet?',
          a: 'The interface is lightweight and every action posts to the API once, so a slow connection means a slower save rather than a broken screen. Take the register on a phone tether, batch marks entry per class, and use printable report cards and receipts for the paperwork that must leave the building.',
        },
      ],
    },
  ],
  still: {
    title: 'Still unanswered?',
    body: 'Send the question to the platform team, or read the terms and privacy policy for the formal wording on billing, retention and responsibilities.',
  },
};

export const TERMS_DEFAULT = {
  title: 'Terms of service',
  updatedLabel: 'Last updated',
  contentsLabel: 'Contents',
  articleLabel: 'Article',
  intro: 'These terms are the agreement between a school (and each person holding an account in it) and JSOM TECH for the use of the E-MADAARIS platform. Creating an account or signing in means you have read them. The privacy policy explains what data we process.',
  articles: [
    {
      key: 'agreement',
      title: 'Agreement and the parties',
      clauses: [
        'These terms govern use of E-MADAARIS, the school-management platform operated by JSOM TECH ("the platform provider"). The school accepts them through its administrator when the tenant is created; platform users accept them when their account is activated.',
        'By using the platform you confirm that you are authorised to act for that school and that the details you supply are accurate.',
      ],
    },
    {
      key: 'service',
      title: 'What the service includes',
      clauses: [
        'The platform provides role-based school management modules — admissions, attendance, examinations and results, finance, library, transport, human resources, reception, discipline, laboratories, digital learning, announcements, reporting and subscription administration — in the Somali and English languages.',
        'The provider may add, rename or withdraw modules between releases. Material changes that remove a feature included in the school’s paid plan are notified in the app before they take effect.',
        'Hosting, routine maintenance, backups and technical support are part of the service. Third-party costs (email delivery, payment providers, courier printing) remain the school’s responsibility.',
      ],
    },
    {
      key: 'accounts',
      title: 'Accounts and roles',
      clauses: [
        'Each person keeps one credential; sharing logins is prohibited, because the audit trail attributes every action to an account.',
        'Access follows permission keys assigned to roles by the school administrator. The provider does not grant a school user access beyond what its subscription and role allow, and cannot override a role decision made by the school.',
        'The school is responsible for suspending users who leave its employment and for the accuracy of the roles it assigns.',
      ],
    },
    {
      key: 'data',
      title: 'School data and ownership',
      clauses: [
        'All records created by a school remain the school’s data. The provider processes them only to operate the service: hosting, backup, support, usage measurement and legally required logging.',
        'Each school is provisioned in its own tenant. Reads and writes are scoped to that tenant by the authenticated session; no other school can query it, and platform staff access is limited to the support work the school requested and is recorded in the audit trail.',
        'The school may export its data in the formats offered on the reporting screens at any time.',
        'The school is responsible for the accuracy and lawfulness of what it stores, including consent it holds for student and guardian personal data. See the privacy policy for retention and deletion.',
      ],
    },
    {
      key: 'verification',
      title: 'Public verification of documents',
      clauses: [
        'Certificates and student identity cards carry a reference or verification code that anyone may check on the public verification page.',
        'Verification returns only the document type, its status, the issuing school and the holder’s name. Marks, fees, contact details and other records are never part of that response.',
        'A school controls which references it issues; publishing a reference on a document is the school’s decision and confirmation that the holder may be identified by it.',
      ],
    },
    {
      key: 'availability',
      title: 'Availability and support',
      clauses: [
        'The provider targets continuous availability and performs maintenance in the quietest hours, notifying planned windows in the app when practical.',
        'Support for a live school is handled through the in-app support center so the team can see the tenant, plan and activity behind the request. Public email and phone routes are for enquiries and pre-sales questions.',
        'The school must report suspected misuse or a suspected compromise of its accounts without undue delay.',
      ],
    },
    {
      key: 'liability',
      title: 'Liability and indemnity',
      clauses: [
        'Neither party is liable for indirect or consequential loss. The provider’s total liability for claims arising from the service is limited to the fees the school paid in the twelve months before the claim, except where local law sets a higher floor.',
        'The provider is not responsible for decisions the school makes using platform reports, nor for the accuracy of data entered by school users.',
        'The school indemnifies the provider against claims caused by its own content, data or use of the service in breach of these terms.',
      ],
    },
    {
      key: 'term',
      title: 'Term, cancellation and exit',
      clauses: [
        'The agreement runs from activation of the school tenant until cancellation by either party with the notice stated in the subscription.',
        'On cancellation the tenant is deactivated rather than reassigned. Backups are deleted on the schedule published in the privacy policy, and the school may request a final export during the notice period.',
        'Fees already invoiced for the elapsed period remain due.',
      ],
    },
    {
      key: 'changes',
      title: 'Changes to these terms, and governing law',
      clauses: [
        'The provider may update these terms for new features, security requirements or legal changes. Material changes are announced in the app and on this page with an effective date; continuing to use the platform after that date accepts the revision.',
        'If a school does not accept a revision, it may cancel before the effective date and receive a pro-rata refund of prepaid unused fees where the revision reduces the service materially.',
        'These terms are governed by the law of the jurisdiction in which JSOM TECH operates, without depriving the school of mandatory consumer or data-protection rights in its own country.',
      ],
    },
  ],
  questionsTitle: 'Questions about these terms',
  questionsBody: 'Write to the platform team before signing up if anything here needs clarifying for your school, your regulator or your customers.',
};

export const PRIVACY_DEFAULT = {
  title: 'Privacy policy',
  updatedLabel: 'Last updated',
  intro: 'E-MADAARIS holds sensitive material: children’s records, examination results and a school’s money trail. This policy states exactly which data we process, why, how it stays inside its own tenant, how long it lives and what rights the people in those records have.',
  promises: [
    'One tenant per school — enforced on every query',
    'No plaintext passwords, anywhere in our stack',
    'Access to school data by platform staff is logged',
    'Deleted records leave the active tenant immediately',
  ],
  sections: [
    {
      key: 'controller',
      title: 'Who processes the data',
      body: [
        'JSOM TECH operates the E-MADAARIS platform and acts as the processor for school records; the school itself is the controller of the personal data its staff enter. Where a platform user contacts us directly, we act as controller for that correspondence.',
        'Contact details for privacy questions are listed at the foot of this page and on the contact page.',
      ],
    },
    {
      key: 'data',
      title: 'Categories of data we process',
      body: [
        'School data entered by school users: student identity, admission numbers, class and section placement, guardian names and contact details, staff employment details, attendance registers, examination marks and report cards, fee obligations and payment receipts, library loans, transport assignments, discipline records and uploaded learning materials.',
        'Account data: name, email address, telephone, assigned roles and permission keys, language preference, last sign-in, and the session tokens used to keep a user signed in.',
        'Subscription data: school registration details, plan and limits, invoices and billing history.',
        'Operational data: audit entries describing who did what and when, support tickets, and aggregate usage counters (record counts, storage) used to enforce plan ceilings.',
        'We do not sell any of it, and we do not use student records to train models or build advertising profiles.',
      ],
    },
    {
      key: 'purposes',
      title: 'Why we process it',
      body: [
        'To deliver the modules the school subscribed to, to authenticate users and enforce their permissions, to apply plan limits and issue invoices, to provide support and diagnose faults, and to meet legal and accounting obligations.',
        'Every processing purpose is tied to the contract with the school; nothing is processed for a new purpose without notice.',
      ],
    },
    {
      key: 'isolation',
      title: 'Tenant isolation',
      body: [
        'A school is provisioned as its own tenant. The application resolves the school from the verified session on the server and adds that scope to every query and write, so a request cannot reach another tenant by guessing an identifier.',
        'Platform staff see school records only when support work requires it, and those reads and writes are recorded in the audit activity log the school can review.',
        'Backups and restores preserve the tenant boundary; a restore is never merged across schools.',
      ],
    },
    {
      key: 'credentials',
      title: 'Authentication, passwords and sessions',
      body: [
        'Passwords are stored only as salted hashes inside the authentication provider. Neither the platform API, our application code, nor our logs ever hold a plaintext password, and staff cannot read yours.',
        'A sign-in issues a short-lived access token plus a refresh token held by the client; both are revoked on sign-out.',
        'A password must be at least eight characters, and schools should require every user to keep their own credential — the audit trail attributes actions to accounts.',
      ],
    },
    {
      key: 'retention',
      title: 'Retention and deletion',
      body: [
        'School records are kept for as long as the school keeps them and for the duration of the subscription; academic history is deliberately long-lived because report cards and certificates must remain verifiable.',
        'Records deleted by a school are removed from the active tenant immediately and disappear from encrypted backups when those backups roll past their retention window.',
        'When a school cancels, the tenant is deactivated, exports are made available during the notice period, and personal data is deleted or anonymised on the schedule agreed with the school. Anonymised counts may remain for service statistics.',
        'Account data for a person who leaves a school is suspended at once by the administrator and purged with the tenant.',
      ],
    },
    {
      key: 'rights',
      title: 'Rights of students, guardians and staff',
      body: [
        'Access, correction, deletion, objection, portability and consent withdrawal can be exercised by the individual concerned — but the route runs through the school, because the school controls the record. Ask the registrar or the school administrator, who can export or amend the data in the app.',
        'Requests can also be sent to us; we will forward them to the responsible school and act on its instruction, or directly where the law requires it.',
        'A data subject may complain to the supervisory authority in their country. We cooperate with such authorities and with the school during any review.',
      ],
    },
    {
      key: 'children',
      title: "Children's data",
      body: [
        "Student records exist because a school is legally obliged to keep them. The lawful basis is the school's obligation and its contract with the family, not our own interest.",
        'Students see only their own dashboard: timetable, attendance, results, assignments, announcements and their own fee position. Guardians see only the children linked to their account.',
      ],
    },
    {
      key: 'transfers',
      title: 'Hosting, transfers and sub-processors',
      body: [
        'Data is hosted with the cloud providers used for the deployment the school signed up to. Where hosting sits outside the school’s country, we rely on standard contractual clauses or an equivalent lawful transfer mechanism.',
        'Sub-processors are limited to the services the platform needs: the managed database and authentication provider, email delivery, payment or mobile-money providers where a school uses them, and error reporting. Each is bound by confidentiality and security terms; the list is available on request.',
      ],
    },
    {
      key: 'security',
      title: 'How we protect the platform',
      body: [
        'Transport encryption on every request, hardened HTTP headers, rate limits on public and authentication routes, role checks repeated server-side, least-privilege service credentials, audit logging of sensitive actions, and encrypted backups with tested restores.',
        'If a breach affects a school’s records, we notify the responsible contact at that school without undue delay and record the incident.',
      ],
    },
    {
      key: 'changes',
      title: 'Changes to this policy',
      body: [
        'We update this policy when the platform changes or the law requires it. Material changes are announced in the app and dated on this page.',
      ],
    },
  ],
  contactTitle: 'Privacy contact',
  contactBody: 'Write to the platform team for the sub-processor list, the hosting region for your deployment, or a correction that the school cannot make itself. Use the contact page and mark the topic as data; support requests from inside an active school should use the in-app support center.',
};

export const SITE_DEFAULTS = {
  home: HOME_DEFAULT,
  faq: FAQ_DEFAULT,
  terms: TERMS_DEFAULT,
  privacy: PRIVACY_DEFAULT,
};
