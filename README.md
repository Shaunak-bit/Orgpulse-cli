# OrgPulse CLI

OrgPulse is a command-line tool to fetch GitHub organization repositories, store them in MongoDB, and analyze them with useful metrics like stars, forks, and contributors. It supports checkpointing/pagination for large orgs and CSV exports for reporting.

### Commands
1)  node ./bin/orgpulse fetch expressjs
 ✅ Batch 10 complete: 47 successes, 0 errors
🎉 All batches completed: 47 successes, 0 errors

🎉 Issue fetching complete: 47 repos OK, 0 failed, 2113 issues

🎉 Fetch completed: 47 repos, 2113 issues
🔌 MongoDB connection closed

2) node ./bin/orgpulse top --org expressjs --metric stars --limit 5
    MongoDB connected
┌─────────┬───────────┬───────┬───────┬────────────┐
│ (index) │ Name      │ Stars │ Forks │ OpenIssues │
├─────────┼───────────┼───────┼───────┼────────────┤
│ 0       │ 'express' │ 67553 │ 20317 │ 105        │
│ 1       │ 'multer'  │ 11886 │ 1085  │ 179        │
│ 2       │ 'morgan'  │ 8098  │ 536   │ 14         │
│ 3       │ 'session' │ 6339  │ 993   │ 51         │
│ 4       │ 'cors'    │ 6148  │ 485   │ 20         │
└─────────┴───────────┴───────┴───────┴────────────┘
🔌 MongoDB connection closed
PS C:\Users\satya\OneDrive\Desktop\CLI\orgpulse-cli> node ./bin/orgpulse export --org expressjs --out repos.csv
>>
✅ MongoDB connected

Exporting expressjs repos to repos.csv...
✅ Exported 47 repositories to repos.csv
🔌 MongoDB connection closed

3)node ./bin/orgpulse sync-stars --org expressjs
✅ MongoDB connected
🔄 Refreshing stars/forks for expressjs repos...
Updated .github: stars 7 → 7, forks 6 → 6
✅ Updated 47 repositories
🔌 MongoDB connection closed

4) node ./bin/orgpulse export --org express --out vercel-repos.csv
name,stars,forks,openIssues,pushedAt,language
"express",67553,20317,105,2025-08-20T13:18:37.000Z,"JavaScript"
"multer",11886,1085,179,2025-08-09T11:02:59.000Z,"JavaScript"
---

### Short field-mapping note 
When fetching repositories from GitHub, the following fields are mapped into MongoDB:

GitHub API Field	MongoDB Field	Notes
id	_id	Used as unique identifier
name	name	Repository name
full_name	full_name	Includes org + repo name
stargazers_count	stars	Number of stars
forks_count	forks	Number of forks
open_issues_count	issues	Open issues at fetch time
watchers_count	watchers	Number of watchers
language	language	Primary language
pushed_at	last_push	For activity freshness
html_url	url	GitHub repo URL

### Debug dairy

Issue #1: First fetch was hitting GitHub API rate limits.
Fix: Added support for GITHUB_TOKEN in .env to use authenticated requests.

Issue #2: Duplicates appeared on re-fetch.
Fix: Added upsert logic in MongoDB using _id from GitHub repo ID.

Issue #3: Pagination stopped after page 1.
Fix: Implemented checkpoint system (checkpoint.json) to store next_page.

Issue #4: CSV exports included internal Mongo fields.
Fix: Wrote custom mapper to include only selected fields.

![9ddf3827-3474-490d-921b-1093217fa749](https://github.com/user-attachments/assets/04494a0c-b890-4eaa-854f-818c110bb0b3)


## ⚙️ Setup / Run Steps

1. **Clone the repository**
   ```bash
   git clone https://github.com/Shaunak-bit/Orgpulse-cli.git
   cd Orgpulse-cli
