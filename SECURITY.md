# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Network**: it only sends HTTP GET requests to the address entered in its
  configuration, on the local network (the Fronius Solar API v1, read only).
  A GEN24 that redirects to HTTPS is followed, and its self-signed certificate
  is accepted: nothing secret is sent, the API has no authentication.
- **Secrets**: none. The Solar API has no password; credentials typed in the
  address are dropped before any request or log line.
- **`/data`**: two small JSON files, the inventory of the system (serial
  numbers of the logger, inverters, meters and batteries, and the address of
  the system) and, for a GEN24, the baseline of the production of the day.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Fronius devices and their firmware.
