---
"@neev/sdk": minor
---

Sync the sandbox lifecycle surface to the current aiagent API and add the sandbox-template catalogue.

- `neev.templates` — new read-only resource: `list()` and `get(id)` over `/api/v1beta1/sandbox-templates`.
- `sandboxes.create` now requires `sandbox_template_id` (the server resolves the image and default command from the template). `image`/`command` are optional and ignored when a template is set. **Breaking** for callers that passed only `image`.
- `CreateSandboxRequest` and `Sandbox` gain `resources` (cpu/memory_gb/disk_gb) and `egress` (mode + allow rules); `Sandbox` also gains `sandbox_template_id` and `created_by`. The removed `namespace`/`fqdn`/`k8s_uid` fields are no longer returned.
- `Sandbox` handle exposes `region`, `templateId`, and `resources`.
- `Sandbox` handle now resolves the daemon `connect_url` automatically: `files`/`exec` wait until the sandbox is Ready on first use to obtain it, cache the connection, and rebuild it if the `connect_url` changes (e.g. across a resume).
- Default `baseURL` is now the production gateway `https://api.ai.neevcloud.com/agent` (the aiagent service is routed under the `/agent` prefix), replacing `https://agent.ai.neevcloud.com`. Override with `NEEV_BASE_URL` or the `baseURL` option.
