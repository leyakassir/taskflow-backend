# TaskFlow Backend API Reference

This reference describes the implementation in the backend source and Prisma schema, for a separate admin web dashboard. Paths are relative to the API origin, such as http://localhost:3000. Prisma DateTime values are serialized as ISO 8601 JSON strings.

## 1. Project overview

TaskFlow is a task execution and workforce-management platform: administrators and managers create, assign, and monitor work, while workers receive and complete assigned tasks. This NestJS backend and MySQL database serve the existing Flutter worker mobile app and are intended to serve a separate admin web dashboard; the dashboard itself is not included in this backend repository.

## 2. Tech stack (verified from code)

- Framework: NestJS 12 with TypeScript and ESM (package.json declares type=module).
- Language: TypeScript; declared version range is ^6.0.2.
- ORM: Prisma Client / CLI 6.19.3 in the lockfile. package.json declares ^6.19.3, a range rather than an exact version pin.
- Database: **MySQL**, directly verified in prisma/schema.prisma: datasource provider is mysql.
- HTTP binding: main.ts listens on 0.0.0.0, using PORT or 3000 by default.

### Runtime dependencies

| Package | Use / source status |
|---|---|
| @nestjs/common | Controllers, decorators, dependency injection, exceptions, validation integration. |
| @nestjs/config | Loads and provides environment configuration; configured globally. |
| @nestjs/core | Nest application runtime and bootstrap. |
| @nestjs/jwt | Signs and verifies access JWTs. |
| @nestjs/observe | Installed, but not imported or configured in AppModule. README's claim that the app is already instrumented does not match source. |
| @nestjs/platform-express | Express adapter and Multer-backed FileInterceptor. |
| @nestjs/serve-static | Serves local public and uploads directories. |
| @nestjs/swagger | OpenAPI document and Swagger UI. |
| @nestjs/throttler | Request throttling; only login explicitly attaches its guard. |
| @prisma/client | ORM client and generated model/types. |
| bcryptjs | Password hashing and comparison. |
| class-transformer | DTO transformation and nested DTO instantiation. |
| class-validator | Request DTO validation. |
| helmet | Installed but not imported/applied in main.ts. |
| multer | Multipart file handling and local disk storage. |
| reflect-metadata | Nest decorator metadata. |
| rxjs | Nest observable/runtime dependency. |
| swagger-ui-express | Swagger UI middleware integration. |

### Development dependencies

| Package | Use |
|---|---|
| @nestjs/cli | Nest build/start CLI. |
| @nestjs/mau | Deployment CLI; package.json defines a deploy script. |
| @nestjs/schematics | Nest code generation. |
| @nestjs/testing | Nest testing utilities. |
| @types/express | Express TypeScript types. |
| @types/multer | Multer TypeScript types. |
| @types/node | Node.js TypeScript types. |
| @types/supertest | Supertest TypeScript types. |
| @vitest/coverage-v8 | Vitest coverage provider. |
| oxlint | Lint command. |
| oxlint-tsgolint | Type-aware Oxlint support. |
| prettier | Formatting command. |
| prisma | Prisma CLI and migrations/client generation. |
| source-map-support | Source-mapped runtime stack traces. |
| supertest | HTTP testing client. |
| tsx | TypeScript execution utility. |
| typescript | TypeScript compiler. |
| vite-tsconfig-paths | TS path resolution in Vite/Vitest config. |
| vitest | Test runner. |

## 3. Environment variables

There is no .env.example in the backend directory. These names are from .env; this document intentionally omits all values, especially the database URL and JWT secret.

| Variable | What it controls | Change for a new local copy? |
|---|---|---|
| PORT | HTTP listen port; defaults to 3000 if unset. | Usually set as needed; align API client and CORS URLs. |
| DATABASE_URL | Prisma MySQL connection URL. | **Yes.** Set the developer's database host, port, credentials, and database name. |
| JWT_SECRET | Secret used to sign and verify access tokens. App startup throws if absent. | **Yes.** Generate a private local secret; never share or commit it. |
| JWT_EXPIRES_IN_SECONDS | Access-token lifetime in seconds; source defaults to 900 if absent. Current .env configures 900 seconds (15 minutes). | Usually choose the intended local lifetime. |
| CORS_ORIGINS | Comma-separated browser-origin allowlist. If empty, main.ts uses its fallback list in §10. | **Yes for the dashboard.** Add the dashboard origin including scheme and port. |

These are all five variable names found in the backend .env. Do not copy another developer's .env; configure local values for database, JWT secret, port, and dashboard origin.

## 4. Authentication

### Login

- Method/path: POST /auth/login
- Guard: ThrottlerGuard only; JWT is not required.
- Request JSON:

    { "email": "worker@example.test", "password": "password" }

  Both fields are required. email uses IsEmail; password must be a string with at least 6 characters.
- Success response:

    {
      "accessToken": "<JWT>",
      "user": {
        "id": "<user id>",
        "email": "worker@example.test",
        "fullName": "Worker Name",
        "role": "WORKER"
      }
    }

  The response has no refreshToken, tokenType, or expiresIn property. Missing/inactive users and incorrect credentials all produce 401 with “Invalid email or password”.

### JWT claims and req.user

AuthService signs these application claims:

    { sub: user.id, role: user.role, avatarUrl: user.avatarUrl }

The JWT library adds iat and exp. Current .env sets expiry to 900 seconds; source defaults to 900 seconds if unset. Clients send Authorization: Bearer <accessToken>.

JwtAuthGuard verifies the token, looks up payload.sub, rejects absent or inactive users, then uses the current DB role and attaches precisely this shape to the request:

    { id: user.id, role: user.role }

req.user has no email, fullName, or avatarUrl. Role checks use the DB value, not the token's potentially stale role claim.

**There is no refresh-token mechanism or refresh endpoint.** After expiry, the current API requires login again.

UserRole enum values are exact uppercase strings: ADMIN, MANAGER, WORKER.

Other identity routes:

- GET /auth/me returns { id, email, fullName, role, avatarUrl }; avatarUrl may be null. It does not return isActive or createdAt.
- GET /me returns the fuller user selection in §6, including isActive and createdAt.

## 5. Authorization model

### Guards

| Guard | Checks | Where applied |
|---|---|---|
| JwtAuthGuard (src/auth/jwt.guard.ts) | Requires Bearer token, verifies signature/expiry, confirms user exists and is active, then loads current DB role into req.user. | All /users routes at controller level; all /me routes at controller level; all /tasks routes at controller level; GET /auth/me. Not login, config, legal, root, Swagger, or static files. |
| RolesGuard (src/common/guards/roles.guard.ts) | Reads @Roles metadata and checks request.user.role. Allows routes with no role metadata; otherwise throws 403 if role is absent/not allowed. | All /users routes at controller level; selected /tasks routes at method level (listed in §6). Paired with JWT. |
| ThrottlerGuard (@nestjs/throttler) | Enforces the configured request count/window. | POST /auth/login only. There is no global APP_GUARD. See §9. |

@Roles() supplies metadata; it is not itself a guard. ConfigController and LegalController routes are public.

### Task ownership and access

The shared task access check in TasksService is:

    private assertCanAccess(task: { assigneeId: string }, user: RequestUser) {
      const isOwner = task.assigneeId === user.id;
      const isPrivileged =
        user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
      if (!isOwner && !isPrivileged) {
        throw new ForbiddenException('You do not have access to this task');
      }
    }

GET /tasks scopes results to assigneeId for WORKER; ADMIN and MANAGER see every task. Task detail, status update, and attachment listing use the quoted check. Task creation and reassignment separately require the assignee to exist, be active, and have role WORKER.

Completion uses a different check: it rejects only when the caller is a WORKER and the task assignee differs from req.user.id. Thus ADMIN or MANAGER can complete a task they are not assigned to. Completion still requires status exactly IN_PROGRESS and, when requiresChecklist is true, every task checklist ID must be submitted as done.

**Dashboard/security caveats:** POST /tasks/:id/attachments has only the class-level JWT guard; it does not pass the user to the service or check task access. Any authenticated account knowing the ID can attach a file to that task. Also, PATCH /tasks/:id/status allows IN_PROGRESS to COMPLETED directly, bypassing checklist checks and completion timestamp/notes handling. These are server behavior, not client-side permission rules.

## 6. Full API reference

Task + relations means all Task scalar fields plus checklistItems and attachments arrays; assignee and createdBy objects are not included. Task scalars means the scalar Task fields only. Full model field definitions are in §7. Password hashes are never selected for user responses.

### Root and auth controllers

| Method/path | Guards | Request | Response / behavior |
|---|---|---|---|
| GET / | None | No body. | String "Hello World!". This starter root handler is not a health/readiness contract. |
| POST /auth/login | ThrottlerGuard | { email: string, password: string }; email valid, password min 6. | { accessToken: string, user: { id, email, fullName, role } }; 401 for invalid credentials. |
| GET /auth/me | JwtAuthGuard | Bearer token, no body. | { id, email, fullName, role, avatarUrl: string or null }; 401 if invalid/expired/inactive. |

### Users controller (/users)

All routes have controller-level JwtAuthGuard and RolesGuard, restricted to ADMIN or MANAGER.

| Method/path | Request | Response / validation |
|---|---|---|
| POST /users | { email: string, fullName: string, role: UserRole, password: string }. All required; valid email; nonempty string name; enum role; password min 8. | 201 user { id, email, fullName, role, isActive }. Password is bcrypt-hashed with 10 rounds, never returned. Duplicate email is 400. **ADMIN/MANAGER can create any role, including ADMIN.** |
| GET /users | Query role? (enum-like string, not pipe-validated), isActive? (true/false through ParseBoolPipe), q? (search string). isActive defaults to true. | Array of { id, email, fullName, role, isActive, avatarUrl, createdAt }, newest first; optional role and active filters; q searches email/fullName case-insensitively. |
| GET /users/:id | Path id is string; no body. | Same selected user shape as list; 404 if absent. |
| PATCH /users/:id | Optional body fields: fullName?: string (min 2), role?: UserRole enum, isActive?: boolean. Empty object allowed. | { id, email, fullName, role, isActive, avatarUrl, createdAt }; 404 if absent. |
| PATCH /users/:id/password | { newPassword: string }, required, min 8. | { success: true }; password is hashed. 404 if user absent. |
| PATCH /users/:id/active | Intended body { "isActive": boolean }; there is no DTO validator. Implementation calls Boolean(isActive). | { success: true }; 404 if absent. **JSON string "false" is truthy and activates the user; send the JSON boolean false, not a string.** |

### Current-user controller (/me)

All routes use JwtAuthGuard and operate on req.user.id.

| Method/path | Request | Response / validation |
|---|---|---|
| GET /me | Bearer token; no body. | { id, email, fullName, role, isActive, avatarUrl, createdAt }; 404 if the row is absent. |
| PATCH /me | { fullName?: string }; if present it must be a string with min length 2. | Same selected user as GET /me. |
| PATCH /me/password | { currentPassword: string, newPassword: string }; both required, each min 8. | { success: true }; wrong current password is 400. |
| POST /me/avatar | multipart/form-data with one file field named file. MIME allowlist jpeg/png/webp/gif/heic/heif; max 10 MiB. | { avatarUrl: string }, value is /uploads/avatars/<generated-name>. See §8. |

### Tasks controller (/tasks)

Every task route uses controller-level JwtAuthGuard. Additional role restrictions appear below.

| Method/path | Additional guard/role | Request | Response / validation |
|---|---|---|---|
| POST /tasks | RolesGuard; ADMIN or MANAGER | CreateTaskDto: title: string required; description?: string; priority?: TaskPriority declared; assigneeId: string required; deadline?: ISO date string; startDate?: ISO date string; location?: string; minPhotosRequired?: integer >= 0; minFilesRequired?: integer >= 0; checklistItems?: { label: string }[]. Each checklist label is string. | Task + relations. Assignee must exist, be active, and be WORKER. requiresChecklist is set from whether checklistItems has entries. **priority has no class-validator decorator; with whitelist and forbidNonWhitelisted enabled, sending it is rejected as non-whitelisted (400). Omit it to use Prisma's MEDIUM default.** |
| PATCH /tasks/:id | RolesGuard; ADMIN or MANAGER | Optional UpdateTaskDto fields: title?: string; description?: string; priority?: TaskPriority enum; deadline?: ISO date string; startDate?: ISO date string; location?: string; minPhotosRequired?: integer >= 0; minFilesRequired?: integer >= 0; requiresChecklist?: boolean. | Task + relations; 404 if absent. Does not change assignee; use /assign. Nullish/omitted service values are left unchanged. |
| GET /tasks | No extra role guard | No body. | Array of Task + relations ordered by createdAt descending. WORKER sees assigned tasks only; ADMIN/MANAGER see all. |
| GET /tasks/:id | No extra role guard; ownership/admin/manager check | Path ID; no body. | Task + relations; 404 absent, 403 for a worker not assigned. |
| PATCH /tasks/:id/status | No extra role guard; ownership/admin/manager check | { status: TaskStatus }, required enum. | Task scalars only. Allowed transitions: ASSIGNED -> IN_PROGRESS or CANCELLED; IN_PROGRESS -> COMPLETED or CANCELLED; OVERDUE -> IN_PROGRESS or CANCELLED; COMPLETED/CANCELLED have no outgoing transitions. Invalid transition is 400. **IN_PROGRESS -> COMPLETED here bypasses checklist and completion metadata logic.** |
| PATCH /tasks/:id/complete | No extra role guard; worker must be assignee; ADMIN/MANAGER are not restricted by assignment | CompleteTaskDto: notes?: string; checklistResults?: { id: UUID, done: boolean }[]; photos?: { url: string, mimeType: string, sizeBytes: integer }[]; files?: same object array. All optional. Checklist IDs must belong to task and be unique. | Task + relations. Requires exactly IN_PROGRESS; if requiresChecklist is true, all stored items must be marked done. Checklist changes and completion update are transactional. photos/files arrays insert metadata rows; they do not upload or validate file contents. |
| PATCH /tasks/:id/assign | RolesGuard; ADMIN or MANAGER | { assigneeId: string }, required nonempty string. | Task + relations. Assignee must exist, be active WORKER. 404 task; 400 invalid assignee or finalized task. COMPLETED/CANCELLED cannot be reassigned. |
| POST /tasks/:id/checklist | RolesGuard; ADMIN or MANAGER | { label: string }, required nonempty string. | One TaskChecklistItem; 404 if task absent. |
| PATCH /tasks/:id/checklist/:itemId | RolesGuard; ADMIN or MANAGER | { label?: string }; if present, string min 1. | Updated TaskChecklistItem; 404 if absent or attached to a different task. |
| DELETE /tasks/:id/checklist/:itemId | RolesGuard; ADMIN or MANAGER | No body. | { success: true }; 404 if absent or attached to another task. |
| GET /tasks/:id/attachments | No extra role guard; ownership/admin/manager check | No body. | TaskAttachment array, newest first; 404 missing task, 403 unauthorized worker. |
| DELETE /tasks/:id/attachments/:attId | RolesGuard; ADMIN or MANAGER | No body. | { success: true }; 404 absent or not attached to that task. Deletes DB row only, not disk file. |
| POST /tasks/:id/attachments | No extra role guard; only class-level JWT | multipart/form-data fields: file (one file, max 10 MiB) and kind string exactly PHOTO or FILE. | TaskAttachment row. Maps PHOTO to COMPLETION_PHOTO and FILE to COMPLETION_FILE. URL is /uploads/<generated-name>. 400 missing file/invalid kind. **No MIME/extension allowlist and no assignee/ownership check.** |

CompleteTaskDto photos/files only validate object fields as strings and integer sizeBytes. There is no nonnegative size constraint, file-size check, or MIME validation for those metadata values.

### Content controller routes

ConfigController and LegalController have no auth guards.

| Method/path | Request | Response / validation |
|---|---|---|
| GET /config/locales | No body. | { defaultLocale: "en", supportedLocales: ["en","ar"], legal: { termsUrlTemplate, privacyUrlTemplate, aboutUrlTemplate, howToUrlTemplate } }. Templates point to /public/legal/{lang}/<slug>.html. |
| GET /legal/page?slug=<slug>&lang=<lang> | Required slug exact values terms, privacy, about, how-to; lang optional/default en. | HTML from public/legal/<lang>/<slug>.html; unsupported locale falls back to en. Missing/invalid slug is 400. If requested and English files are missing, 404 JSON { message, slug, lang }. |

### Static, Swagger, and framework routes

- GET /docs serves Swagger UI with bearer auth and persistent authorization.
- Swagger's OpenAPI JSON is exposed by SwaggerModule.setup('/docs', ...); Nest's default JSON route is normally /docs-json.
- /public/** maps to process.cwd()/public; /uploads/** maps to process.cwd()/uploads. Static routes have no JWT guard; files are publicly fetchable when their path is known.

## 7. Data models

Prisma fields are required unless marked nullable or assigned a default. Relation arrays are included only when a query asks for them. DateTime values serialize as ISO strings.

### User

| Field | Type | Required/default | Notes |
|---|---|---|---|
| id | String | Required, cuid() | Primary key. |
| email | String | Required | Unique. |
| passwordHash | String | Required | Not returned by API selections. |
| fullName | String | Required | |
| role | UserRole | Required, default WORKER | |
| isActive | Boolean | Required, default true | JWT guard rejects inactive accounts. |
| avatarUrl | String? | Nullable | Added by migration 20260928110854_add_avatar_url. |
| assignedTasks | Task[] | Relation | AssignedTasks relation. |
| createdTasks | Task[] | Relation | CreatedTasks relation. |
| createdAt | DateTime | Required, now() | |
| updatedAt | DateTime | Required, @updatedAt | |

### Task

| Field | Type | Required/default | Notes |
|---|---|---|---|
| id | String | Required, uuid() | Primary key. |
| title | String | Required | |
| description | String? | Nullable | |
| priority | TaskPriority | Required, default MEDIUM | |
| status | TaskStatus | Required, default ASSIGNED | |
| deadline | DateTime? | Nullable | |
| startDate | DateTime? | Nullable | |
| location | String? | Nullable | |
| minPhotosRequired | Int | Required, default 0 | Persisted but not enforced by completion method. |
| minFilesRequired | Int | Required, default 0 | Persisted but not enforced by completion method. |
| requiresChecklist | Boolean | Required, default false | Gates checklist check in completion. |
| assigneeId | String | Required | FK User.id; assignee relation; indexed. |
| assignee | User | Required relation | AssignedTasks relation. |
| createdById | String | Required | FK User.id. |
| createdBy | User | Required relation | CreatedTasks relation. |
| checklistItems | TaskChecklistItem[] | Relation | |
| attachments | TaskAttachment[] | Relation | |
| completionNotes | String? | Nullable | |
| completionTimestamp | DateTime? | Nullable | Set by complete endpoint. |
| createdAt | DateTime | Required, now() | |
| updatedAt | DateTime | Required, @updatedAt | |

Indexes: assigneeId and status.

### TaskChecklistItem

| Field | Type | Required/default | Notes |
|---|---|---|---|
| id | String | Required, uuid() | Primary key. |
| taskId | String | Required | FK Task.id; indexed. |
| task | Task | Required relation | Cascades on task deletion. |
| label | String | Required | |
| done | Boolean | Required, default false | |

### TaskAttachment

| Field | Type | Required/default | Notes |
|---|---|---|---|
| id | String | Required, uuid() | Primary key. |
| taskId | String | Required | FK Task.id; indexed. |
| task | Task | Required relation | Cascades on task deletion. |
| kind | TaskAttachmentKind | Required | |
| url | String | Required | Relative path for multipart uploads; completion DTO can also supply arbitrary URL. |
| mimeType | String | Required | |
| sizeBytes | Int | Required | |
| createdAt | DateTime | Required, now() | |

### Enums (exact casing)

- UserRole: ADMIN, MANAGER, WORKER
- TaskPriority: LOW, MEDIUM, HIGH, URGENT
- TaskStatus: ASSIGNED, IN_PROGRESS, COMPLETED, OVERDUE, CANCELLED
- TaskAttachmentKind: INSTRUCTION, COMPLETION_PHOTO, COMPLETION_FILE

Multipart task upload accepts the distinct string values PHOTO and FILE and maps them to completion attachment enum values.

## 8. File uploads

**Uploads use local disk via Multer, not cloud/object storage.** AppModule serves process.cwd()/uploads under /uploads. There is no storage-provider abstraction or cloud integration. No source comment labels this implementation “temporary” or “demo only.”

### Task attachments

1. Client posts multipart/form-data to POST /tasks/:id/attachments with file and kind=PHOTO or FILE.
2. Multer writes to relative ./uploads. Filename combines current milliseconds, a random number, and the lowercased original extension. Limit is 10 MiB per file.
3. TasksService inserts the attachment row and returns it. URL is /uploads/<generated-name>; kind is COMPLETION_PHOTO or COMPLETION_FILE.
4. File is publicly served at <API origin>/uploads/<generated-name>.

No MIME or extension allowlist is applied. Assignment/access is not checked. If DB insertion fails after the file is written, no cleanup handler removes it. Deleting an attachment deletes only the DB row.

PATCH /tasks/:id/complete also accepts photos/files metadata arrays. This does not upload files; it inserts provided URL, MIME, and size metadata directly without checking file existence/content.

### Profile avatar

1. Client posts multipart field file to POST /me/avatar.
2. Multer writes to process.cwd()/uploads/avatars with a timestamp/random and MIME-derived extension. Accepted MIME values: jpeg, png, webp, gif, heic, heif. Max 10 MiB.
3. UsersService saves /uploads/avatars/<generated-name> in User.avatarUrl.
4. Response: { "avatarUrl": "/uploads/avatars/<generated-name>" }. It is publicly served at <API origin> plus that path.

MIME filtering trusts the multipart-reported MIME; file signature is not checked. Replacing an avatar does not delete the previous disk file. The storage is local and requires persistent/shared disk in deployment.

## 9. Rate limiting

AppModule configures ThrottlerModule with ttl 60,000 ms and limit 5. There is no global APP_GUARD. AuthController explicitly attaches ThrottlerGuard and a 5-per-60-second override to POST /auth/login. Thus effective throttling applies to login only, 5 requests per 60 seconds per Nest's default tracker; no custom tracker is configured. Other routes do not attach the guard.

## 10. CORS

main.ts reads process.env.CORS_ORIGINS or an empty string, splits on commas, trims entries, and discards empty strings. If any origins remain, they are used. Otherwise the exact fallback is:

    http://localhost:3000
    http://127.0.0.1:3000
    http://10.0.2.2:3000

The result is applied with app.enableCors({ origin: origins, credentials: true }). For the dashboard, set CORS_ORIGINS to comma-separated exact origins, such as http://localhost:5173,http://localhost:3001, using its real scheme, host, and port. The fallback is not a wildcard and does not include typical dev ports such as 5173. Backend binds to PORT or 3000 at 0.0.0.0.

## 11. Known gaps / code-comment markers

### Marker search

A case-insensitive search of backend src/, prisma/, and test/ for TODO, FIXME, DEMO ONLY, TEMPORARY, TEMP, PLACEHOLDER, FUTURE, HACK, XXX, WIP, and “not implemented” found **no matching source comments**. “Demo” occurs in seed fixture names, not comments. There is no comment calling uploads temporary/demo-only.

### Implementation gaps for dashboard authors

1. **Task multipart authorization:** POST /tasks/:id/attachments checks only authentication and task existence; any authenticated caller knowing a task ID can upload to it.
2. **Completion status shortcut:** PATCH /tasks/:id/status allows IN_PROGRESS to COMPLETED without checklist validation or completion notes/timestamp. Dedicated completion route should be used for current semantics; backend should close the bypass before relying on completion invariants.
3. **Completion evidence validation:** Complete DTO metadata arrays accept supplied URLs/MIME and integer sizes without validating actual files.
4. **Evidence minimums:** minPhotosRequired and minFilesRequired persist but are not enforced by TasksService.complete(). Notes/photos/files can be omitted. Checklist is enforced only when requiresChecklist=true.
5. **Empty required checklist:** Task update can set requiresChecklist=true with zero checklist items; the completion every() check on an empty list passes.
6. **Create priority validation:** CreateTaskDto declares priority but gives it no class-validator decorator. With global whitelist and forbidNonWhitelisted enabled, sending priority is rejected as a non-whitelisted property (400); omit it to get Prisma's MEDIUM default. UpdateTaskDto priority is enum-validated.
7. **Active flag coercion:** PATCH /users/:id/active calls Boolean(isActive) without a validated DTO; JSON string "false" is truthy.
8. **Public local files:** /uploads and /public have no JWT guard. Task upload has no MIME allowlist; avatar validation trusts multipart MIME. Disk storage needs persistence/shared storage for multi-instance deployment.
9. **No refresh token:** Access token expiry requires a new login.
10. **Throttling scope:** Throttler is not global; login alone attaches its guard.
11. **Security packages not wired:** helmet is declared but not applied in bootstrap; @nestjs/observe is installed but not configured. README's observation claim is stale.
12. **README is generic:** README.md remains the NestJS starter template, not a TaskFlow API specification.

## 12. Seeded test accounts

prisma/seed.cjs upserts these accounts. It hashes each source password with bcryptjs (12 rounds); passwords below are the original source strings. These demo credentials are for local testing only and must not be used in a deployed environment.

| Email | Role | Source password |
|---|---|---|
| worker@taskflow.local | WORKER | Pass1234! |
| worker2@taskflow.local | WORKER | Pass1234! |
| admin@taskflow.local | ADMIN | Pass1234! |

prisma/seed_admin.cjs is a separate parameterized helper. It accepts <email> <fullName> <password>, creates a new ADMIN, or promotes/reactivates a matching existing user. It contains no fixed email/password.
