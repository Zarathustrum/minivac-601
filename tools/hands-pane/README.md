# The chat pane: run a model of your own against the simulator

A chat pane beside the web build's panel, where an LLM operates the page's own machine through
`minivac-control`, with the same words and the same output text as the command line. You bring the
model: any OpenAI-compatible endpoint, local or hosted, with your own key. It is a local dev tool:
the public static build (`npm run build`) carries none of it and holds no key.

The design and its rulings: `docs/plans/stage-3-chat-pane.md` and `docs/DECISIONS.md` (2026-11-02,
"Stage 3 shape" and "Stage 3 plan rulings"; 2026-11-03, "Chat pane in the public copy").

## What you need

- Node 26 or newer and `npm install`, as for the web build.
- An endpoint serving `POST <base>/chat/completions` in the OpenAI format, with tool calls
  (`tools` and `tool_choice: "auto"`). The model works the machine only through tool calls, so a
  model or server without them cannot use the pane. LM Studio, Ollama, vLLM, llama.cpp's server, a
  LiteLLM proxy and hosted OpenAI-compatible APIs all speak this format; tool-call support varies by
  model.
- A model that is good at tool use. On the current skill the command-line checklist (11 items, 3
  runs each) passed 33/33 on qwen3.8-flash-next, qwen3.8-27b and Claude Haiku 5.5; gemma-4-26b
  passed about 28-30 of 33. From the pane, qwen3.8-flash-next passed 35 of 36 runs over the 12
  items. `docs/STATUS.md` has the details.

## Set it up

Put your settings in a file the repository ignores (`.env*` is in `.gitignore`), not on the command
line, where the key would land in your shell history:

```bash
# .env.pane
MINIVAC_LLM_BASE_URL=http://localhost:1234/v1    # your endpoint's …/v1; no user or password in it
MINIVAC_LLM_API_KEY=your-key                     # any non-empty value if your server takes none
MINIVAC_PANE_ROUTES=qwen3.8-flash-next,gpt-oss-120b   # model names as your endpoint knows them; first is the default
```

- `MINIVAC_LLM_BASE_URL`, `MINIVAC_LLM_API_KEY` and `MINIVAC_PANE_ROUTES` are required; the server
  refuses to start without them. The names in `MINIVAC_PANE_ROUTES` are sent as the request's
  `model`, and the page offers only those.
- Optional: `MINIVAC_PANE_RUNS`, the run folder (absolute, or relative to the repository; default
  `pane-runs/`, which is ignored); `MINIVAC_PANE_MAX_TURNS`, model requests per message (default
  40); `MINIVAC_PANE_PORT` (default 8601); `MINIVAC_PANE_ORIGINS`, the exact page origins allowed,
  comma-separated (default `http://127.0.0.1:5173,http://localhost:5173`); `MINIVAC_SKILL_PATH`, a
  skill file to use instead of `.claude/skills/minivac/SKILL.md`.
- A variable already set in your shell wins over the file, so you can keep the key out of the file
  and export it yourself.

## Run it

Two terminals:

```bash
npm run dev:pane                                        # Vite on 127.0.0.1:5173, strict port
node --env-file=.env.pane tools/hands-pane/server.ts    # prints the page URL
```

Open the URL the server prints, `http://127.0.0.1:5173/dev.html#t=<token>&port=8601`. The token is
new on every launch: after a restart, open the new URL. `npm run dev:pane` fails rather than move to
another port, because the server accepts only the page origins it was given.

## Use it

- Type a request ("Make light 2 come on only while I'm holding buttons 1 and 2 together") and pick
  a model from the route list. The first message starts a session; the model creates the machine
  with `new pane.json`, as in a checklist run.
- While a session is live the panel is **frozen** (simulated time moves only inside the model's
  calls) and **locked** (it takes no clicks). It redraws after each call, and the transcript shows
  each call with the text the model was given.
- While a request to the model is out, the transcript ends in `waiting for <route> · request <n> · <s> s`.
  A long reply, such as a whole circuit in one batch, holds that line until it is in.
- **Stop** ends the model's turn. **End session** hands you the machine as the model left it, live
  and unlocked. **New session** does the same and clears the transcript. Reloading the page ends the
  session, and its run is marked invalid.
- Each session writes `<run folder>/<date>-pane-<n>/`: `transcript.jsonl` (every request and
  reply), `run.json` (the totals and how each turn ended) and `session.json` (the machine's command
  log). Grade a session against a checklist item like a command-line run:
  `bin/minivac-check checklist/items/B1.json pane-runs/<run>/session.json`.

## What leaves your machine

Your endpoint receives the system prompt (the minivac skill), your messages, the model's own calls
and their output, and whatever the model reads with its file tools. Those tools read only
`docs/research/` and `test/conformance/fixtures/` and the session's own `pane.json`. The key and
the base URL stay in the server process: they are never sent to the page, and any text bound for
the page has them taken out.

## Cost

The pane has no spending limit of its own. Each message can make up to `MINIVAC_PANE_MAX_TURNS`
requests (default 40), and a message is at most 8,000 characters. On a paid API, use a key with a
spending cap. The pane shows a cost only when a LiteLLM proxy reports one.

## Behind a LiteLLM proxy

A LiteLLM proxy reports which server answered each request, so each reply gets a badge naming it,
with any fallbacks tried and the request's cost. With `MINIVAC_PANE_PRIMARY`, a JSON object of route
to the api base it should be served by (`{"qwen3.8-flash-next":"http://<host>:<port>/v1"}`), a reply
from any other server is flagged on its badge before its calls run. A plain endpoint says none of
this, so its replies carry no badge; leave `MINIVAC_PANE_PRIMARY` unset there, or every reply is
flagged. A failed request shows a badge with its status either way.

## Safety

The server is for your own machine. It listens on 127.0.0.1 only, accepts a page only from the
allowed origins with this launch's token, and checks the Host header, so another website cannot
drive it. The token is in the URL's `#` part, which the browser never sends to a server, but it
stays in your browser history until the server restarts. Do not expose the port to a network.

## Troubleshooting

- "the server refused the token": the server restarted; open the URL it printed last.
- "this page is from another build than the server": reload the page.
- The server says a variable is missing or malformed: it names the variable, and never prints the key
  or the base URL.
- Port 5173 or 8601 in use: stop the other process, or set `MINIVAC_PANE_PORT` (and, for another
  page origin, `MINIVAC_PANE_ORIGINS`).
- A turn that ends at once with `http_<status>`: the endpoint refused the request. Its reply is in
  the run's `transcript.jsonl`; the page shows only the status.
