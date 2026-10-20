# Chess Academy – API server

Node.js + Express + TypeScript + SQLite (Node's **built-in** `node:sqlite` – nothing native to compile). JWT auth, role based access (admin / staff / student).

**Requires Node.js 22.13 or newer.** Windows with nvm: `nvm install 22.13.0` then `nvm use 22.13.0` (PowerShell as Administrator), check with `node -v`.

## Run (PowerShell – one command per line, Windows PowerShell 5 has no `&&`)
```powershell
cd server
npm install
Copy-Item .env.example .env      # then set JWT_SECRET
npm run dev                      # http://localhost:4000  (auto-creates data/chess.db and demo data on first start)
```

**If `npm install` fails with EPERM / "Failed to remove some directories":** close editors/terminals using the folder, then
`Remove-Item -Recurse -Force node_modules` and run `npm install` again (antivirus scanning can lock files – retry or exclude the folder).
Other scripts: `npm run seed:reset` (wipe + reload demo data) · `npm run build && npm start` (production) · `npm run typecheck`

Demo logins (created on first start): `admin / admin123` · `vikram / staff123` · `deepa / staff123` · `arjun / student123` · `priya / student123`
(also suresh, rohan, anika, kiran with the same staff/student passwords). **Change or delete these before going live.**

## Auth
`Authorization: Bearer <token>` on everything except `/api/health` and `/api/auth/login`.
The role (admin/staff/student) belongs to the account – the app never sends a role.

## Endpoints
| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/health` | public | |
| POST | `/api/auth/login` | public | `{username,password}` → `{token,user}` (rate limited) |
| GET | `/api/auth/me` | any | |
| POST | `/api/auth/change-password` | any | `{currentPassword,newPassword}` |
| POST | `/api/users/:refId/password` | admin | reset anyone's password |
| GET | `/api/students` | admin, staff (all) · student (self only) | `?batch=Batch A`; includes computed `attendance` % and `performance` |
| GET | `/api/students/:id` | admin, staff · student (self) | |
| POST | `/api/students` | admin | creates student **and login** (`username`,`password` required) |
| PUT | `/api/students/:id` | admin | partial update; `username`/`password` update the login; `photo:null` removes photo |
| DELETE | `/api/students/:id` | admin | also deletes login, attendance, assessments |
| GET | `/api/students/:id/attendance` | admin, staff · student (self) | summary, 12-month series, recent days |
| GET | `/api/students/:id/performance` | admin, staff · student (self) | current score, skills, history, coach comments |
| POST | `/api/students/:id/assessments` | admin, staff | `{score, tactics?, openings?, endgame?, analysis?, tournament?, comments?, date?}` |
| GET/POST | `/api/staff` | GET: all roles (students get names only) · POST: admin | |
| GET/PUT/DELETE | `/api/staff/:id` | admin (GET also the staff member) | |
| GET | `/api/attendance?date=YYYY-MM-DD&batch=Batch A` | admin, staff | students of the batch + status (`present:null` = not marked) |
| PUT | `/api/attendance` | admin, staff | `{date,batch,records:[{studentId,present}]}` – upsert, no future dates |
| GET | `/api/matches` | admin, staff (all) · student (own) | `status` is derived: has results/past → Completed, today → Ongoing, else Upcoming |
| POST/PUT/DELETE | `/api/matches[/:id]` | admin | DELETE = cancel |
| PUT | `/api/matches/:id/results/:studentId` | admin, or staff assigned to the match | `{played,wins,draws,losses,points,rank}` |
| GET | `/api/dashboard` | admin (academy stats) · staff (own batches) | |
| GET | `/api/reports/summary?month=YYYY-MM` | admin, staff | attendance, performance, monthly summary |
| GET | `/api/reports/student/:id?month=YYYY-MM` | admin, staff · student (self) | |
| POST | `/api/uploads/photo` | any | multipart field `photo` (jpg/png/webp, ≤5 MB) → `{url}`; files served from `/uploads/...` |

Errors are always `{ "message": "..." }` with a proper HTTP status (400 validation, 401 sign-in, 403 permission, 404, 409 duplicate username).

## Deploying
* Set `NODE_ENV=production` and a long random `JWT_SECRET` (the server refuses to start without it).
* Put it behind HTTPS (Nginx / Caddy / a PaaS). Android release builds block plain `http://`.
* `data/` (SQLite file) and `uploads/` must be on persistent disk. Back them up.
* Moving to PostgreSQL later only means replacing `src/sqlite.ts`/`src/db.ts` + the SQL in `routes/` (SQL is kept simple on purpose).
# ChessApp-backend
