# Contributing

Describe the problem and the evidence before describing the implementation.
Use the [PR template](.github/pull_request_template.md), including an explicit
AI-assistance statement. Disclose which code, tests, or documentation involved
AI tools and which checks a human actually performed. The submitting author is
responsible for the change and its claims; do not describe generated fixtures as
robot captures or container tests as Home Assistant Supervisor validation.

Before changing protocol values or filesystem validation, read the
[Gen3/Gen4 identifier guide](server/docs/identifiers.md). Keep examples anonymous,
record their evidence source, and add tests at the affected protocol boundary.
Gen3 timestamp-shaped IDs and Gen4 UUID-shaped map IDs must both remain usable.

Before changing startup, data formats, permissions, or container privileges, read
[upgrade requirements](docs/upgrades.md) and [testing](docs/testing.md).
Updates of supported standard deployments must operate without manual repair
commands, including automatic image/add-on updates. Test existing data, not only
empty volumes. Describe unsupported custom configurations and failure behavior.

Keep regressions focused and reproducible. Tests should exercise observable
protocol or deployment behavior rather than only repeating implementation rules.
Record exact test commands, environment/architecture, and remaining gaps in the
PR description. Keep a PR in draft while required platform or upgrade validation
is incomplete, and update the description when its implementation changes.
