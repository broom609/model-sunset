# Security policy

## Supported versions

Security updates are provided for the latest major release.

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for this repository. Do not open a public issue containing exploit details, credentials, private source code, or sensitive fixtures.

Include the affected version, reproduction steps, impact, and any suggested mitigation. You should receive an acknowledgment within three business days.

## Trust boundaries

- Scans are local and do not upload repository contents.
- Custom comparison commands execute with the caller's permissions and environment. Only run commands committed by trusted maintainers.
- Custom remote registries are untrusted input. ModelSunset enforces HTTPS, time, size, and schema limits, but users should still prefer registries they control.
- PR mode requires `contents: write` and `pull-requests: write`; use it only on trusted workflow triggers. Do not run PR mode on untrusted fork pull requests.
