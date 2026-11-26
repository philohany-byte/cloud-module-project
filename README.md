# Staff Shift Scheduler

Cloud Computing project, Group 12 (Felopateer Hany, Abdelrahman Ayman, Yuwei Zhang).
A manager plans the weekly schedule; staff submit availability, view their shifts and swap shifts with colleagues.

**Stack:** Node.js + Express, plain HTML/CSS/JavaScript, AWS emulated locally with **Floci** (Docker): DynamoDB, Lambda, IAM, S3, CloudWatch Logs.

## Run it

### Option A - everything in Docker (simplest)
```bash
docker compose up --build
```
Open http://localhost:3000. The app container creates the tables, bucket, log group, IAM role and Lambda functions in Floci, then seeds data.

### Option B - develop in VS Code (Floci in Docker, app on your machine)
```bash
docker compose up -d floci      # AWS emulator on http://localhost:4566
npm install
npm run provision:demo          # creates AWS resources + manager + 3 demo staff
npm start                       # http://localhost:3000
```
Run `npm test` any time (needs no Docker). If Lambda does not start on your machine, set `USE_LAMBDA=false`; the same logic then runs inside the API and every response says whether `source` was `lambda` or `local`.

### Logins
| Role | Email (not case sensitive) | Password |
|---|---|---|
| Manager | felomanager@gmail.com | 12345 |
| Staff | felostaff@gmail.com (Ahmed Hassan, Cashier) | 12345 |

`npm run provision:demo` (and Docker) also creates four extra staff, all with password `12345`, so swaps can be tried: Ali Mohamed (Cashier), Sara Ibrahim (Cashier), Mona Khaled (Supervisor), Omar Youssef (Cashier + Supervisor), emails `ali@`, `sara@`, `mona@`, `omar@example.com`. Delete them from the *Staff & roles* tab if you do not want them. Demo staff are available Monday-Friday 08:00-18:00. The password length minimum is 5 characters to allow `12345`; raise it for real use.

## Architecture (three layers)
| Layer | Where | What it does |
|---|---|---|
| Presentation | `public/` | HTML/CSS/JS pages; all data comes from the REST API |
| Application | `src/services/*/routes.js` + `service.js` | HTTP routes, validation, business rules, workflows |
| Data | `src/services/*/repository.js`, `src/aws/` | DynamoDB access, S3, Lambda calls, CloudWatch logging |

Each service lives in its own folder with its own routes, service logic and repository. Services talk to each other only through the exported functions of `service.js` (for example the Swap service calls `scheduling.reassign`).

## Service ownership and AWS usage
| Student | Service | AWS services (3 each) | What each does |
|---|---|---|---|
| Felopateer Hany | Staff & Availability | **DynamoDB, Lambda, IAM** | DynamoDB stores employees, roles, availability. Lambda `coverage-analysis` calculates people available per role per hour and finds gaps. IAM role `shift-scheduler-lambda-role` is the execution identity of the Lambda functions. |
| Abdelrahman Ayman | Shift Scheduling | **DynamoDB, S3, CloudWatch Logs** *(proposed - confirm)* | DynamoDB stores shifts and assignments. S3 stores each exported `.ics` calendar file, which is served back from S3. CloudWatch Logs records schedule changes (stream `scheduling`). |
| Yuwei Zhang | Shift Swap & Coverage | **DynamoDB, Lambda, CloudWatch Logs** *(proposed - confirm)* | DynamoDB stores swap requests. Lambda `uncovered-shifts` compares assigned staff with role requirements. CloudWatch Logs records the swap audit trail (stream `swaps`). |

External function: **calendar export** (iCalendar `.ics`, importable into Google/Apple/Outlook calendars).

## Data model (DynamoDB)
| Table | Key | Main attributes | Relationships |
|---|---|---|---|
| Employees | `id` | name, email, passwordHash, userType (manager/staff), roles[] | roles[] -> Roles.name |
| Roles | `name` | minHeadcount | |
| Availability | `employeeId` | slots[{day 0-6, start, end}] | -> Employees.id |
| Shifts | `id` | date, start, end, title, requirements{role: count}, status | requirements keys -> Roles.name |
| Assignments | `shiftId` + `employeeId` | role | -> Shifts.id, Employees.id |
| SwapRequests | `id` | shiftId, requesterId, colleagueId, role, status, history[] | -> Shifts, Employees |

## REST API (all under `/api`, JSON, `Authorization: Bearer <token>` except login)
| Method & path | Who | Purpose / success response |
|---|---|---|
| POST `/auth/login` | all | `{email,password}` -> 200 `{token,user}`; 401 if wrong |
| GET `/auth/me` | all | current user |
| GET/POST `/staff/employees` | manager | list / create (201) |
| GET/PUT/DELETE `/staff/employees/:id` | manager | read / update / delete (204) |
| GET `/staff/colleagues` | staff | other staff (id, name, roles) |
| GET/POST `/staff/roles`, PUT/DELETE `/staff/roles/:name` | all read, manager write | job roles with `minHeadcount` |
| GET/PUT `/staff/availability/me` | staff | read / replace own `{slots:[{day,start,end}]}` (several ranges per day allowed). The PUT response has `warnings` if an already assigned shift is no longer covered |
| GET `/staff/availability` | manager | availability of the whole team |
| GET `/staff/coverage?fromHour=8&toHour=20` | manager | per-role hourly counts, `gaps`, `notSubmitted` (Lambda) |
| POST `/shifts` | manager | `{date,start,end,title?,requirements:{Role:n}}` -> 201 |
| PUT `/shifts/:id` | manager | edit shift |
| PATCH `/shifts/:id/cancel` | manager | cancel shift and clear assignments |
| POST `/shifts/:id/assignments` | manager | `{employeeId,role}` -> 201; 409 on rule violation |
| DELETE `/shifts/:id/assignments/:employeeId` | manager | unassign (204) |
| GET `/schedule/week?weekStart=YYYY-MM-DD` | all | manager: everything; staff: own shifts only |
| GET `/schedule/calendar.ics` | staff | own upcoming shifts as `.ics` (via S3) |
| POST `/swaps` | staff | `{shiftId,colleagueId,note?}` -> 201 |
| GET `/swaps` | all | manager: all; staff: own/incoming |
| PATCH `/swaps/:id/colleague-response` | staff | `{accept:true/false}` |
| PATCH `/swaps/:id/manager-decision` | manager | `{approve:true/false,comment?}`; approval updates the schedule |
| PATCH `/swaps/:id/cancel` | staff | requester cancels an open request |
| GET `/swaps/coverage/uncovered?from=&to=` | manager | shifts short of staff (Lambda) |

Errors use `{ "error": "message" }` with 400 (invalid input), 401, 403, 404, 409 (business rule conflict).

## Business rules implemented
* Manager is a **user type** (access level). Managers do not work shifts; job roles (Cashier, Supervisor...) belong to staff.
* A role's `minHeadcount` is used only by the availability analysis (people *available*). A shift's `requirements` are used by scheduling and the uncovered-shift check (people *assigned*).
* Assigning requires: the employee holds the role, declared availability covering the whole shift, no overlapping shift, and the role is not already full.
* Swap = the colleague **takes over** the requester's shift (same role). Flow: `PENDING_COLLEAGUE` -> `PENDING_MANAGER` -> `APPROVED` (or `DECLINED` / `REJECTED` / `CANCELLED`). Colleague eligibility is checked at request time and again at approval.
* A role cannot be deleted while employees hold it or upcoming shifts require it. A role cannot be removed from an employee who is assigned to an upcoming shift in that role.
* Every request re-loads the account, so a deleted employee loses access immediately.
* Shifts cannot be created in the past, cannot cross midnight, and date/time cannot change while staff are assigned.

## Known limitations
* DynamoDB `Scan` is used for lookups (e.g. login by email); fine for this data size, not for large systems.
* Passwords are hashed (bcrypt) and sessions use JWT; the default `JWT_SECRET` must be changed outside development.
* Times are plain local times with no time-zone handling.
