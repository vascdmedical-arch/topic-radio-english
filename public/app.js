const $ = (selector) => document.querySelector(selector);

const BGM_TRACKS = {
  lively: [
    {
      title: "Upbeat Jazz",
      artist: "Francisco Alvear",
      src: "/audio/upbeat-jazz.mp3",
      source: "https://mixkit.co/free-stock-music/mood/lively/",
    },
    {
      title: "Light it Up Boy",
      artist: "Michael Ramir C.",
      src: "/audio/light-it-up-boy.mp3",
      source: "https://mixkit.co/free-stock-music/mood/lively/",
    },
  ],
  relaxed: [
    {
      title: "Serene View",
      artist: "Arulo",
      src: "/audio/serene-view.mp3",
      source: "https://mixkit.co/free-stock-music/mood/relaxed/",
    },
    {
      title: "Island Beat",
      artist: "Arulo",
      src: "/audio/island-beat.mp3",
      source: "https://mixkit.co/free-stock-music/mood/relaxed/",
    },
  ],
  happy: [
    {
      title: "Tears of Joy",
      artist: "Michael Ramir C.",
      src: "/audio/tears-of-joy.mp3",
      source: "https://mixkit.co/free-stock-music/mood/happy/",
    },
    {
      title: "Smile",
      artist: "Michael Ramir C.",
      src: "/audio/smile.mp3",
      source: "https://mixkit.co/free-stock-music/mood/happy/",
    },
  ],
  energetic: [
    {
      title: "Sounds Good",
      artist: "Michael Ramir C.",
      src: "/audio/sounds-good.mp3",
      source: "https://mixkit.co/free-stock-music/mood/energetic/",
    },
    {
      title: "The Root",
      artist: "Michael Ramir C.",
      src: "/audio/the-root.mp3",
      source: "https://mixkit.co/free-stock-music/mood/energetic/",
    },
  ],
};
BGM_TRACKS.mix = [
  ...BGM_TRACKS.lively,
  ...BGM_TRACKS.relaxed,
  ...BGM_TRACKS.happy,
  ...BGM_TRACKS.energetic,
];

const BGM_MOOD_LABELS = {
  lively: "軽快",
  relaxed: "リラックス",
  happy: "ハッピー",
  energetic: "エネルギッシュ",
  mix: "おまかせ",
};

const state = {
  episode: null,
  index: 0,
  isPlaying: false,
  loopRunning: false,
  session: 0,
  activeAudio: null,
  activeResolve: null,
  audioCache: new Map(),
  demoMode: false,
  transcriptLanguage: "en",
  topic: "",
  newsItems: [],
  level: "beginner",
  duration: "10",
  continuePromise: null,
  episodeToken: 0,
  bgmEnabled: true,
  bgmAudio: null,
  bgmMood: "lively",
  bgmTrack: null,
  bgmPartTracks: new Map(),
  currentPlaybackPart: 1,
  partStarts: [],
};

const els = {
  apiState: $("#apiState"),
  bgmLabel: $("#bgmLabel"),
  bgmMoodButtons: document.querySelectorAll("[data-bgm-mood]"),
  bgmToggle: $("#bgmToggle"),
  bgmTrackLink: $("#bgmTrackLink"),
  bgmTrackMeta: $("#bgmTrackMeta"),
  bgmVolume: $("#bgmVolume"),
  durationHelp: $("#durationHelp"),
  durationNote: $("#durationNote"),
  episodeShell: $("#episodeShell"),
  episodeDuration: $("#episodeDuration"),
  episodeTitle: $("#episodeTitle"),
  episodeDek: $("#episodeDek"),
  episodeLevel: $("#episodeLevel"),
  form: $("#studioForm"),
  generateButton: $("#generateButton"),
  nowSpeaker: $("#nowSpeaker"),
  playButton: $("#playButton"),
  playIcon: $("#playIcon"),
  progressBar: $("#progressBar"),
  restartButton: $("#restartButton"),
  loadMoreButton: $("#loadMoreButton"),
  showEnglishButton: $("#showEnglishButton"),
  showJapaneseButton: $("#showJapaneseButton"),
  sourcesList: $("#sourcesList"),
  speed: $("#speed"),
  speedValue: $("#speedValue"),
  timeEstimate: $("#timeEstimate"),
  todayNewsButton: $("#todayNewsButton"),
  toast: $("#toast"),
  topic: $("#topic"),
  transcript: $("#transcript"),
  transcriptEyebrow: $("#transcriptEyebrow"),
  transcriptTitle: $("#transcriptTitle"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "処理できませんでした。もう一度お試しください。");
  }
  return response;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("is-hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.add("is-hidden"), 5500);
}

function setApiState(configured) {
  els.apiState.classList.toggle("connected", configured);
  els.apiState.classList.toggle("demo", !configured);
  els.apiState.lastElementChild.textContent = configured ? "API 接続済み" : "プレビューモード";
}

async function checkStatus() {
  try {
    const response = await api("/api/status");
    const status = await response.json();
    state.demoMode = !status.apiConfigured;
    setApiState(status.apiConfigured);
  } catch {
    els.apiState.lastElementChild.textContent = "接続を確認できません";
  }
}

function selectedLevel() {
  return new FormData(els.form).get("level");
}

function selectedDuration() {
  return new FormData(els.form).get("duration");
}

function levelLabel(level) {
  return {
    starter: "超初心者",
    beginner: "初心者",
    intermediate: "中級",
    advanced: "上級",
    native: "ネイティブ",
  }[level] || String(level).toUpperCase();
}

function durationLabel(duration) {
  return {
    10: "10分",
    30: "30分",
    60: "1時間",
    continuous: "継続",
  }[duration] || "10分";
}

function updateDurationChoice() {
  const duration = selectedDuration();
  const continuous = duration === "continuous";
  els.durationNote.textContent = continuous ? "停止するまで継続" : `通常速度で約${durationLabel(duration)}`;
  els.durationHelp.textContent = continuous
    ? "聴いている間、約10分ごとに新しいパートを追加します。"
    : duration === "10"
      ? "気軽に聴ける短めの番組です。"
      : `約10分ごとに新しいパートを追加して、${durationLabel(duration)}の番組にします。`;
}

function renderTranscript(lines) {
  els.transcript.replaceChildren(
    ...lines.map((line, index) => {
      const item = document.createElement("div");
      item.className = `line ${line.speaker.toLowerCase()}`;
      item.dataset.index = index;
      const speaker = document.createElement("span");
      speaker.className = "line-speaker";
      speaker.textContent = line.speaker;
      const textWrap = document.createElement("div");
      const text = document.createElement("p");
      text.className = "line-text";
      text.textContent = line.text;
      textWrap.append(text);
      if (state.transcriptLanguage === "both") {
        const translation = document.createElement("p");
        translation.className = "line-translation";
        translation.textContent = line.translation;
        textWrap.append(translation);
      }
      item.append(speaker, textWrap);
      return item;
    }),
  );
}

function setTranscriptLanguage(language) {
  state.transcriptLanguage = language;
  const isBoth = language === "both";
  els.showEnglishButton.classList.toggle("is-active", !isBoth);
  els.showEnglishButton.setAttribute("aria-pressed", String(!isBoth));
  els.showJapaneseButton.classList.toggle("is-active", isBoth);
  els.showJapaneseButton.setAttribute("aria-pressed", String(isBoth));
  els.transcriptEyebrow.textContent = isBoth ? "英語と日本語を並べて確認する" : "英語を目で追いながら聴く";
  els.transcriptTitle.textContent = isBoth ? "英日併記トランスクリプト" : "英語トランスクリプト";
  if (state.episode) {
    renderTranscript(state.episode.lines);
    updateProgress();
  }
}

function renderSources(sources) {
  if (!sources?.length) {
    const empty = document.createElement("p");
    empty.className = "source-empty";
    empty.textContent = "現在はプレビューモードです。APIキーを設定すると、Webで最新情報を調べて参考リンクを表示します。";
    els.sourcesList.replaceChildren(empty);
    return;
  }
  els.sourcesList.replaceChildren(
    ...sources.map((source, index) => {
      const link = document.createElement("a");
      link.className = "source-link";
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `${String(index + 1).padStart(2, "0")}  ${source.title}`;
      const domain = document.createElement("span");
      domain.textContent = new URL(source.url).hostname;
      link.append(domain);
      return link;
    }),
  );
}

function updateEstimate() {
  if (state.duration === "continuous") {
    els.timeEstimate.textContent = `継続中 · ${state.episode?.part || 1}部`;
    return;
  }
  const minutes = Number(state.episode?.target_minutes || state.duration || 10) / Number(els.speed.value);
  els.timeEstimate.textContent = `約${Math.max(1, Math.round(minutes))}分`;
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) return;
  if (state.episode && "MediaMetadata" in window) {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: state.episode.title || "Topic Radio",
      artist: "Maya & Ben",
      album: "トピックラジオ",
    });
  }
  try {
    navigator.mediaSession.playbackState = state.isPlaying ? "playing" : "paused";
  } catch {
    // Some browsers expose Media Session only partially.
  }
}

function updatePlaybackButton() {
  els.playIcon.textContent = state.isPlaying ? "❚❚" : "▶";
  els.playButton.setAttribute("aria-label", state.isPlaying ? "番組を一時停止" : "番組を再生");
  updateMediaSession();
}

function updateProgress() {
  const count = state.episode?.lines.length || 1;
  const progress = state.index >= count ? 100 : (state.index / count) * 100;
  els.progressBar.style.width = `${progress}%`;
  document.querySelectorAll(".line").forEach((line, index) => {
    const active = index === state.index && state.index < count;
    line.classList.toggle("active", active);
    if (active && !document.hidden) line.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

function updateLoadMoreButton() {
  const canLoad = Boolean(state.episode?.has_more);
  els.loadMoreButton.classList.toggle("is-hidden", !canLoad);
  els.loadMoreButton.disabled = Boolean(state.continuePromise);
  els.loadMoreButton.textContent = state.continuePromise ? "次のパートを準備中…" : "次の10分を準備する";
}

function tracksForMood(mood = state.bgmMood) {
  return BGM_TRACKS[mood] || BGM_TRACKS.lively;
}

function bgmTrackForPart(part = state.currentPlaybackPart || 1) {
  const tracks = tracksForMood();
  const key = `${state.bgmMood}:${Number(part || 1)}`;
  if (state.bgmPartTracks.has(key)) return state.bgmPartTracks.get(key);
  let track = tracks[Math.floor(Math.random() * tracks.length)] || tracks[0];
  if (tracks.length > 1 && state.bgmTrack?.src === track.src) {
    const alternatives = tracks.filter((candidate) => candidate.src !== state.bgmTrack.src);
    track = alternatives[Math.floor(Math.random() * alternatives.length)] || track;
  }
  state.bgmPartTracks.set(key, track);
  return track;
}

function currentPartForLine(index = state.index) {
  let part = state.partStarts[0]?.part || 1;
  for (const entry of state.partStarts) {
    if (index >= entry.index) part = entry.part;
  }
  return part;
}

function updateBgmCredit(track = bgmTrackForPart(), part = state.currentPlaybackPart || 1) {
  els.bgmTrackLink.textContent = track.title;
  els.bgmTrackLink.href = track.source;
  els.bgmTrackMeta.textContent = `/ ${track.artist} · ${BGM_MOOD_LABELS[state.bgmMood]} · パート${part} · Mixkit`;
}

function updateBgmMoodButtons() {
  els.bgmMoodButtons.forEach((button) => {
    const active = button.dataset.bgmMood === state.bgmMood;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function createBgmAudio(track) {
  const audio = new Audio(track.src);
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = Number(els.bgmVolume.value);
  audio.addEventListener("error", () => showToast("BGMを読み込めませんでした。"));
  state.bgmAudio = audio;
  state.bgmTrack = track;
  return audio;
}

function setBgmTrackForPart(part, { restart = false, play = false } = {}) {
  state.currentPlaybackPart = Number(part || 1);
  const track = bgmTrackForPart(state.currentPlaybackPart);
  updateBgmCredit(track, state.currentPlaybackPart);

  if (state.bgmAudio && state.bgmTrack?.src === track.src) {
    state.bgmAudio.volume = Number(els.bgmVolume.value);
    if (restart) state.bgmAudio.currentTime = 0;
    if (play) state.bgmAudio.play().catch(() => showToast("BGMを再生できませんでした。"));
    return state.bgmAudio;
  }

  const wasPlaying = Boolean(state.bgmAudio && !state.bgmAudio.paused);
  state.bgmAudio?.pause();
  const audio = createBgmAudio(track);
  if (restart) audio.currentTime = 0;
  if (play || (wasPlaying && state.bgmEnabled)) {
    audio.play().catch(() => showToast("BGMを再生できませんでした。"));
  }
  return audio;
}

function syncBgmToCurrentPart({ restart = false, play = false } = {}) {
  const part = currentPartForLine();
  if (part !== state.currentPlaybackPart || !state.bgmAudio) {
    return setBgmTrackForPart(part, { restart, play });
  }
  updateBgmCredit(state.bgmTrack || bgmTrackForPart(part), part);
  return state.bgmAudio;
}

function renderEpisode(episode, level) {
  state.episode = episode;
  state.demoMode = Boolean(episode.demo);
  state.level = level;
  state.duration = episode.duration || selectedDuration();
  state.index = 0;
  state.currentPlaybackPart = Number(episode.part || 1);
  state.partStarts = [{ part: state.currentPlaybackPart, index: 0 }];
  state.audioCache.clear();
  state.bgmPartTracks.clear();
  els.episodeTitle.textContent = episode.title;
  els.episodeDek.textContent = episode.dek;
  els.episodeLevel.textContent = `${levelLabel(level)}向け英語`;
  els.episodeDuration.textContent = state.duration === "continuous" ? "継続モード" : `${durationLabel(state.duration)}番組`;
  renderTranscript(episode.lines);
  renderSources(episode.sources);
  updateEstimate();
  updateProgress();
  updateLoadMoreButton();
  setBgmTrackForPart(state.currentPlaybackPart, { restart: true });
  els.nowSpeaker.textContent = episode.demo ? "プレビューを再生できます" : "番組を再生できます";
  els.episodeShell.classList.remove("is-hidden");
  els.episodeShell.scrollIntoView({ behavior: "smooth", block: "start" });
  updateMediaSession();
}

async function generateEpisodeFromSelection({ newsItems = [], topic = els.topic.value.trim(), sourceLabel = "" } = {}) {
  stopPlayback({ reset: true });
  const token = ++state.episodeToken;
  state.topic = topic;
  state.newsItems = Array.isArray(newsItems) ? newsItems : [];
  state.continuePromise = null;
  els.generateButton.disabled = true;
  els.todayNewsButton.disabled = true;
  els.generateButton.firstElementChild.textContent = sourceLabel || "最新情報を調べて番組を準備中…";
  try {
    const response = await api("/api/generate", {
      method: "POST",
      body: JSON.stringify({
        topic: state.topic,
        level: selectedLevel(),
        duration: selectedDuration(),
        newsItems: state.newsItems,
      }),
    });
    const episode = await response.json();
    if (token !== state.episodeToken) return;
    renderEpisode(episode, selectedLevel());
    if (episode.demo) showToast("プレビューモードです。APIキーを設定すると、最新のWeb情報とAI音声で番組を作成します。");
  } catch (error) {
    showToast(error.message);
  } finally {
    els.generateButton.disabled = false;
    els.todayNewsButton.disabled = false;
    els.generateButton.firstElementChild.textContent = "英語ラジオをつくる";
  }
}

async function generateTodayNewsEpisode() {
  els.todayNewsButton.disabled = true;
  els.todayNewsButton.textContent = "見出しを取得中…";
  try {
    const response = await api("/api/yahoo-headlines");
    const payload = await response.json();
    els.topic.value = payload.topic;
    await generateEpisodeFromSelection({
      topic: payload.topic,
      newsItems: payload.items,
      sourceLabel: "Yahoo!ニュースから番組を準備中…",
    });
  } catch (error) {
    showToast(error.message);
  } finally {
    els.todayNewsButton.disabled = false;
    els.todayNewsButton.textContent = "今日のニュース";
  }
}

function mergeSources(current = [], added = []) {
  const sources = new Map(current.map((source) => [source.url, source]));
  added.forEach((source) => sources.set(source.url, source));
  return [...sources.values()].slice(0, 18);
}

async function loadNextPart() {
  if (!state.episode?.has_more) return false;
  if (state.continuePromise) return state.continuePromise;
  const token = state.episodeToken;
  const nextPart = Number(state.episode.part || 1) + 1;
  const promise = (async () => {
    updateLoadMoreButton();
    if (!state.isPlaying) els.nowSpeaker.textContent = "次のパートを準備中…";
    const response = await api("/api/continue", {
      method: "POST",
      body: JSON.stringify({
        topic: state.topic,
        level: state.level,
        duration: state.duration,
        part: nextPart,
        previousLines: state.episode.lines.slice(-6),
        newsItems: state.newsItems,
      }),
    });
    const addition = await response.json();
    if (token !== state.episodeToken) return false;
    const partStartIndex = state.episode.lines.length;
    state.episode.lines.push(...addition.lines);
    state.episode.sources = mergeSources(state.episode.sources, addition.sources);
    state.episode.part = addition.part;
    state.episode.has_more = addition.has_more;
    state.partStarts.push({ part: Number(addition.part), index: partStartIndex });
    renderTranscript(state.episode.lines);
    renderSources(state.episode.sources);
    updateEstimate();
    updateProgress();
    updateMediaSession();
    if (!state.isPlaying) els.nowSpeaker.textContent = `パート${addition.part}を再生できます`;
    if (addition.demo && state.duration === "continuous" && !addition.has_more) {
      showToast("継続モードのプレビューは第2部までです。APIキーを設定すると、聴いている間は継続します。");
    }
    return true;
  })();
  state.continuePromise = promise;
  try {
    return await promise;
  } finally {
    if (state.continuePromise === promise) state.continuePromise = null;
    updateLoadMoreButton();
  }
}

function ensureBgm() {
  return syncBgmToCurrentPart();
}

async function startBgm() {
  if (!state.bgmEnabled) return;
  const audio = syncBgmToCurrentPart({ play: false });
  audio.volume = Number(els.bgmVolume.value);
  try {
    await audio.play();
  } catch {
    showToast("BGMを再生できませんでした。");
  }
}

function stopBgm() {
  state.bgmAudio?.pause();
}

function stopPlayback({ reset = false } = {}) {
  state.isPlaying = false;
  state.session += 1;
  stopBgm();
  if (state.activeAudio) {
    state.activeAudio.pause();
    state.activeAudio = null;
  }
  window.speechSynthesis?.cancel();
  state.activeResolve?.();
  state.activeResolve = null;
  state.loopRunning = false;
  updatePlaybackButton();
  if (reset) {
    state.index = 0;
    if (state.episode) setBgmTrackForPart(currentPartForLine(0), { restart: true });
    els.nowSpeaker.textContent = state.episode?.demo ? "プレビューを再生できます" : "番組を再生できます";
    updateProgress();
  }
}

async function getAudio(index) {
  const speed = Number(els.speed.value);
  const cacheKey = `${index}:${speed}`;
  if (state.audioCache.has(cacheKey)) return state.audioCache.get(cacheKey);
  const line = state.episode.lines[index];
  const response = await api("/api/speech", {
    method: "POST",
    body: JSON.stringify({ speaker: line.speaker, text: line.text, speed }),
  });
  const audio = new Audio(URL.createObjectURL(await response.blob()));
  audio.preload = "auto";
  audio.playsInline = true;
  audio.dataset.generatedSpeed = speed;
  state.audioCache.set(cacheKey, audio);
  return audio;
}

function preloadAudio(index) {
  if (state.demoMode || !state.episode || index >= state.episode.lines.length) return;
  getAudio(index).catch(() => {});
}

function speakWithBrowser(index, session) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || session !== state.session) return resolve();
    const line = state.episode.lines[index];
    const utterance = new SpeechSynthesisUtterance(line.text);
    utterance.lang = "en-US";
    utterance.rate = Number(els.speed.value);
    const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.startsWith("en"));
    utterance.voice = voices.find((voice) => line.speaker === "Maya" ? /samantha|zira|female/i.test(voice.name) : /daniel|alex|male/i.test(voice.name)) || voices[index % Math.max(voices.length, 1)];
    utterance.onend = resolve;
    utterance.onerror = resolve;
    state.activeResolve = resolve;
    window.speechSynthesis.speak(utterance);
  });
}

function playAudio(audio, session) {
  return new Promise((resolve, reject) => {
    if (session !== state.session) return resolve();
    state.activeAudio = audio;
    state.activeResolve = resolve;
    audio.currentTime = 0;
    audio.playbackRate = Number(els.speed.value) / Number(audio.dataset.generatedSpeed || 1);
    audio.onended = resolve;
    audio.onerror = () => reject(new Error("音声を再生できませんでした。"));
    updateMediaSession();
    audio.play().catch(reject);
  });
}

function jumpToLine(index) {
  if (!state.episode?.lines.length) return;
  const shouldResume = state.isPlaying;
  const maxIndex = state.episode.lines.length - 1;
  stopPlayback();
  state.index = Math.max(0, Math.min(index, maxIndex));
  syncBgmToCurrentPart({ restart: true });
  updateProgress();
  const line = state.episode.lines[state.index];
  els.nowSpeaker.textContent = `${line.speaker} から再生できます`;
  if (shouldResume) {
    state.isPlaying = true;
    updatePlaybackButton();
    startBgm();
    runPlayback();
  } else {
    updateMediaSession();
  }
}

function setupMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const setHandler = (action, handler) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Unsupported media actions vary by browser.
    }
  };
  setHandler("play", () => {
    if (state.episode && !state.isPlaying) togglePlayback();
  });
  setHandler("pause", () => {
    if (!state.episode) return;
    stopPlayback();
    els.nowSpeaker.textContent = "一時停止中";
  });
  setHandler("stop", () => {
    if (!state.episode) return;
    stopPlayback();
    els.nowSpeaker.textContent = "停止しました";
  });
  setHandler("previoustrack", () => jumpToLine(state.index - 1));
  setHandler("nexttrack", () => jumpToLine(state.index + 1));
  updateMediaSession();
}

async function runPlayback() {
  if (!state.episode || state.loopRunning) return;
  const session = state.session;
  state.loopRunning = true;
  try {
    while (state.isPlaying && session === state.session) {
      if (state.index >= state.episode.lines.length) {
        if (state.episode.has_more) {
          els.nowSpeaker.textContent = "次のパートを準備中…";
          await loadNextPart();
          continue;
        }
        break;
      }
      const remainingLines = state.episode.lines.length - state.index;
      if (remainingLines <= 4 && state.episode.has_more && !state.continuePromise) {
        loadNextPart().catch((error) => {
          state.episode.has_more = false;
          updateLoadMoreButton();
          showToast(error.message);
        });
      }
      const line = state.episode.lines[state.index];
      syncBgmToCurrentPart({ restart: true, play: state.bgmEnabled && state.isPlaying });
      els.nowSpeaker.textContent = `${line.speaker} が話しています`;
      updateProgress();
      updateMediaSession();
      if (state.demoMode) {
        await speakWithBrowser(state.index, session);
      } else {
        preloadAudio(state.index + 1);
        await playAudio(await getAudio(state.index), session);
      }
      state.activeResolve = null;
      state.activeAudio = null;
      if (state.isPlaying && session === state.session) state.index += 1;
    }
    if (state.index >= state.episode.lines.length && !state.episode.has_more) {
      state.index = state.episode.lines.length;
      updateProgress();
      stopPlayback();
      els.nowSpeaker.textContent = "番組が終了しました";
    }
  } catch (error) {
    stopPlayback();
    showToast(error.message);
  } finally {
    if (session === state.session) state.loopRunning = false;
    updateMediaSession();
  }
}

function togglePlayback() {
  if (!state.episode) return;
  if (state.isPlaying) {
    stopPlayback();
    els.nowSpeaker.textContent = "一時停止中";
    return;
  }
  if (state.index >= state.episode.lines.length) state.index = 0;
  state.isPlaying = true;
  updatePlaybackButton();
  startBgm();
  runPlayback();
}

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await generateEpisodeFromSelection({ newsItems: [] });
});

els.playButton.addEventListener("click", togglePlayback);
els.loadMoreButton.addEventListener("click", () => {
  loadNextPart().catch((error) => showToast(error.message));
});
els.restartButton.addEventListener("click", () => {
  stopPlayback({ reset: true });
  showToast("番組を最初から再生できます。");
});
els.showEnglishButton.addEventListener("click", () => setTranscriptLanguage("en"));
els.showJapaneseButton.addEventListener("click", () => setTranscriptLanguage("both"));
els.todayNewsButton.addEventListener("click", generateTodayNewsEpisode);
els.form.querySelectorAll("input[name='duration']").forEach((input) => {
  input.addEventListener("change", updateDurationChoice);
});
els.bgmMoodButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mood = button.dataset.bgmMood;
    if (!BGM_TRACKS[mood]) return;
    state.bgmMood = mood;
    state.bgmPartTracks.clear();
    updateBgmMoodButtons();
    const part = currentPartForLine();
    setBgmTrackForPart(part, { restart: true, play: state.bgmEnabled && state.isPlaying });
  });
});
els.speed.addEventListener("input", () => {
  els.speedValue.textContent = `x${Number(els.speed.value).toFixed(1)}`;
  updateEstimate();
  if (state.activeAudio) {
    state.activeAudio.playbackRate = Number(els.speed.value) / Number(state.activeAudio.dataset.generatedSpeed || 1);
  }
});
els.bgmToggle.addEventListener("click", () => {
  state.bgmEnabled = !state.bgmEnabled;
  els.bgmToggle.classList.toggle("is-on", state.bgmEnabled);
  els.bgmToggle.setAttribute("aria-pressed", String(state.bgmEnabled));
  els.bgmLabel.textContent = state.bgmEnabled ? "BGM オン" : "BGM オフ";
  if (state.bgmEnabled && state.isPlaying) startBgm();
  if (!state.bgmEnabled) stopBgm();
});
els.bgmVolume.addEventListener("input", () => {
  if (!state.bgmAudio) return;
  state.bgmAudio.volume = Number(els.bgmVolume.value);
});
document.addEventListener("visibilitychange", () => {
  updateMediaSession();
  if (!document.hidden) updateProgress();
});

updateDurationChoice();
updateBgmMoodButtons();
updateBgmCredit();
setupMediaSession();
checkStatus();
