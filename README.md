# Topic Radio

Topic Radio researches current information about a topic on the web and turns it into a casual English-learning radio show with two hosts. The Japanese interface includes a "today's news" mode from Yahoo! JAPAN News topic RSS headlines, English / English-Japanese transcript switching, five listening levels, `10` / `30` / `60` minute and continuous listening modes, playback speed from `x0.5` to `x2.0` in `0.1` steps, optional mood-based background music with volume control, and Media Session support for more stable background playback on mobile devices.

## Start the app

Node.js 18 or newer is required.

```bash
export OPENAI_API_KEY="sk-..."
export APP_PASSWORD="1111"
node server.js
```

Then open [http://localhost:3000](http://localhost:3000).
Enter the four-digit app password when prompted. The default password is `1111`, and it can be changed with `APP_PASSWORD`.

Without `OPENAI_API_KEY`, the app starts in preview mode. Preview mode uses a sample episode and the browser's built-in speech voices so the screen and player can be tested without API charges.

## API design

- `POST /api/generate` uses the OpenAI Responses API with the built-in `web_search` tool and Structured Outputs.
- `POST /api/continue` adds researched 10-minute installments for longer and continuous shows.
- `POST /api/speech` uses the OpenAI Audio Speech API. Audio is generated one dialogue turn at a time while listening.
- `GET /api/yahoo-headlines` fetches Yahoo! JAPAN News topic RSS headlines across multiple categories for today's news mode.
- The API key stays on the server and is never sent to the browser.
- The app and API routes are protected by a simple password gate using an HTTP-only cookie.
- Source links used for web research are shown beside the episode.
- The bundled background music uses eight free Mixkit tracks grouped by mood: lively, relaxed, happy, energetic, and a mixed "random" mode. The track switches when playback enters each 10-minute installment, and the files are used under the [Mixkit Stock Music Free License](https://mixkit.co/license/#musicFree).
- Media Session metadata and controls are set during playback so API-generated audio is more likely to continue from the lock screen or while another app is open. Browser preview speech may still be paused by some mobile operating systems.

## Deploy to Render

This repository includes `render.yaml` for a Render web service.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint or Web Service from the GitHub repository.
3. Use the default commands from `render.yaml`: `npm install` and `npm start`.
4. Set `OPENAI_API_KEY` in Render's Environment settings. Do not commit the key to GitHub.
5. Keep or change `APP_PASSWORD`; the default Render value is `1111`.
6. Deploy the service and open the generated `onrender.com` URL.

Optional model overrides:

```bash
export OPENAI_SCRIPT_MODEL="gpt-5.4-mini"
export OPENAI_TTS_MODEL="gpt-4o-mini-tts"
```

## Check the app

```bash
node --test
```
