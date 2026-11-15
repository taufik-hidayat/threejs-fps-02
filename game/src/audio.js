// Every sound in FOUNDRY is synthesized with WebAudio: no audio files, no network.
// One AudioContext, one shared noise buffer, short envelopes per event. All methods are
// safe to call before the context is unlocked (they no-op until a user gesture resumes it).
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = 0.42;
    master.connect(context.destination);
    noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return context;
  }

  function noise(duration, filterType, frequency, gainValue, when = 0) {
    if (!ensure() || context.state === 'suspended') return;
    const start = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(start, Math.random() * 0.2);
    source.stop(start + duration + 0.02);
  }

  function tone(frequency, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure() || context.state === 'suspended') return;
    const start = context.currentTime + when;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  // weapon: 'rifle' | 'smg' | 'sniper' | 'pistol'. A crack plus a low thump.
  function shot(weapon, distant = false) {
    const crack = distant ? 0.1 : 0.5;
    const thump = distant ? 0.08 : 0.4;
    if (weapon === 'sniper') {
      noise(0.22, 'highpass', 900, crack);
      tone(140, 0.24, 'sine', thump, 48);
    } else if (weapon === 'smg') {
      noise(0.07, 'bandpass', 2400, crack * 0.8);
      tone(190, 0.09, 'sine', thump * 0.7, 70);
    } else if (weapon === 'pistol') {
      noise(0.09, 'bandpass', 1800, crack * 0.85);
      tone(170, 0.1, 'sine', thump * 0.75, 65);
    } else {
      noise(0.12, 'bandpass', 1500, crack);
      tone(150, 0.14, 'sine', thump, 55);
    }
  }

  return {
    unlock() {
      if (ensure() && context.state === 'suspended') context.resume();
    },
    shot,
    dryFire() {
      tone(900, 0.04, 'square', 0.12);
    },
    hit(killed) {
      tone(killed ? 1560 : 1180, 0.06, 'sine', 0.28);
      if (killed) tone(2080, 0.09, 'sine', 0.22, 0, 0.05);
    },
    hurt() {
      tone(110, 0.16, 'sawtooth', 0.2, 60);
    },
    reload() {
      noise(0.05, 'bandpass', 3000, 0.2);
      noise(0.05, 'bandpass', 2200, 0.22, 0.22);
      tone(520, 0.05, 'square', 0.1, 0, 0.42);
    },
    step(run) {
      noise(run ? 0.07 : 0.05, 'lowpass', run ? 500 : 380, run ? 0.16 : 0.1);
    },
    plantBeep(final) {
      tone(final ? 1320 : 880, 0.09, 'square', 0.2);
    },
    defuseBeep() {
      tone(660, 0.07, 'square', 0.18);
    },
    bombTick() {
      tone(1760, 0.05, 'square', 0.16);
    },
    explosion() {
      noise(1.4, 'lowpass', 320, 0.9);
      tone(70, 1.1, 'sine', 0.7, 28);
      noise(0.5, 'highpass', 1200, 0.25);
    },
    smoke() {
      noise(0.9, 'bandpass', 700, 0.2);
    },
    roundWin() {
      tone(523, 0.14, 'triangle', 0.25);
      tone(659, 0.14, 'triangle', 0.25, 0, 0.13);
      tone(784, 0.26, 'triangle', 0.3, 0, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 'triangle', 0.25);
      tone(330, 0.16, 'triangle', 0.25, 0, 0.15);
      tone(262, 0.32, 'triangle', 0.28, 0, 0.3);
    },
    buy() {
      tone(880, 0.06, 'sine', 0.2);
      tone(1174, 0.1, 'sine', 0.2, 0, 0.06);
    },
    denied() {
      tone(220, 0.12, 'square', 0.16, 160);
    },
  };
}
