# Security Policy

SupplyStrata is currently an alpha MVP. Please do not use it with private, personal, confidential, or regulated data.

## Supported Versions

Only the current `main` branch is supported during the MVP phase.

## Reporting a Vulnerability

Until a public security email is configured, please open a private maintainer channel rather than filing a public issue. If this repository is published on GitHub, enable private vulnerability reporting before accepting external users.

Please include:

- A concise description of the issue.
- Steps to reproduce.
- Impact and affected commands/packages.
- Whether secrets, raw data, or third-party source documents could be exposed.

## Secret Handling

- Never commit `.env`.
- Never commit API keys, registry tokens, LLM keys, database URLs with real credentials, or raw downloaded data.
- Local generated data belongs under `data/` and is ignored.
- Generated research reports belong under `reports/` and are ignored.

## Data Handling

This project works with public source documents, but public does not mean redistributable. Do not publish raw PDFs, raw HTML, full filings, or bulk registry responses in this repository.
