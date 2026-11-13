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

## In the Godot build

The same chat, against the same server, with the machine living in the Godot desktop build
instead of the web page. Godot connects to the server as the page does and answers its requests
from a C# port of the page's engine (`dotnet/Minivac.Hands/`); the server still runs the model,
parses its words and writes the text, so the model reads the same output either way. The design
and its rulings: `docs/plans/godot-chat-pane.md` and `docs/DECISIONS.md` (2026-11-11, "Chat pane in
the Godot build").

### What you need

Everything under "What you need" and "Set it up" above, plus the Godot build's toolchain: the .NET
SDK that `global.json` pins (10.0.x) and Godot 4.7.2 mono. `docs/port/CSHARP-PORT.md` covers both,
the one-time import and `npm run sync-data`.

### Run it

1. Start the server exactly as for the web page:
   `node --env-file=.env.pane tools/hands-pane/server.ts`. `npm run dev:pane` is not needed, but the
   link it prints still names the page origin `http://127.0.0.1:5173`, because the server admits
   only an allowed origin and Godot sends the link's own origin as its Origin.
2. Build and open the Godot build: `dotnet build godot/Minivac.Godot.sln`, then
   `"$GODOT" --path godot`, with `GODOT` set to your Godot 4.7.2 mono binary.
3. Select the Chat tab at the top of the right-hand column, or press `/`. The link of a running
   server is already in the field; press Connect. The status line reads `connected`. If the field
   is empty, paste the link the server printed.

Or give the link at launch, quoted so the shell leaves the `#` and `&` alone:
`"$GODOT" --path godot -- --pane-link '<link>'`.

### What differs from the web pane

- While a session is live a banner across the top of the stage says the model has the machine,
  repeats the waiting line, and carries Stop and End session.
- The panel is locked and frozen as on the web, but the camera stays free: orbit, zoom, pan, Fit,
  Wire, the flat and 3D toggle, Sound and Help all work.
- After each call the cords that call added carry a yellow ring, in both views, until the next
  call, New session or End session. A call that adds more than 12 cords shows no rings. Lamps,
  relays and controls get no mark.
- The model's reply renders a small markdown subset: bold, italic, code, code blocks, headings and
  bullets. A link prints as `text (url)` and is not clickable. Anything else stays as typed. The
  web pane shows the reply as plain text.
- The transcript shows at most 4 KiB of each field and 16 KiB (and 50 calls) of each reply, with
  a last line saying how much is shown. The run folder's `transcript.jsonl` has all of a reply
  that succeeded.
- Quitting the app ends the session and its run is marked invalid, as a reload does on the web.
- The link is filled in for you. A running server keeps its link in `~/.minivac/pane-link`, a file
  only your account can read, and removes it when it stops; the app reads that file when it starts,
  when Chat is selected, when its window regains focus and when a connection ends. The app itself
  saves nothing. Text you typed in the field is left alone.
- The window opens at up to 80 % of the screen and the toolbar, the right-hand column and their
  text scale with the window when you resize it.
- No screen-reader support is claimed for the Godot build. The dock works from the keyboard, with
  visible focus and a tooltip on every control.

### Safety in the Godot build

- The app connects only to 127.0.0.1, whatever host the link names.
- `--pane-link` puts the token in the process's arguments, which other accounts on the same
  machine can read. On a shared machine, paste the link instead.
- The link file holds the launch token while the server runs. It is created readable by your
  account only (mode 0600, in a 0700 folder); a server that is killed outright leaves it behind,
  and its token is then useless, because a new server makes a new one.
- A web page and the Godot build can be connected at once. Each gets its own session and its own
  run folder.

### Godot's messages

The status line and the transcript say, in these words:

- `disconnected: could not connect to 127.0.0.1:<port>: the pane server is not running, or it does
  not allow this link's origin (<origin>)`: start the server, or paste its latest link. Godot
  cannot tell a server that is down from one that refuses the origin.
- `disconnected: the server refused the token: paste the link the pane server printed last`.
- `disconnected: this build and the pane server are different versions: rebuild this app or
  restart the pane server`.
- `disconnected: the pane server did not answer within 10 s: check that it is running and that the
  link is its latest, then press Connect`.
- `disconnected: the pane server closed the connection before it was ready (<code>)`.
- `disconnected: the pane server connection closed (<code>); press Connect to connect again`, with
  the transcript line `The pane server connection closed; run <run> is marked invalid.` when a
  session was live. End session then hands the panel back.
- `disconnected: the pane server did not answer End session within 15 s, so this app closed the
  connection; press Connect to connect again`.
- `disconnected: could not send to the pane server (<error>); press Connect to connect again`, or
  `could not send hello to the pane server (<error>)` while connecting.
- Under the link field: `not a link: paste the URL the pane server printed
  (http://…/dev.html#t=…&port=…)`, `the link has no token (#t=…): paste the whole URL the pane
  server printed`, or `the link's port is not a whole number from 1 to 65535`.
- `The console could not show the machine: <error>`: the app could not show the model's machine;
  End session hands the panel back.

### Its end-to-end check

`npm run godot-pane-e2e` starts this server with a scripted fake model (no real model is called)
and runs the Godot build headless against it: the model wires checklist item B1 from the dock,
lamp 1 lights, the panel stays locked until End session and is live after it, the exported session
passes `bin/minivac-check`, and the model was shown the web page engine's text byte for byte. A
second case quits the app mid-session and checks that the run is marked invalid. It needs `dotnet`
on PATH, `GODOT` set, and the project imported once; it builds the Godot project's C# first and
fails, never skips, when any of those is missing.
