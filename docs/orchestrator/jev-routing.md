# Advisory Jev routing

TypeSafe Jev can classify a task beside `runner-routing-v4`. Jev is a System
One model: it answers typed Choice, Score, and Noul questions. It does not
write code, and this integration does not let it choose the worker.

`runner-routing-v4` remains the only routing authority. Eco mode, explicit
pins, and direct backends keep their existing selection. A Jev suggestion is
logged so it can be compared with the policy later.

## Enable

The sidecar is off unless both of these are set:

```sh
export ARC_JEV_ROUTING=1
export TYPESAFE_API_KEY='<retrieve securely at runtime>'
```

`ARC_JEV_ROUTING` must be the exact value `1`. Any other value, including an
unset variable, makes no network call and leaves traces unchanged.

| Variable | Role |
| --- | --- |
| `ARC_JEV_ROUTING` | `1` enables the advisory call |
| `TYPESAFE_API_KEY` | TypeSafe API key. Required when the flag is on. Never written to traces or logs |
| `ARC_JEV_CONFIDENCE_THRESHOLD` | Default `0.6`. A Choice or Score below this, or a Noul whose decided side is below this, is tagged `low_confidence` |
| `ARC_JEV_TIMEOUT_MS` | Per-attempt timeout in milliseconds. Default `4000`, clamped to 250–15000. Retries are disabled |
| `ARC_JEV_MODEL` | Default `jev-latest` |

Missing key, timeout, HTTP error, and malformed answers are logged and the run
continues with the normal policy selection.

## What Jev is asked

One `systemOne` call, built with `@typesafe-ai/sdk` (`choice`, `score`, `noul`):

- **Choice** of worker phase (`explore`, `research`, `plan`, `implement`, `verify`, `deploy`) when the caller has not already fixed `--phase`. Analyze stays parent-local and is not a worker-phase option.
- **Score** on the canonical difficulty axis (`easy`, `medium`, `hard`) and volume axis (`light`, `medium`, `heavy`). The nearest levels are joined into one of the nine `workload_class` ids (`hard-heavy` through `easy-light`).
- **Choice** of worker stable id from the automatic candidate stack the policy would walk, including the emergency tail. Explicit, direct, and economy routes skip this question because those paths do not choose among that stack.
- **Noul** for staying parent-local (Analyze), and **Noul** for deploy / shipping human authorization.

Suggestions at or above the threshold are tagged `advisory`. Suggestions below
it are tagged `low_confidence`. Both stay advisory: `applied` is always
`false`.

## What gets logged

When the flag is on, stderr gets one `arc-orchestrator: jev advisory ...` line.
The same record is stored on the run trace as `jevRouting`. Routing-trace v2
embeds that trace under `legacy`, so the suggestion sits on the same run as
the policy decision. The task text sent to Jev is redacted and truncated; the
trace stores the structured answers, not the prompt.

`arc-orchestrator observability` reports whether the advisory call is
configured. It records that a key is present, not the key itself.
