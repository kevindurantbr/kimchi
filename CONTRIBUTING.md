# Team collaboration

Keep `main` as the integrated, reviewable version. Each person works on a separate branch and opens a pull request. This is the team workflow; remote branch protection has not yet been configured.

## First checkout

Clone the shared repository:

```sh
git clone https://github.com/kevindurantbr/kimchi.git
cd kimchi
git switch -c codex/agronomy
```

Use `codex/fields-soils` or `codex/weather-water` for the other workstreams. Each teammate should configure their own commit name and email if Git requests them; do not copy someone else's identity.

## Deliver work

Read your brief under `research/`. Put your deliverable in the matching directory:

- `research/deliverables/agronomy/`
- `research/deliverables/fields-soils/`
- `research/deliverables/weather-water/`

Before committing, inspect the files and diff. Stage only the files intended for the change:

```sh
git status
git diff
git add research/deliverables/agronomy/
git commit -m "Add cited crop rotation candidates"
git push -u origin codex/agronomy
```

Replace the path and branch with your workstream. Open a pull request into `main` on the repository host and explain what is ready, how it was checked, and what is still unknown. The integration lead reviews and merges. Do not force-push `main`.

## Bring in merged work

Start with a clean working tree: commit or stash your own changes first.

```sh
git switch main
git pull --ff-only
git switch codex/agronomy
git merge main
```

Resolve conflicts deliberately and review the result before committing. Coordinate proposed shared schema changes in the pull request rather than silently changing the contract. Avoid editing another teammate's deliverables.

## Evidence and data review

Confirm that JSON parses, field IDs join, units and time ranges are recorded, and a reader can trace scientific claims to primary sources. Missing data remain null or explicitly unavailable. Distinguish observations, estimates, assumptions, and synthetic fixtures.

Commit small JSON/GeoJSON outputs and retrieval scripts. Keep large downloads in the ignored `research/data/raw/` directory and document how to reproduce them. API tokens belong in an ignored local `.env` or an environment variable; an `.env.example` can contain variable names and empty values only.

## Repository access

The shared repository is https://github.com/kevindurantbr/kimchi. It is currently public: anyone can read it. Direct pushes require collaborator write access; send your GitHub username to the repository owner. Collaborator invitations and remote branch protection are managed separately from this documented workflow.
