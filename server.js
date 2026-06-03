import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");
const SCRIPT_MODEL = process.env.OPENAI_SCRIPT_MODEL || "gpt-5.4-mini";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const LEVELS = new Set(["starter", "beginner", "intermediate", "advanced", "native"]);
const DURATIONS = new Set(["10", "30", "60", "continuous"]);
const SPEAKERS = new Set(["Maya", "Ben"]);
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml",
};

const LEVEL_GUIDE = {
  starter:
    "Use extremely simple English: short sentences, basic vocabulary, gentle repetition, and clear explanations. Target 750 to 900 spoken words.",
  beginner:
    "Use simple everyday English: mostly short sentences, explain important terms, and repeat key ideas naturally. Target 850 to 1000 spoken words.",
  intermediate:
    "Use natural but accessible English: explain specialized terms once and vary sentence length moderately. Target 1050 to 1200 spoken words.",
  advanced:
    "Use fluent, nuanced English with precise vocabulary and only brief explanations for specialized terms. Target 1200 to 1400 spoken words.",
  native:
    "Use natural native-level radio English with nuance, idioms where appropriate, and a lively pace. Target 1350 to 1550 spoken words.",
};

const EPISODE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    dek: { type: "string" },
    level_summary: { type: "string" },
    estimated_minutes: { type: "number" },
    lines: {
      type: "array",
      minItems: 18,
      maxItems: 42,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["Maya", "Ben"] },
          text: { type: "string" },
          translation: { type: "string" },
        },
        required: ["speaker", "text", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["title", "dek", "level_summary", "estimated_minutes", "lines"],
  additionalProperties: false,
};

function totalPartsFor(duration) {
  return duration === "continuous" ? Infinity : Number(duration) / 10;
}

function episodeMetadata(duration, part, demo = false) {
  const totalParts = totalPartsFor(duration);
  return {
    duration,
    target_minutes: duration === "continuous" ? null : Number(duration),
    part,
    has_more: duration === "continuous" ? !demo || part < 2 : part < totalParts,
  };
}

export function buildPrompt(topic, level, { duration = "10", part = 1, previousLines = [] } = {}) {
  const totalParts = totalPartsFor(duration);
  const isFinalPart = duration !== "continuous" && part >= totalParts;
  const partPosition =
    part === 1
      ? "This is the opening installment. Give the show a welcoming introduction."
      : `This is installment ${part}. Continue naturally without repeating the show's introduction.`;
  const ending = isFinalPart
    ? "This is the final installment. End with a short recap and a friendly closing."
    : "This is not the final installment. End at a natural handoff point without a full recap or goodbye.";
  const mode =
    duration === "continuous"
      ? "The listener selected continuous mode. The show will keep receiving new installments while they listen."
      : `The listener selected a ${duration}-minute show, delivered as ${totalParts} installment${totalParts === 1 ? "" : "s"}.`;
  const context = previousLines.length
    ? `Continue from these recent lines without repeating them:\n${previousLines
        .map((line) => `${line.speaker}: ${line.text}`)
        .join("\n")}`
    : "";

  return `Create a roughly 10-minute English learning radio installment about: "${topic}".

${mode}
${partPosition}
${ending}
${context}

Research the topic on the live web before writing. Prioritize reliable recent information and compare publication dates so the segment reflects the latest supported developments. If the topic is timeless, still search for credible sources and find a current angle. The listener wants to hear useful updates and interesting facts while practicing English.

The hosts are Maya and Ben. Maya is a warm, curious female host. Ben is a thoughtful, upbeat male host. Make it sound like a lively, casual radio show or podcast, not a textbook lesson or a formal lecture. Let the hosts react to the news, ask each other natural follow-up questions, and mention surprising details. Add a few easy, friendly jokes or playful reactions when appropriate. Never force jokes, invent facts for humor, or joke about tragedy, health risks, disasters, or other sensitive subjects. Alternate speakers often, but allow an occasional second turn by the same host when natural. Include an inviting opening, 3 to 5 conversational beats, a short recap, and a friendly closing.

English level instructions:
${LEVEL_GUIDE[level]}

Write title, dek, and level_summary in natural Japanese for the app interface. Write every spoken line in English only. For every spoken line, also provide a natural Japanese translation in the translation field. Keep each individual English turn under 650 characters so it can be synthesized as speech. Do not include URLs, markdown, stage directions, citation markers, or source lists inside the spoken lines. Return only the requested structured data.`;
}

export function validateEpisode(episode) {
  if (!episode || typeof episode !== "object") {
    throw new Error("The generated episode was empty.");
  }
  if (!Array.isArray(episode.lines) || episode.lines.length < 2) {
    throw new Error("The generated episode did not contain enough dialogue.");
  }
  for (const line of episode.lines) {
    if (
      !SPEAKERS.has(line.speaker) ||
      typeof line.text !== "string" ||
      !line.text.trim() ||
      typeof line.translation !== "string" ||
      !line.translation.trim()
    ) {
      throw new Error("The generated dialogue had an invalid line.");
    }
    if (line.text.length > 4096) {
      throw new Error("A generated dialogue line was too long for speech synthesis.");
    }
  }
  return episode;
}

function demoLines() {
  return [
    ["Maya", "Welcome to Topic Radio. Today, we are tuning in to your selected topic. This is a short preview, but the full show is built to feel relaxed, current, and genuinely fun.", "トピックラジオへようこそ。今日は、選んだテーマを取り上げます。これは短いプレビューですが、本編はくつろいで楽しめる、最新情報を盛り込んだ番組になります。"],
    ["Ben", "Right. Think of it as your friendly radio catch-up, with useful information and fewer dramatic sound effects. I was told to leave my air horn at home.", "そうですね。役立つ情報を気軽にキャッチアップできるラジオだと思ってください。派手な効果音は控えめです。僕もエアホーンは家に置いてくるよう言われました。"],
    ["Maya", "A wise decision, Ben. For a live episode, the app checks current online sources before we start talking.", "賢明な判断ですね、Ben。本編では、トークを始める前にアプリが最新のオンライン情報を確認します。"],
    ["Ben", "Then we share the latest useful details, ask follow-up questions, and keep the conversation moving. It should feel more like a good coffee break than a classroom lecture.", "そして、役立つ最新情報を紹介し、追加の質問をしながら会話を進めます。教室での講義というより、楽しいコーヒーブレイクのような雰囲気です。"],
    ["Maya", "You may also hear a light joke when the moment is right. Nothing too wild. Ben is still waiting for his comedy special.", "ちょうどよいタイミングで軽いジョークも入ります。やりすぎは禁物です。Benはまだ自分のコメディ特番を待っています。"],
    ["Ben", "The venue is very exclusive. So far, it is just my kitchen. But back to the news.", "会場はとても限定的なんです。今のところ僕のキッチンだけです。でも、ニュースに戻りましょう。"],
    ["Maya", "The full show turns fresh information into English that fits your selected level. Important words stay clear, but the conversation stays natural.", "本編では、新しい情報を選択したレベルに合う英語にします。大切な言葉は分かりやすくしながら、会話は自然なままです。"],
    ["Ben", "You can slow the audio down when a sentence feels tricky, then speed it up when your ears are ready for a small adventure.", "難しい文があれば音声をゆっくりにできます。耳が小さな冒険の準備をできたら、速度を上げてみましょう。"],
    ["Maya", "The English transcript stays on screen while you listen, and the current line is highlighted. There is also a gentle background music option.", "聴いている間は英語のトランスクリプトが画面に表示され、現在の行が強調されます。穏やかなBGMも選べます。"],
    ["Ben", "So the recipe is simple: choose a topic, pick your English level, press play, and enjoy the conversation.", "使い方は簡単です。テーマと英語レベルを選び、再生ボタンを押して、会話を楽しんでください。"],
    ["Maya", "Connect your OpenAI API key to unlock live research and AI voices. For now, this preview is ready for a test drive.", "OpenAI APIキーを接続すると、最新情報の調査とAI音声を利用できます。今はこのプレビューをお試しください。"],
    ["Ben", "Thanks for listening to Topic Radio. See you next time, hopefully with zero air horns.", "トピックラジオを聴いてくれてありがとうございます。また次回。できればエアホーンはゼロで。"],
  ].map(([speaker, text, translation]) => ({ speaker, text, translation }));
}

function demoContinuationLines(part) {
  return [
    ["Maya", `Welcome back. This is preview installment ${part}. In a live show, we would now bring in another fresh angle from the latest sources.`, `おかえりなさい。これはプレビューの第${part}部です。本編では、ここで最新情報から新しい切り口を取り上げます。`],
    ["Ben", "That is one reason longer shows are useful. We can go beyond the headline and still keep the conversation easy to follow.", "長めの番組が役立つ理由のひとつですね。見出しだけで終わらず、分かりやすい会話のまま少し深く掘り下げられます。"],
    ["Maya", "We can also pause for a quick recap, then explore a new question without starting the whole show again.", "簡単に振り返ってから、番組を最初からやり直さずに新しい疑問を掘り下げることもできます。"],
    ["Ben", "Exactly. It is like ordering one more cup of coffee, except this one comes with vocabulary practice.", "その通り。コーヒーをもう一杯頼むようなものです。ただし、こちらには単語練習も付いてきます。"],
    ["Maya", "When the API is connected, each new installment is researched and added while you listen.", "APIを接続すると、聴いている間に新しいパートを調査して追加します。"],
    ["Ben", "For now, the preview continuation is complete. Thanks for staying with us.", "今回はプレビューの続きが完了しました。引き続き聴いてくれてありがとうございます。"],
  ].map(([speaker, text, translation]) => ({ speaker, text, translation }));
}

export function mockEpisode(topic, level, duration = "10", part = 1) {
  return {
    title: part === 1 ? `${topic}を楽しくキャッチアップ` : `${topic}をもっと深掘り`,
    dek: "プレビュー番組です。APIキーを設定すると、選択した長さに合わせて最新情報を調べながら英語ラジオを生成します。",
    level_summary: `${level}向けのリスニング体験をプレビュー中`,
    estimated_minutes: 2,
    lines: part === 1 ? demoLines() : demoContinuationLines(part),
    sources: [],
    demo: true,
    ...episodeMetadata(duration, part, true),
  };
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) {
      throw new HttpError(413, "入力内容が長すぎます。");
    }
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new HttpError(400, "入力内容を読み取れませんでした。");
  }
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function requireTopic(value) {
  const topic = String(value || "").trim();
  if (topic.length < 3 || topic.length > 180) {
    throw new HttpError(400, "テーマは3文字以上、180文字以内で入力してください。");
  }
  return topic;
}

function requireLevel(value) {
  const level = String(value || "");
  if (!LEVELS.has(level)) {
    throw new HttpError(400, "英語レベルを選択してください。");
  }
  return level;
}

function requireDuration(value) {
  const duration = String(value || "10");
  if (!DURATIONS.has(duration)) {
    throw new HttpError(400, "番組の長さを選択してください。");
  }
  return duration;
}

function requirePart(value) {
  const part = Number(value);
  if (!Number.isSafeInteger(part) || part < 2) {
    throw new HttpError(400, "追加するパートを確認できませんでした。");
  }
  return part;
}

function requirePreviousLines(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-6).flatMap((line) => {
    const speaker = String(line?.speaker || "");
    const text = String(line?.text || "").trim().slice(0, 650);
    return SPEAKERS.has(speaker) && text ? [{ speaker, text }] : [];
  });
}

function requireSpeechRequest(body) {
  const speaker = String(body.speaker || "");
  const text = String(body.text || "").trim();
  const speed = Number(body.speed);
  if (!SPEAKERS.has(speaker)) {
    throw new HttpError(400, "音声ホストを選択してください。");
  }
  if (!text || text.length > 4096) {
    throw new HttpError(400, "音声用テキストの長さが適切ではありません。");
  }
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
    throw new HttpError(400, "再生速度はx0.5からx2.0の間で選択してください。");
  }
  return { speaker, text, speed };
}

async function callOpenAI(path, init) {
  const response = await fetch(`https://api.openai.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`OpenAI API error ${response.status}: ${detail}`);
    throw new HttpError(response.status, "OpenAI APIで処理できませんでした。APIキーを確認して、もう一度お試しください。");
  }
  return response;
}

function outputText(response) {
  return response.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("") || "";
}

function collectSources(response) {
  const sources = [];
  for (const item of response.output || []) {
    if (item.type === "web_search_call") {
      for (const source of item.action?.sources || []) {
        sources.push({ url: source.url, title: source.title || source.url });
      }
    }
    if (item.type === "message") {
      for (const content of item.content || []) {
        for (const annotation of content.annotations || []) {
          if (annotation.type === "url_citation") {
            sources.push({ url: annotation.url, title: annotation.title || annotation.url });
          }
        }
      }
    }
  }
  const unique = new Map();
  for (const source of sources) {
    if (source.url && !unique.has(source.url)) unique.set(source.url, source);
  }
  return [...unique.values()].slice(0, 12);
}

async function generateEpisode(topic, level, { duration = "10", part = 1, previousLines = [] } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return mockEpisode(topic, level, duration, part);
  }
  const apiResponse = await callOpenAI("responses", {
    method: "POST",
    body: JSON.stringify({
      model: SCRIPT_MODEL,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      input: buildPrompt(topic, level, { duration, part, previousLines }),
      text: {
        format: {
          type: "json_schema",
          name: "radio_episode",
          strict: true,
          schema: EPISODE_SCHEMA,
        },
      },
      max_output_tokens: 12_000,
    }),
  });
  const raw = await apiResponse.json();
  const text = outputText(raw);
  if (!text) {
    throw new HttpError(502, "番組を生成できませんでした。もう一度お試しください。");
  }
  let episode;
  try {
    episode = JSON.parse(text);
  } catch {
    throw new HttpError(502, "生成した番組を読み取れませんでした。もう一度お試しください。");
  }
  return {
    ...validateEpisode(episode),
    sources: collectSources(raw),
    demo: false,
    ...episodeMetadata(duration, part),
  };
}

async function synthesizeSpeech({ speaker, text, speed }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new HttpError(503, "プレビューモードではブラウザの音声を使用します。");
  }
  const voice = speaker === "Maya" ? "marin" : "cedar";
  const role = speaker === "Maya" ? "female co-host" : "male co-host";
  return callOpenAI("audio/speech", {
    method: "POST",
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice,
      speed,
      response_format: "mp3",
      instructions: `Speak as ${role} ${speaker} on a friendly English-learning radio show. Sound warm, clear, and natural. Keep the energy conversational.`,
    }),
  });
}

async function serveStatic(req, res) {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const requested = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    throw new HttpError(404, "Not found.");
  }
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new HttpError(404, "Not found.");
  }
  if (!fileStat.isFile()) {
    throw new HttpError(404, "Not found.");
  }
  res.writeHead(200, { "Content-Type": MIME_TYPES[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

export function createServer() {
  return createHttpServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/api/status") {
        return json(res, 200, {
          apiConfigured: Boolean(process.env.OPENAI_API_KEY),
          scriptModel: SCRIPT_MODEL,
          ttsModel: TTS_MODEL,
        });
      }
      if (req.method === "POST" && req.url === "/api/generate") {
        const body = await readJson(req);
        const episode = await generateEpisode(
          requireTopic(body.topic),
          requireLevel(body.level),
          { duration: requireDuration(body.duration) },
        );
        return json(res, 200, episode);
      }
      if (req.method === "POST" && req.url === "/api/continue") {
        const body = await readJson(req);
        const episode = await generateEpisode(
          requireTopic(body.topic),
          requireLevel(body.level),
          {
            duration: requireDuration(body.duration),
            part: requirePart(body.part),
            previousLines: requirePreviousLines(body.previousLines),
          },
        );
        return json(res, 200, episode);
      }
      if (req.method === "POST" && req.url === "/api/speech") {
        const speech = await synthesizeSpeech(requireSpeechRequest(await readJson(req)));
        res.writeHead(200, {
          "Content-Type": speech.headers.get("content-type") || "audio/mpeg",
          "Cache-Control": "private, max-age=3600",
        });
        const audio = Buffer.from(await speech.arrayBuffer());
        return res.end(audio);
      }
      if (req.method === "GET") {
        return await serveStatic(req, res);
      }
      throw new HttpError(404, "Not found.");
    } catch (error) {
      const statusCode = error.statusCode || 500;
      if (statusCode >= 500) console.error(error);
      if (!res.headersSent) {
        json(res, statusCode, { error: error.message || "Something went wrong." });
      } else {
        res.end();
      }
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || "0.0.0.0";
  createServer().listen(port, host, () => {
    console.log(`Topic Radio is running at http://${host}:${port}`);
    if (!process.env.OPENAI_API_KEY) {
      console.log("OPENAI_API_KEY is not set. Starting in demo mode.");
    }
  });
}
