# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository:

https://github.com/martinlofranodeoliveira/retrieval-eval-kit/security/advisories/new

Do not place sensitive vulnerability details in public issues. Include the affected code path, a minimal synthetic reproduction, expected behavior and the observed impact. Do not include credentials, real personal data, client datasets or private document text.

For general contact, use the [official Lofrano Tecnologia homepage](https://lofranotecnologia.com.br). No response-time commitment is made.

## Scope and boundaries

This is an offline local-data evaluator with no runtime dependencies, network requests, telemetry or persistent writes. Input limits include 1 MiB raw JSON, 1 MiB compact validated data, depth 8, 10,000 corpus IDs, 5,000 queries, 1,000 ranked IDs per query and 128 UTF-16 code units per ID. File reads use a checked descriptor and a fixed-size buffer rather than trusting only file-size metadata. Malformed UTF-8, duplicate JSON members, unknown fields and ASCII controls in IDs are rejected. Markdown query IDs are encoded rather than interpolated as syntax.

These defenses are not a general sandbox or a security certification. JavaScript proxies are executable and outside the object API's isolation guarantee. Prefer parsing bytes/text at untrusted boundaries. Filesystem calls are synchronous; regular files on a slow filesystem can block. Files modified during reading do not produce a guaranteed atomic snapshot. Formatters expect evaluator-produced reports, not arbitrary forged objects. Query IDs are included in reports and should not contain sensitive information.

Version 0.1.0 is unreleased. No broader support or production-readiness claim is made.
