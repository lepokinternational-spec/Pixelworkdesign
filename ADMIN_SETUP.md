# PixelWorksDesign Admin Setup

The website now reads projects and contact details from `projects.json`.

To let the Admin panel save changes back into the repository, deploy `cloudflare-worker.js` as a Cloudflare Worker and route it to:

```text
pixelworkdesign.com/api/*
www.pixelworkdesign.com/api/*
```

Set these Worker variables/secrets:

```text
GITHUB_OWNER=lepokinternational-spec
GITHUB_REPO=Pixelworkdesign
GITHUB_BRANCH=main
PROJECTS_PATH=projects.json
ALLOWED_ORIGINS=https://pixelworkdesign.com,https://www.pixelworkdesign.com,https://lepokinternational-spec.github.io
```

Set these as Worker secrets, not public variables:

```text
GITHUB_TOKEN=<fine-grained GitHub token with contents read/write for this repo>
ADMIN_PASSCODE=<your private admin passcode>
OPENAI_API_KEY=<your OpenAI API key>
```

Optional Worker variable:

```text
OPENAI_MODEL=gpt-5.2
```

Do not put `GITHUB_TOKEN` in `index.html`. The Worker keeps it server-side and commits `projects.json` safely through the GitHub API.

Do not put `OPENAI_API_KEY` in `index.html` either. Pixie sends chat messages to the Worker at `/api/chat`, and the Worker calls OpenAI privately. If the AI key is missing, the website falls back to the built-in rough estimator.
