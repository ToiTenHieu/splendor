'use strict';
// Âm thanh + nhạc nền kiểu Phục Hưng (tự tổng hợp bằng WebAudio; vài tiếng dùng file gốc BGA) và hoạt ảnh thao tác.
const FX = (function () {
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lang = 'vi';
  const i18n = () => (typeof SPLENDOR_I18N !== 'undefined' ? SPLENDOR_I18N : window.SPLENDOR_I18N);
  const tr = (key) => { const I = i18n(); return I ? I.tr(lang, key) : key; };
  function setLang(code) { const I = i18n(); lang = I ? I.normalizeLang(code) : (String(code).toLowerCase().startsWith('en') ? 'en' : 'vi'); }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  let musicOn = store.get('splendor_music', true), sfxOn = store.get('splendor_sfx', true);

  // ================= ÂM THANH =================
  let ctx = null, master, musicBus, sfxBus, verb, started = false;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function impulse(sec, decay) {
    const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
    return b;
  }
  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
    master.connect(comp); comp.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? musicVol : 0;
    sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? sfxVol : 0;
    verb = ctx.createConvolver(); verb.buffer = impulse(2.4, 2.6);
    const vg = ctx.createGain(); vg.gain.value = 0.42; verb.connect(vg); vg.connect(master);
    musicBus.connect(master); musicBus.connect(verb);
    sfxBus.connect(master); const sv = ctx.createGain(); sv.gain.value = 0.35; sfxBus.connect(sv); sv.connect(verb);
    loadSamples();
    return true;
  }
  // tiếng gốc BGA (public/bga); chưa tải xong hoặc lỗi thì dùng tiếng tự tổng hợp trong SFX
  const SAMPLES = { tok: ['chipdrop2'], clink: ['chipdrop', 'chipdrop2'], coin: ['chipdrop'], noble: ['buynoble'], turn: ['ping'] }, BUF = {};
  function loadSamples() {
    for (const n of new Set(Object.values(SAMPLES).flat()))
      fetch(`bga/splendor_${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((b) => ctx.decodeAudioData(b)).then((b) => { BUF[n] = b; }).catch(() => {});
  }
  function sample(name) {
    const L = (SAMPLES[name] || []).filter((n) => BUF[n]); if (!L.length) return false;
    const s = ctx.createBufferSource(); s.buffer = BUF[L[Math.floor(Math.random() * L.length)]]; s.connect(sfxBus); s.start(); return true;
  }
  function noiseBuf() {
    if (noiseBuf.b) return noiseBuf.b;
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return (noiseBuf.b = b);
  }
  // nốt gảy (đàn luýt / đàn clavico)
  function pluck(bus, t, midi, dur, vol, bright) {
    const f = mtof(midi), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(f * (bright || 5), t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.3, 300), t + dur * 0.7);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [type, det, m] of [['triangle', 0, 1], ['sawtooth', 4, 0.35]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = m; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.05);
    }
    lp.connect(g); g.connect(bus);
  }
  // sáo recorder: sine + hơi thở + vibrato nhẹ
  function flute(bus, t, midi, dur, vol) {
    const f = mtof(midi), o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f; o2.type = 'triangle'; o2.frequency.value = f * 2;
    lfo.frequency.value = 5.2; lg.gain.value = f * 0.004; lfo.connect(lg); lg.connect(o.frequency);
    const og2 = ctx.createGain(); og2.gain.value = 0.12; o2.connect(og2);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.07); g.gain.setValueAtTime(vol * 0.9, t + dur - 0.12); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); og2.connect(g); g.connect(bus);
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(); n.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(vol * 0.25, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    n.connect(bp); bp.connect(ng); ng.connect(bus);
    o.start(t); o2.start(t); lfo.start(t); n.start(t); for (const x of [o, o2, lfo, n]) x.stop(t + dur + 0.05);
  }
  function pad(bus, t, midis, dur, vol) {
    for (const m of midis) {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.value = mtof(m); o2.frequency.value = mtof(m); o2.detune.value = 9;
      lp.type = 'lowpass'; lp.frequency.value = 650;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(bus); o.start(t); o2.start(t); o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
    }
  }
  function drum(bus, t, vol, pitch) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(pitch * 1.8, t); o.frequency.exponentialRampToValueAtTime(pitch, t + 0.08);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
  }
  function shaker(bus, t, vol) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(); const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    n.connect(hp); hp.connect(g); g.connect(bus); n.start(t); n.stop(t + 0.1);
  }

  // --- các bản nhạc (mỗi bản 8 ô nhịp 4/4, lặp lại) ---
  const A8 = [0, 2, 1, 3, 2, 3, 1, 2];
  const TRACKS = [
    { id: 'pavane', name: 'Pavane buổi sớm', desc: 'Chậm rãi, sáo và đàn luýt', bpm: 74, lead: 'alt', pad: 0.035,
      chords: [[50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [45, 52, 57, 61], [50, 57, 62, 65], [41, 53, 60, 65], [48, 55, 60, 64], [45, 52, 57, 61]],
      arp: { pat: A8, dur: 1.6 }, drum: [[0, .1, 85], [2, .07, 95]], shk: [[1, .03], [3, .03], [2.5, .018]],
      mel: [
        [[69, 0, 1.5], [74, 1.5, .5], [72, 2, 1], [70, 3, 1]], [[69, 0, 2], [67, 2, 1], [69, 3, 1]],
        [[70, 0, 1.5], [69, 1.5, .5], [67, 2, 1], [65, 3, 1]], [[64, 0, 1], [65, 1, 1], [61, 2, 1], [64, 3, 1]],
        [[74, 0, 2], [72, 2, 1], [74, 3, 1]], [[77, 0, 1.5], [76, 1.5, .5], [74, 2, 1], [72, 3, 1]],
        [[72, 0, 1], [74, 1, 1], [76, 2, 2]], [[77, 0, 1], [76, 1, 1], [73, 2, 1], [69, 3, 1]]] },
    { id: 'galliard', name: 'Galliard hội làng', desc: 'Nhanh, vui, đàn luýt dẫn', bpm: 104, lead: 'lute', pad: 0.025,
      chords: [[45, 52, 57, 60], [43, 50, 55, 59], [41, 48, 53, 57], [40, 47, 52, 56], [45, 52, 57, 60], [43, 50, 55, 59], [41, 48, 53, 57], [40, 47, 52, 56]],
      arp: { pat: A8, dur: 1.2 }, drum: [[0, .11, 90], [1, .05, 110], [2, .09, 90], [3, .05, 110]], shk: [[.5, .03], [1.5, .03], [2.5, .03], [3.5, .03]],
      mel: [
        [[69, 0, 1], [72, 1, .5], [71, 1.5, .5], [69, 2, 1], [64, 3, 1]], [[67, 0, 1], [71, 1, .5], [69, 1.5, .5], [67, 2, 1], [62, 3, 1]],
        [[65, 0, 1], [69, 1, 1], [72, 2, 1], [69, 3, 1]], [[68, 0, 1], [71, 1, 1], [76, 2, 1.5], [71, 3.5, .5]],
        [[76, 0, 2], [72, 2, 1], [69, 3, 1]], [[74, 0, 2], [71, 2, 1], [67, 3, 1]],
        [[72, 0, 1.5], [69, 1.5, .5], [65, 2, 2]], [[68, 0, 1], [71, 1, 1], [68, 2, 1], [64, 3, 1]]] },
    { id: 'nightcastle', name: 'Đêm lâu đài', desc: 'Êm dịu, sáo ngân dài', bpm: 58, lead: 'flute', pad: 0.05,
      chords: [[41, 48, 53, 57], [48, 55, 60, 64], [50, 57, 62, 65], [46, 53, 58, 62], [41, 48, 53, 57], [45, 52, 57, 60], [46, 53, 58, 62], [48, 55, 60, 64]],
      arp: { pat: [0, 2, 1, 3], dur: 3 }, drum: [[0, .05, 70]], shk: [],
      mel: [
        [[69, 0, 2], [72, 2, 2]], [[76, 0, 3], [74, 3, 1]], [[74, 0, 2], [69, 2, 2]], [[70, 0, 2], [74, 2, 2]],
        [[72, 0, 4]], [[69, 0, 2], [76, 2, 2]], [[74, 0, 2], [70, 2, 2]], [[72, 0, 3], [67, 3, 1]]] },
    { id: 'tarantella', name: 'Tarantella quảng trường', desc: 'Dồn dập, sáo và luýt cùng chơi', bpm: 126, lead: 'both', pad: 0.02,
      chords: [[50, 57, 62, 65], [48, 55, 60, 64], [50, 57, 62, 65], [48, 55, 60, 64], [46, 53, 58, 62], [48, 55, 60, 64], [45, 52, 57, 61], [50, 57, 62, 65]],
      arp: { pat: A8, dur: 0.9 }, drum: [[0, .12, 90], [1, .06, 120], [2, .1, 90], [3, .06, 120]], shk: [[.5, .035], [1.5, .035], [2.5, .035], [3.5, .035]],
      mel: [
        [[74, 0, .5], [77, .5, .5], [81, 1, 1], [77, 2, .5], [74, 2.5, .5], [72, 3, 1]], [[76, 0, .5], [72, .5, .5], [79, 1, 1], [76, 2, 1], [72, 3, 1]],
        [[74, 0, .5], [77, .5, .5], [81, 1, 1], [77, 2, .5], [74, 2.5, .5], [72, 3, 1]], [[72, 0, 1], [76, 1, 1], [79, 2, 2]],
        [[74, 0, 1], [70, 1, 1], [77, 2, 1], [74, 3, 1]], [[76, 0, 1], [79, 1, 1], [84, 2, 1], [79, 3, 1]],
        [[73, 0, 1], [76, 1, 1], [81, 2, 1], [76, 3, 1]], [[77, 0, 1], [74, 1, 1], [69, 2, 2]]] },
  ];
  let trackId = store.get('splendor_track', 'pavane'), musicVol = store.get('splendor_mvol', 0.5), sfxVol = store.get('splendor_svol', 1);
  const curTrack = () => TRACKS.find((t) => t.id === trackId) || TRACKS[0];
  let loopNo = 0, nextT = 0, bar = 0, timer = 0;
  function scheduleBar(t, b, lp) {
    const tr = curTrack(), BEAT = 60 / tr.bpm, ch = tr.chords[b], n = tr.arp.pat.length, step = (4 / n) * BEAT;
    pad(musicBus, t, [ch[0], ch[1]], BEAT * 4.2, tr.pad);
    for (let i = 0; i < n; i++) pluck(musicBus, t + i * step, ch[tr.arp.pat[i]], BEAT * tr.arp.dur, i % Math.max(1, n / 2) === 0 ? 0.2 : 0.12, 5);
    pluck(musicBus, t, ch[0] - 12, BEAT * 3, 0.16, 3);
    for (const [bt, v, f] of tr.drum) drum(musicBus, t + bt * BEAT, v, f);
    for (const [bt, v] of tr.shk) shaker(musicBus, t + bt * BEAT, v);
    for (const [m, s0, d] of tr.mel[b]) {
      const mode = tr.lead === 'alt' ? (lp % 2 === 0 ? 'flute' : 'lute') : tr.lead;
      if (mode === 'flute' || mode === 'both') flute(musicBus, t + s0 * BEAT, m, d * BEAT * 0.98, mode === 'both' ? 0.08 : 0.1);
      if (mode === 'lute' || mode === 'both') { pluck(musicBus, t + s0 * BEAT, m + 12, BEAT * Math.max(d, 1.2), 0.15, 6); pluck(musicBus, t + s0 * BEAT + 0.012, m, BEAT * d, 0.07, 4); }
    }
  }
  function musicTick() {
    if (!ctx || !musicOn) return;
    const BEAT = 60 / curTrack().bpm;
    while (nextT < ctx.currentTime + 1.2) {
      try { scheduleBar(nextT, bar, loopNo); } catch (e) { console.warn('music', e); }
      nextT += BEAT * 4; bar++; if (bar >= 8) { bar = 0; loopNo++; }
    }
  }
  function startMusic() {
    if (!ctx || timer) return;
    nextT = ctx.currentTime + 0.15; bar = 0; loopNo = 0;
    timer = setInterval(musicTick, 300); musicTick();
  }
  function stopMusicTimer() { clearInterval(timer); timer = 0; }

  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') ctx.resume();
    if (!started) { started = true; if (musicOn) startMusic(); }
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
  document.addEventListener('visibilitychange', () => { // tab ẩn: tắt nhạc nền nhưng vẫn phát chuông báo lượt
    if (!ctx) return;
    if (document.hidden) { stopMusicTimer(); musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.1); }
    else { ctx.resume(); if (musicOn) { musicBus.gain.setTargetAtTime(musicVol, ctx.currentTime, 0.3); startMusic(); } }
  });

  // --- hiệu ứng âm thanh ---
  const rnd = (a, b) => a + Math.random() * (b - a);
  function ring(t, f, vol, dur, partials) { // tiếng kim loại / chuông
    for (const [r, v] of partials || [[1, 1], [2.76, .5], [5.4, .22]]) {
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = f * r;
      g.gain.setValueAtTime(vol * v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (1 + r * 0.25));
      o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur);
    }
  }
  function swish(t, dur, f0, f1, vol) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + dur + 0.05);
  }
  function brass(t, midi, dur, vol) {
    const f = mtof(midi), g = ctx.createGain(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(f * 1.5, t); lp.frequency.linearRampToValueAtTime(f * 6, t + 0.12); lp.frequency.linearRampToValueAtTime(f * 3, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.05); g.gain.setValueAtTime(vol * .85, t + dur - 0.15); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    for (const d of [-6, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = d; o.connect(lp); o.start(t); o.stop(t + dur + .05); }
    lp.connect(g); g.connect(sfxBus);
  }
  const SFX = {
    tok() { const t = ctx.currentTime; ring(t, rnd(1900, 2300), .1, .16, [[1, 1], [2.4, .4]]); },
    clink() { const t = ctx.currentTime; ring(t, rnd(2200, 3100), .13, .35); ring(t + .03, rnd(1500, 2000), .06, .25); },
    click() { const t = ctx.currentTime; ring(t, 1200, .05, .08, [[1, 1], [2, .3]]); },
    open() { swish(ctx.currentTime, .16, 1500, 3200, .1); },
    flip() { swish(ctx.currentTime, .2, 900, 3600, .16); },
    buy() { const t = ctx.currentTime; swish(t, .22, 800, 3200, .15); [74, 78, 81, 86].forEach((m, i) => ring(t + .12 + i * .075, mtof(m), .08, .9, [[1, 1], [2, .35], [3, .15]])); },
    reserve() { const t = ctx.currentTime; swish(t, .25, 600, 1800, .13); pluck(sfxBus, t + .1, 50, .7, .22, 3); },
    deal() { swish(ctx.currentTime, .13, 1800, 4200, .06); },
    noble() { const t = ctx.currentTime; [[62, 0, .3], [66, .22, .3], [69, .44, .3], [74, .66, 1.1]].forEach(([m, s, d]) => brass(t + s, m, d, .11)); [86, 90, 93, 98].forEach((m, i) => ring(t + .7 + i * .1, mtof(m), .07, 1.4)); },
    turn() { const t = ctx.currentTime; ring(t, mtof(81), .1, 1.1, [[1, 1], [2, .3], [3, .1]]); ring(t + .17, mtof(86), .11, 1.4, [[1, 1], [2, .3], [3, .1]]); },
    error() { const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'triangle'; o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(80, t + .18);
      g.gain.setValueAtTime(.18, t); g.gain.exponentialRampToValueAtTime(.0001, t + .22); o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + .25); },
    firework() { const t = ctx.currentTime; swish(t, .3, 400, 2400, .08);
      const n = ctx.createBufferSource(); n.buffer = noiseBuf(); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t + .28); g.gain.linearRampToValueAtTime(.18, t + .3); g.gain.exponentialRampToValueAtTime(.0001, t + .9);
      n.connect(lp); lp.connect(g); g.connect(sfxBus); n.start(t); n.stop(t + 1);
      for (let i = 0; i < 5; i++) ring(t + .32 + i * .05 + Math.random() * .05, rnd(2400, 4200), .035, .3, [[1, 1]]); },
    coin() { const t = ctx.currentTime; ring(t, rnd(1800, 2600), .06, .5); },
    chat() { const t = ctx.currentTime; ring(t, 1568, .07, .25, [[1, 1], [2, .3]]); ring(t + .09, 2093, .06, .3, [[1, 1], [2, .3]]); },
    nudge() { const t = ctx.currentTime; for (let i = 0; i < 3; i++) ring(t + i * .22, mtof(88), .12, .8, [[1, 1], [2, .3], [3, .1]]); },
    tick() { const t = ctx.currentTime; ring(t, 880, .08, .12, [[1, 1]]); },
    points() { const t = ctx.currentTime; [88, 93].forEach((m, i) => ring(t + i * .08, mtof(m), .07, .6, [[1, 1], [2, .25]])); },
    win() { const t = ctx.currentTime; [[62, 0, .35], [69, .3, .35], [74, .6, .35], [78, .9, .35], [81, 1.2, 1.6], [86, 1.2, 1.6]].forEach(([m, s, d]) => brass(t + s, m, d, .1));
      [93, 97, 100, 105, 109].forEach((m, i) => ring(t + 1.3 + i * .12, mtof(m), .06, 1.6)); },
    lose() { const t = ctx.currentTime; [[62, 0, .5], [65, .45, .5], [57, .9, 1.2]].forEach(([m, s, d]) => brass(t + s, m, d, .07)); },
  };
  function sfx(name, delay) {
    if (!sfxOn || !ctx || ctx.state !== 'running' || !SFX[name]) return;
    if (delay) setTimeout(() => sfx(name), delay); else try { if (!sample(name)) SFX[name](); } catch (e) { console.warn('sfx', name, e); }
  }

  function setMusic(on) {
    musicOn = on; store.set('splendor_music', on); if (!init()) return;
    musicBus.gain.setTargetAtTime(on ? musicVol : 0, ctx.currentTime, 0.25);
    if (on) { if (ctx.state === 'suspended') ctx.resume(); started = true; if (!timer) startMusic(); } else stopMusicTimer();
  }
  function setSfx(on) { sfxOn = on; store.set('splendor_sfx', on); if (ctx) sfxBus.gain.value = on ? sfxVol : 0; }
  function setVolume(kind, v) {
    v = Math.max(0, Math.min(1, v));
    if (kind === 'music') { musicVol = v; store.set('splendor_mvol', v); if (ctx && musicOn) musicBus.gain.setTargetAtTime(v, ctx.currentTime, 0.05); }
    else { sfxVol = v; store.set('splendor_svol', v); if (ctx && sfxOn) sfxBus.gain.value = v; }
  }
  function setTrack(id) { // đổi bản nhạc (tự bật nhạc nếu đang tắt)
    if (!TRACKS.some((t) => t.id === id)) return;
    trackId = id; store.set('splendor_track', id);
    if (!init()) return;
    if (!musicOn) { setMusic(true); return; }
    stopMusicTimer(); started = true; startMusic();
  }

  // ================= HOẠT ẢNH =================
  const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null; };
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (s, root) => (root || document).querySelector(s);
  const $$ = (s, root) => [...(root || document).querySelectorAll(s)];

  function snapshot() {
    const s = { cards: {}, decks: {}, bank: {}, pl: {}, nobles: {} };
    $$('[data-cid]:not(.fly)').forEach((e) => { s.cards[e.dataset.cid] = rectOf(e); });
    $$('[data-deck]').forEach((e) => { s.decks[e.dataset.deck] = rectOf(e); });
    $$('[data-bank]').forEach((e) => { s.bank[e.dataset.bank] = rectOf(e); });
    $$('.pl[data-pid]').forEach((e) => { s.pl[e.dataset.pid] = { chips: rectOf($('.chips', e)), bon: rectOf($('.bon', e)), pt: rectOf($('.pt', e)) }; });
    $$('[data-nid]:not(.fly)').forEach((e) => { s.nobles[e.dataset.nid] = rectOf(e); });
    return s;
  }

  // bay 1 phần tử từ rect a tới rect b (WAAPI), tự dọn khi xong
  function fly(el, a, b, o = {}) {
    if (!a || !b || reduce) { return Promise.resolve(); }
    el.classList.add('fly');
    Object.assign(el.style, { position: 'fixed', left: a.x + 'px', top: a.y + 'px', width: a.w + 'px', height: a.h + 'px', margin: 0, zIndex: 200, pointerEvents: 'none' });
    document.body.appendChild(el);
    const dx = center(b).x - center(a).x, dy = center(b).y - center(a).y, sc = o.scale != null ? o.scale : Math.min(b.w / a.w, b.h / a.h);
    const lift = o.arc == null ? -40 : o.arc;
    const anim = el.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1, offset: 0 },
      { transform: `translate(${dx * 0.5}px,${dy * 0.5 + lift}px) scale(${(1 + sc) / 2 + 0.12}) rotate(${o.rot || 0}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${dx}px,${dy}px) scale(${sc}) rotate(0deg)`, opacity: o.fade === false ? 1 : 0.15, offset: 1 },
    ], { duration: o.dur || 650, delay: o.delay || 0, easing: 'cubic-bezier(.3,.1,.25,1)', fill: 'both' });
    return anim.finished.catch(() => {}).then(() => { el.remove(); if (o.done) o.done(); });
  }
  const mk = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; };

  function flyTokens(color, count, a, b, delay0) {
    if (!a || !b) return;
    for (let i = 0; i < Math.min(count, 6); i++) {
      const el = mk(tokHtml(color, '', '', ''));
      const d = (delay0 || 0) + i * 95;
      fly(el, a, b, { dur: 600, delay: d, arc: -30 - i * 6, rot: i % 2 ? 180 : -180, scale: Math.min(b.h, 34) / a.h });
      sfx('clink', d + 520);
    }
  }
  function sparkleAt(r, n, hue) {
    if (reduce || !r) return;
    for (let i = 0; i < (n || 8); i++) {
      const s = document.createElement('i'); s.className = 'spark';
      const ang = Math.random() * 6.28, dist = 18 + Math.random() * 38;
      Object.assign(s.style, { left: r.x + r.w / 2 + 'px', top: r.y + r.h / 2 + 'px', background: hue || '#ffe08a' });
      document.body.appendChild(s);
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px),calc(-50% + ${Math.sin(ang) * dist}px)) scale(0)`, opacity: 0 }],
        { duration: 600 + Math.random() * 300, easing: 'ease-out' }).finished.then(() => s.remove()).catch(() => s.remove());
    }
  }
  function floatText(r, text, cls) {
    if (reduce || !r) return;
    const e = document.createElement('div'); e.className = 'floattxt ' + (cls || ''); e.textContent = text;
    Object.assign(e.style, { left: r.x + r.w / 2 + 'px', top: r.y + 'px' }); document.body.appendChild(e);
    e.animate([{ transform: 'translate(-50%,0)', opacity: 0 }, { transform: 'translate(-50%,-14px)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-54px)', opacity: 0 }], { duration: 1500, easing: 'ease-out' }).finished.then(() => e.remove()).catch(() => e.remove());
  }
  function pop(el, big) {
    if (!el || reduce) return;
    el.animate([{ transform: 'scale(1)' }, { transform: `scale(${big || 1.35})` }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
  function dealIn(el, from, delay) {
    if (!el || !from || reduce) return;
    const r = rectOf(el); if (!r) return;
    const dx = center(from).x - center(r).x, dy = center(from).y - center(r).y;
    el.animate([{ transform: `translate(${dx}px,${dy}px) scale(.85) rotateY(90deg)`, opacity: 0.2 }, { transform: 'translate(0,0) scale(1) rotateY(0)', opacity: 1 }],
      { duration: 520, delay: delay || 0, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'backwards' });
    sfx('deal', (delay || 0) + 60);
  }

  // So sánh trạng thái cũ/mới và phát hoạt ảnh + âm thanh tương ứng (chạy SAU khi render xong)
  function diff(prev, nw, snap, meId) {
    if (!nw) return;
    // ván mới: chia bài
    if (!prev) {
      $$('.lvrow').forEach((row, ri) => {
        const lv = 3 - ri, deck = rectOf($(`[data-deck="${lv}"]`));
        $$('[data-cid]', row).forEach((el, i) => dealIn(el, deck, 120 + (ri * 5 + i) * 70));
      });
      $$('[data-nid]').forEach((el, i) => { if (!reduce) el.animate([{ transform: 'translateY(-30px) scale(.5)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 500, delay: i * 120, easing: 'cubic-bezier(.3,1.5,.5,1)', fill: 'backwards' }); });
      return;
    }
    const pdom = {}; $$('.pl[data-pid]').forEach((e) => { pdom[e.dataset.pid] = { chips: rectOf($('.chips', e)), bon: rectOf($('.bon', e)), pt: $('.pt', e), box: rectOf(e) }; });
    let t0 = 0, played = false;
    const oldP = Object.fromEntries(prev.players.map((p) => [p.id, p]));
    // thẻ rời bàn / vào tay
    for (const p of nw.players) {
      const o = oldP[p.id]; if (!o) continue;
      const target = pdom[p.id] && (pdom[p.id].bon || pdom[p.id].box);
      for (const id of p.cards) if (!o.cards.includes(id)) { // mua thẻ
        const a = snap.cards[id]; if (a && target) { fly(mk(cardHtml(id, '', '')), a, target, { dur: 720, scale: .25, arc: -60, rot: -8 }); sfx('buy'); played = true; t0 = 380; }
        sparkleAt(target, 10);
      }
      let resFlown = false;
      for (const r of p.reserved) if (!resFlown && !o.reserved.some((x) => (x.id != null && x.id === r.id))) { // giữ thẻ
        if (r.hidden && o.reserved.length >= p.reserved.length) continue;
        const tgt = pdom[p.id] && pdom[p.id].box; if (!tgt) continue;
        const a = r.id != null && snap.cards[r.id] ? snap.cards[r.id] : snap.decks[r.level || (CARDS[r.id] && CARDS[r.id].level)];
        if (a && o.reserved.length < p.reserved.length) { fly(mk(r.id != null && !r.fromDeck ? cardHtml(r.id) : backHtml(r.level || CARDS[r.id].level, null)), a, tgt, { dur: 620, scale: .35, arc: -50 }); sfx('reserve'); played = true; resFlown = true; }
      }
      if (p.points > o.points) { pop(pdom[p.id] && pdom[p.id].pt, 1.5); floatText(pdom[p.id] && pdom[p.id].box, '+' + (p.points - o.points), 'pts'); sfx('points', 500); }
      // quý tộc
      for (const nid of p.nobles) if (!o.nobles.includes(nid)) {
        const a = snap.nobles[nid]; if (a && target) { fly(mk(nobleHtml(nid, false)), a, target, { dur: 900, scale: .3, arc: -80 }); }
        sparkleAt(target, 16, '#fff0a8'); sfx('noble', 300); floatText(target, tr('flash.noble'), 'noble'); played = true;
      }
    }
    // thẻ mới được chia vào ô trống
    for (const l of [1, 2, 3]) nw.board[l].forEach((id, i) => {
      if (id == null || id === prev.board[l][i]) return;
      const el = $(`[data-cid="${id}"]:not(.fly)`); dealIn(el, snap.decks[l] || (el && rectOf(el)), t0 + 120);
    });
    // đá quý
    for (const c of ['white', 'blue', 'green', 'red', 'black', 'gold']) {
      for (const p of nw.players) {
        const o = oldP[p.id]; if (!o) continue;
        const d = p.tokens[c] - o.tokens[c]; if (!d) continue;
        const dest = pdom[p.id] && pdom[p.id].chips;
        if (d > 0) { flyTokens(c, d, snap.bank[c], dest, 0); played = true; }
        else { const src = snap.pl[p.id] && snap.pl[p.id].chips, bk = rectOf($(`[data-bank="${c}"]`)); flyTokens(c, -d, src, bk, 80); played = true; }
      }
      const el = $(`[data-bank="${c}"]`); if (el && prev.bank[c] !== nw.bank[c]) pop($('.n', el), 1.4);
    }
    // đổi lượt
    const wasMine = prev.players[prev.turn].id === meId && prev.phase !== 'over', isMine = nw.players[nw.turn].id === meId && nw.phase !== 'over';
    if (isMine && (!wasMine || prev.phase !== nw.phase || prev.turn !== nw.turn)) { sfx('turn', played ? 900 : 100); flash(tr(nw.phase === 'main' ? 'flash.turn' : 'flash.action')); }
    if (nw.phase === 'over' && prev.phase !== 'over') {
      const won = nw.winners.includes(meId);
      celebrate(won);
    }
  }

  function flash(text) {
    if (reduce) return;
    const e = document.createElement('div'); e.className = 'turnflash'; e.textContent = text; document.body.appendChild(e);
    e.animate([{ transform: 'translate(-50%,-50%) scale(.6)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .2 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: .75 }, { transform: 'translate(-50%,-60%) scale(1.1)', opacity: 0 }], { duration: 1700, easing: 'ease-out' }).finished.then(() => e.remove()).catch(() => e.remove());
  }

  // ================= HẠT BỤI VÀNG NỀN + PHÁO GIẤY =================
  const cv = document.createElement('canvas'); cv.id = 'fxbg'; document.body.prepend(cv);
  const g2 = cv.getContext('2d'); let W = 0, H = 0, dust = [], confettiList = [], raf = 0;
  function resize() { W = cv.width = innerWidth; H = cv.height = innerHeight; }
  addEventListener('resize', resize); resize();
  for (let i = 0; i < 42; i++) dust.push({ x: Math.random() * 2000, y: Math.random() * 1200, r: 0.6 + Math.random() * 1.8, s: 0.08 + Math.random() * 0.25, p: Math.random() * 6.28, a: 0.15 + Math.random() * 0.45 });
  const cvT = document.createElement('canvas'); cvT.id = 'fxtop'; document.body.appendChild(cvT);
  const gt = cvT.getContext('2d'); let bursts = [], coins = [], fwTimer = 0;
  function resizeT() { cvT.width = innerWidth; cvT.height = innerHeight; }
  addEventListener('resize', resizeT); resizeT();
  const GEMC = ['#f4f1ea', '#4f8be9', '#3dbd71', '#e24a44', '#8a8a9c', '#f6cf3d'];
  function confetti() {
    if (reduce) return;
    for (let i = 0; i < 140; i++) confettiList.push({ x: W / 2 + (Math.random() - .5) * W * .5, y: H * 0.3, vx: (Math.random() - .5) * 9, vy: -4 - Math.random() * 9, r: 3 + Math.random() * 5, c: GEMC[i % GEMC.length], rot: Math.random() * 6, vr: (Math.random() - .5) * .3, life: 1 });
    kick();
  }
  const FWC = ['#ffd75e', '#ff6b6b', '#6bd0ff', '#9dff8a', '#ffffff', '#d58aff'];
  function burst(x, y) {
    const c = FWC[Math.floor(Math.random() * FWC.length)], c2 = FWC[Math.floor(Math.random() * FWC.length)], n = 46, p = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * 6.283 + Math.random() * .2, v = 2 + Math.random() * 2.8; p.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 2 + Math.random() * 1.6, c: i % 3 ? c : c2, a: 1.2 }); }
    bursts.push({ p }); kick();
  }
  function fireworks(ms) {
    if (reduce) return;
    clearInterval(fwTimer); const end = Date.now() + (ms || 6000);
    const go = () => { burst(W * (0.15 + Math.random() * 0.7), H * (0.12 + Math.random() * 0.4)); sfx('firework'); };
    go(); fwTimer = setInterval(() => { if (Date.now() > end) return clearInterval(fwTimer); go(); }, 520);
  }
  function coinRain(n) {
    if (reduce) return;
    for (let i = 0; i < (n || 38); i++) coins.push({ x: Math.random() * W, y: -20 - Math.random() * H * .6, vy: 1.2 + Math.random() * 1.6, r: 6 + Math.random() * 5, rot: Math.random() * 6, vr: .06 + Math.random() * .08, ph: Math.random() * 6 });
    kick();
  }
  // màn hình kết quả: thắng = pháo hoa + giấy hoa; thua = xu vàng rơi nhẹ
  function celebrate(won) {
    if (won) { confetti(); setTimeout(confetti, 900); fireworks(7000); sfx('win', 300); }
    else { coinRain(34); sfx('lose', 300); for (let i = 0; i < 6; i++) sfx('coin', 700 + i * 380); }
  }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  function loop(t) {
    raf = 0; if (document.hidden) { raf = requestAnimationFrame(loop); return; }
    g2.clearRect(0, 0, W, H); gt.clearRect(0, 0, W, H);
    for (const d of dust) {
      d.y -= d.s; d.x += Math.sin(t / 2500 + d.p) * 0.2; if (d.y < -5) { d.y = H + 5; d.x = Math.random() * W; }
      const tw = 0.5 + 0.5 * Math.sin(t / 700 + d.p);
      g2.beginPath(); g2.fillStyle = `rgba(255,214,120,${d.a * tw})`; g2.shadowColor = '#e8b923'; g2.shadowBlur = 6; g2.arc(d.x % W, d.y, d.r, 0, 6.28); g2.fill();
    }
    g2.shadowBlur = 0;
    for (const c of confettiList) {
      c.vy += 0.18; c.x += c.vx; c.y += c.vy; c.vx *= 0.99; c.rot += c.vr; if (c.y > H + 20) c.life = 0;
      gt.save(); gt.translate(c.x, c.y); gt.rotate(c.rot); gt.fillStyle = c.c; gt.beginPath(); gt.moveTo(0, -c.r); gt.lineTo(c.r * .8, 0); gt.lineTo(0, c.r); gt.lineTo(-c.r * .8, 0); gt.closePath(); gt.fill(); gt.restore();
    }
    confettiList = confettiList.filter((c) => c.life > 0);
    // lớp trên: pháo hoa + xu rơi (nằm trên cả màn hình kết quả)
    gt.globalCompositeOperation = 'lighter';
    for (const b of bursts) {
      for (const q of b.p) {
        q.vy += 0.045; q.vx *= 0.985; q.vy *= 0.985; q.x += q.vx; q.y += q.vy; q.a -= 0.012;
        if (q.a > 0) { gt.beginPath(); gt.fillStyle = q.c; gt.globalAlpha = Math.min(1, q.a); gt.arc(q.x, q.y, q.r * Math.min(1, q.a + .3), 0, 6.28); gt.fill(); }
      }
    }
    gt.globalAlpha = 1; gt.globalCompositeOperation = 'source-over';
    bursts = bursts.filter((b) => b.p.some((q) => q.a > 0));
    for (const c of coins) {
      c.y += c.vy; c.x += Math.sin(c.y / 40 + c.ph) * 0.6; c.rot += c.vr;
      gt.save(); gt.translate(c.x, c.y); gt.scale(Math.cos(c.rot), 1); gt.beginPath(); gt.arc(0, 0, c.r, 0, 6.28); gt.fillStyle = '#e8b923'; gt.fill(); gt.lineWidth = 1.5; gt.strokeStyle = '#7a5600'; gt.stroke();
      gt.beginPath(); gt.arc(0, 0, c.r * .6, 0, 6.28); gt.strokeStyle = '#fff1b8'; gt.lineWidth = 1; gt.stroke(); gt.restore();
    }
    coins = coins.filter((c) => c.y < H + 20);
    if (!reduce) raf = requestAnimationFrame(loop);
  }
  if (!reduce) kick();

  // nghiêng thẻ 3D theo chuột
  document.addEventListener('mousemove', (e) => {
    if (reduce) return;
    const c = e.target.closest && e.target.closest('.card:not(.empty):not(.fly), .noble');
    if ($('.card.tilt')) { const t = $('.card.tilt'); if (t !== c) { t.classList.remove('tilt'); t.style.removeProperty('--rx'); t.style.removeProperty('--ry'); t.style.removeProperty('--mx'); t.style.removeProperty('--my'); } }
    if (!c || c.closest('.md')) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    c.classList.add('tilt'); c.style.setProperty('--rx', ((0.5 - py) * 14).toFixed(1) + 'deg'); c.style.setProperty('--ry', ((px - 0.5) * 16).toFixed(1) + 'deg');
    c.style.setProperty('--mx', (px * 100).toFixed(0) + '%'); c.style.setProperty('--my', (py * 100).toFixed(0) + '%');
  }, { passive: true });

  return { celebrate, fireworks, tracks: () => TRACKS.map((t) => ({ id: t.id, name: t.name, desc: t.desc })), setLang, setTrack, setVolume, floatText, ctxState: () => ctx && ctx.state, SFX_NAMES: () => Object.keys(SFX), sfx, snapshot, diff, flash, setMusic, setSfx, unlock, state: () => ({ music: musicOn, sfx: sfxOn, track: trackId, mvol: musicVol, svol: sfxVol }), confetti };
})();
