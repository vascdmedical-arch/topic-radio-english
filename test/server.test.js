import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { buildPrompt, buildYahooNewsTopic, createServer, mockEpisode, parseYahooRss, validateEpisode } from "../server.js";

async function withServer(run) {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

async function loginCookie(baseUrl, password = "1111") {
  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/");
  return response.headers.get("set-cookie").split(";")[0];
}

test("requires the app password before serving the app", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(baseUrl, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/login");

    const login = await fetch(`${baseUrl}/login`);
    assert.equal(login.status, 200);
    assert.match(await login.text(), /パスワードを入力/);

    const failed = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "0000" }),
    });
    assert.equal(failed.status, 401);
    assert.match(await failed.text(), /パスワードが違います/);

    const api = await fetch(`${baseUrl}/api/status`);
    assert.equal(api.status, 401);
  });
});

test("serves the app shell after login", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const response = await fetch(baseUrl, { headers: { Cookie: cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    const html = await response.text();
    assert.match(html, /Topic Radio/);
    assert.match(html, /BGM気分/);
    assert.match(html, /10分ごとのパート/);
    assert.match(html, /今日のニュース/);
    assert.match(html, /英日併記/);
    assert.match(html, /step="0\.1"/);
    assert.match(html, /styles\.css\?v=20260618-4/);
    assert.match(html, /app\.js\?v=20260618-4/);
  });
});

test("returns API configuration status", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const response = await fetch(`${baseUrl}/api/status`, { headers: { Cookie: cookie } });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(typeof payload.apiConfigured, "boolean");
  });
});

test("serves the bundled free background music tracks as audio", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const tracks = [
      "upbeat-jazz.mp3",
      "light-it-up-boy.mp3",
      "serene-view.mp3",
      "island-beat.mp3",
      "tears-of-joy.mp3",
      "smile.mp3",
      "sounds-good.mp3",
      "the-root.mp3",
    ];
    for (const track of tracks) {
      const response = await fetch(`${baseUrl}/audio/${track}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "audio/mpeg");
      assert.ok((await response.arrayBuffer()).byteLength > 1000);
    }
  });
});

test("serves mobile-friendly wrapping styles", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const response = await fetch(`${baseUrl}/styles.css`, { headers: { Cookie: cookie } });
    const css = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(css, /overflow-wrap: anywhere/);
    assert.match(css, /grid-template-columns: 1fr/);
    assert.match(css, /duration-grid/);
    assert.match(css, /safe-area-inset/);
    assert.match(css, /max-width: 700px/);
  });
});

test("parses Yahoo Japan headlines and serves them through the API", async () => {
  const originalFetch = globalThis.fetch;
  const rss = `<?xml version="1.0" encoding="UTF-8"?>
    <rss><channel>
      <item><title>科学の新発見 &amp; 生活への影響</title><link>https://news.yahoo.co.jp/pickup/1?source=rss</link><pubDate>Thu, 18 Jun 2026 09:00:00 GMT</pubDate></item>
      <item><title>スポーツ大会が開幕</title><link>https://news.yahoo.co.jp/pickup/2?source=rss</link><pubDate>Thu, 18 Jun 2026 09:10:00 GMT</pubDate></item>
    </channel></rss>`;
  assert.deepEqual(parseYahooRss(rss, "科学").map((item) => item.title), [
    "科学の新発見 & 生活への影響",
    "スポーツ大会が開幕",
  ]);
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://news.yahoo.co.jp/")) {
      return new Response(rss, { status: 200, headers: { "Content-Type": "application/xml" } });
    }
    return originalFetch(url, init);
  };
  try {
    await withServer(async (baseUrl) => {
      const cookie = await loginCookie(baseUrl);
      const response = await fetch(`${baseUrl}/api/yahoo-headlines`, { headers: { Cookie: cookie } });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.match(payload.topic, /Yahoo!ニュース日本版ヘッドライン/);
      assert.ok(payload.items.length >= 2);
      assert.match(payload.sources[0].url, /^https:\/\/news\.yahoo\.co\.jp\//);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("creates a preview episode when no API key is present", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await withServer(async (baseUrl) => {
      const cookie = await loginCookie(baseUrl);
      const response = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          topic: "urban gardening",
          level: "beginner",
          duration: "30",
          newsItems: [{ title: "科学の新発見", link: "https://news.yahoo.co.jp/pickup/1", category: "科学" }],
        }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.demo, true);
      assert.match(payload.title, /urban gardening/);
      assert.ok(payload.lines.length > 4);
      assert.match(payload.lines[0].translation, /トピックラジオ/);
      assert.equal(payload.duration, "30");
      assert.equal(payload.target_minutes, 30);
      assert.equal(payload.has_more, true);
      assert.match(payload.sources[0].title, /Yahoo!ニュース/);
    });
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});

test("adds a continuation installment and stops at a fixed duration", async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await withServer(async (baseUrl) => {
      const cookie = await loginCookie(baseUrl);
      const response = await fetch(`${baseUrl}/api/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ topic: "urban gardening", level: "beginner", duration: "30", part: 3 }),
      });
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.part, 3);
      assert.equal(payload.has_more, false);
      assert.match(payload.lines[0].text, /installment 3/);
    });
  } finally {
    if (previous) process.env.OPENAI_API_KEY = previous;
  }
});

test("limits the continuous preview to a second installment", async () => {
  assert.equal(mockEpisode("coffee", "starter", "continuous", 1).has_more, true);
  assert.equal(mockEpisode("coffee", "starter", "continuous", 2).has_more, false);
});

test("rejects invalid English levels", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ topic: "urban gardening", level: "expert-ish" }),
    });
    assert.equal(response.status, 400);
  });
});

test("rejects invalid show durations", async () => {
  await withServer(async (baseUrl) => {
    const cookie = await loginCookie(baseUrl);
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ topic: "urban gardening", level: "beginner", duration: "forever-ish" }),
    });
    assert.equal(response.status, 400);
  });
});

test("validates generated dialogue", () => {
  assert.equal(validateEpisode(mockEpisode("coffee", "starter")).lines[0].speaker, "Maya");
  assert.throws(() => validateEpisode({ lines: [{ speaker: "Someone", text: "Hello" }] }));
  assert.throws(() => validateEpisode({ lines: [{ speaker: "Maya", text: "Hello" }, { speaker: "Ben", text: "Hi" }] }));
});

test("asks for a casual current radio show with Japanese interface text", () => {
  const newsItems = [{ title: "科学の新発見", link: "https://news.yahoo.co.jp/pickup/1", category: "科学" }];
  const prompt = buildPrompt("coffee", "beginner", { duration: "60", part: 2, newsItems });
  assert.match(prompt, /latest supported developments/);
  assert.match(prompt, /friendly jokes/);
  assert.match(prompt, /snappy/);
  assert.match(prompt, /do not let economics dominate/);
  assert.match(prompt, /Yahoo! JAPAN headline set/);
  assert.match(prompt, /title, dek, and level_summary in natural Japanese/);
  assert.match(prompt, /natural Japanese translation/);
  assert.match(prompt, /60-minute show/);
  assert.match(prompt, /installment 2/);
  assert.match(prompt, /Japanese junior high school level/);
  assert.match(buildPrompt("coffee", "starter"), /very common words a child would know/);
  assert.match(buildPrompt("coffee", "intermediate"), /Japanese high school to university student level/);
  assert.match(buildPrompt("coffee", "advanced"), /Eiken Grade 2 to Grade 1 range/);
  assert.match(buildYahooNewsTopic(newsItems, "2026年6月18日木曜日"), /科学/);
  assert.match(mockEpisode("coffee", "starter").title, /を楽しくキャッチアップ/);
});
