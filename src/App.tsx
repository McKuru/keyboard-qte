import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Settings,
  Trophy,
  Timer,
  CheckCircle2,
  XCircle,
  Zap,
  ArrowLeft,
  Sparkles,
  Flame,
  AlertTriangle,
  Hourglass
} from 'lucide-react';

// --- Sound Synthesizer (Web Audio API) ---
class SoundController {
  private ctx: AudioContext | null = null;
  public muted: boolean = false;

  private getContext(): AudioContext | null {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  playKey(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(650, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.035);
  }

  playStumble(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Jarring stumble pitch drop
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(85, now + 0.14);

    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  playSuccess(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const startTime = now + idx * 0.055;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.15, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + 0.12);
    });
  }

  playFail(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.2);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }
}

const sounds = new SoundController();

// --- Types ---
type ScreenView = 'settings' | 'game';
type RoundState = 'active' | 'success' | 'failed';

interface Stats {
  totalAttempts: number;
  successes: number;
  failures: number;
  totalStumbles: number;
  completionTimes: number[]; // in seconds
  bestTime: number | null;
  currentStreak: number;
  bestStreak: number;
}

const STORAGE_KEY_STATS = 'catppuccin_qte_stats_v3';
const STORAGE_KEY_SETTINGS = 'catppuccin_qte_settings_v3';

const PRESET_POOLS = [
  { label: 'WASD', pool: 'WASD' },
  { label: 'QWER', pool: 'QWER' },
  { label: 'Home Row', pool: 'ASDFJKL' },
  { label: 'Numbers', pool: '123456' },
  { label: 'Full Alpha', pool: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
];

const STUMBLE_DELAY_PRESETS = [
  { label: '0.2s Quick', value: 0.2 },
  { label: '0.4s Normal', value: 0.4 },
  { label: '0.6s Heavy', value: 0.6 },
  { label: '0.8s Harsh', value: 0.8 },
];

export default function App() {
  // Screen Router: 'settings' or 'game'
  const [currentScreen, setCurrentScreen] = useState<ScreenView>('settings');

  // Settings State
  const [allowedKeysInput, setAllowedKeysInput] = useState<string>('QWERASDF');
  const [timeLimit, setTimeLimit] = useState<number>(3.0); // seconds
  const [sequenceLength, setSequenceLength] = useState<number>(5);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [autoNext, setAutoNext] = useState<boolean>(false);

  // Stumble Mode Settings
  const [continueOnMiss, setContinueOnMiss] = useState<boolean>(true); // continue keypresses
  const [stumbleDelay, setStumbleDelay] = useState<number>(0.4); // seconds delay penalty

  // Gameplay State
  const [roundState, setRoundState] = useState<RoundState>('active');
  const [sequence, setSequence] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [remainingTime, setRemainingTime] = useState<number>(3.0);
  const [failReason, setFailReason] = useState<string>('');
  const [lastCompletionTime, setLastCompletionTime] = useState<number | null>(null);

  // Stumble Status in Active Round
  const [isStumbling, setIsStumbling] = useState<boolean>(false);
  const [stumbleCountInRound, setStumbleCountInRound] = useState<number>(0);
  const [lastStumbleInfo, setLastStumbleInfo] = useState<string>('');

  // Statistics State
  const [stats, setStats] = useState<Stats>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATS);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch {
      // ignore
    }
    return {
      totalAttempts: 0,
      successes: 0,
      failures: 0,
      totalStumbles: 0,
      completionTimes: [],
      bestTime: null,
      currentStreak: 0,
      bestStreak: 0,
    };
  });

  // Animation and Timer Refs
  const startTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const roundStateRef = useRef<RoundState>('active');
  roundStateRef.current = roundState;
  const isStumblingRef = useRef<boolean>(false);
  isStumblingRef.current = isStumbling;

  const autoNextTimerRef = useRef<NodeJS.Timeout | null>(null);
  const stumbleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Sync sound settings
  useEffect(() => {
    sounds.muted = !soundEnabled;
  }, [soundEnabled]);

  // Persist statistics
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
    } catch {
      // ignore
    }
  }, [stats]);

  // Save settings
  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SETTINGS,
        JSON.stringify({
          allowedKeysInput,
          timeLimit,
          sequenceLength,
          soundEnabled,
          autoNext,
          continueOnMiss,
          stumbleDelay,
        })
      );
    } catch {
      // ignore
    }
  }, [allowedKeysInput, timeLimit, sequenceLength, soundEnabled, autoNext, continueOnMiss, stumbleDelay]);

  // Load saved settings on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.allowedKeysInput) setAllowedKeysInput(parsed.allowedKeysInput);
        if (typeof parsed.timeLimit === 'number') setTimeLimit(parsed.timeLimit);
        if (typeof parsed.sequenceLength === 'number') setSequenceLength(parsed.sequenceLength);
        if (typeof parsed.soundEnabled === 'boolean') setSoundEnabled(parsed.soundEnabled);
        if (typeof parsed.autoNext === 'boolean') setAutoNext(parsed.autoNext);
        if (typeof parsed.continueOnMiss === 'boolean') setContinueOnMiss(parsed.continueOnMiss);
        if (typeof parsed.stumbleDelay === 'number') setStumbleDelay(parsed.stumbleDelay);
      }
    } catch {
      // ignore
    }
  }, []);

  // Normalize allowed key pool
  const getCleanPool = useCallback((input: string): string[] => {
    const raw = input.toUpperCase().replace(/\s+/g, '');
    const set = new Set<string>();
    for (const char of raw) {
      if (char) set.add(char);
    }
    const pool = Array.from(set);
    return pool.length > 0 ? pool : ['Q', 'W', 'E', 'R'];
  }, []);

  // Generate sequence helper
  const generateNewSequence = useCallback(
    (count: number, poolStr: string): string[] => {
      const pool = getCleanPool(poolStr);
      const result: string[] = [];
      for (let i = 0; i < count; i++) {
        const randomIndex = Math.floor(Math.random() * pool.length);
        result.push(pool[randomIndex]);
      }
      return result;
    },
    [getCleanPool]
  );

  // Stop current frame loop
  const stopTimer = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  // Clear stumble timer
  const clearStumble = useCallback(() => {
    if (stumbleTimeoutRef.current) {
      clearTimeout(stumbleTimeoutRef.current);
      stumbleTimeoutRef.current = null;
    }
    setIsStumbling(false);
  }, []);

  // Trigger Failure
  const triggerFailure = useCallback(
    (reason: string) => {
      stopTimer();
      clearStumble();
      sounds.playFail();
      setRoundState('failed');
      setFailReason(reason);

      setStats((prev) => ({
        ...prev,
        totalAttempts: prev.totalAttempts + 1,
        failures: prev.failures + 1,
        currentStreak: 0,
      }));

      if (autoNext) {
        if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = setTimeout(() => {
          startNewRound();
        }, 900);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoNext, clearStumble, stopTimer]
  );

  // Trigger Success
  const triggerSuccess = useCallback(
    (completionTime: number) => {
      stopTimer();
      clearStumble();
      sounds.playSuccess();
      setRoundState('success');
      setLastCompletionTime(completionTime);

      setStats((prev) => {
        const totalAttempts = prev.totalAttempts + 1;
        const successes = prev.successes + 1;
        const completionTimes = [...prev.completionTimes, completionTime];
        const bestTime =
          prev.bestTime === null ? completionTime : Math.min(prev.bestTime, completionTime);
        const currentStreak = prev.currentStreak + 1;
        const bestStreak = Math.max(prev.bestStreak, currentStreak);

        return {
          totalAttempts,
          successes,
          failures: prev.failures,
          totalStumbles: prev.totalStumbles,
          completionTimes,
          bestTime,
          currentStreak,
          bestStreak,
        };
      });

      if (autoNext) {
        if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = setTimeout(() => {
          startNewRound();
        }, 900);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [autoNext, clearStumble, stopTimer]
  );

  // Trigger Stumble
  const triggerStumble = useCallback(
    (pressed: string, expected: string) => {
      sounds.playStumble();
      setIsStumbling(true);
      setStumbleCountInRound((prev) => prev + 1);
      setLastStumbleInfo(`Pressed [${pressed}], needed [${expected}]`);

      setStats((prev) => ({
        ...prev,
        totalStumbles: prev.totalStumbles + 1,
      }));

      if (stumbleTimeoutRef.current) {
        clearTimeout(stumbleTimeoutRef.current);
      }

      // Input locked for the configured stumble delay, then allowed to continue
      stumbleTimeoutRef.current = setTimeout(() => {
        setIsStumbling(false);
      }, stumbleDelay * 1000);
    },
    [stumbleDelay]
  );

  // Start new round in game screen
  const startNewRound = useCallback(() => {
    stopTimer();
    clearStumble();
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }

    const newSeq = generateNewSequence(sequenceLength, allowedKeysInput);
    setSequence(newSeq);
    setCurrentIndex(0);
    setFailReason('');
    setLastCompletionTime(null);
    setStumbleCountInRound(0);
    setLastStumbleInfo('');
    setRemainingTime(timeLimit);
    setRoundState('active');

    const start = performance.now();
    startTimeRef.current = start;
    const durationMs = timeLimit * 1000;

    const frame = (now: number) => {
      const elapsed = now - start;
      const left = Math.max(0, (durationMs - elapsed) / 1000);
      setRemainingTime(left);

      if (left <= 0) {
        triggerFailure("Time's up! Sequence was not completed in time.");
      } else if (roundStateRef.current === 'active') {
        animationFrameRef.current = requestAnimationFrame(frame);
      }
    };

    animationFrameRef.current = requestAnimationFrame(frame);
  }, [allowedKeysInput, clearStumble, generateNewSequence, sequenceLength, stopTimer, timeLimit, triggerFailure]);

  // Navigate to Game and launch
  const handleStartPractice = () => {
    setCurrentScreen('game');
    setTimeout(() => {
      startNewRound();
    }, 50);
  };

  // Back to Settings
  const handleBackToSettings = () => {
    stopTimer();
    clearStumble();
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setCurrentScreen('settings');
  };

  // Global Keydown Handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If typing in input box on settings screen, do not intercept
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        if (e.key === 'Enter' && currentScreen === 'settings') {
          handleStartPractice();
        }
        return;
      }

      // Settings screen: Enter or Space to start
      if (currentScreen === 'settings') {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          handleStartPractice();
        }
        return;
      }

      // Game screen: Escape returns to settings
      if (currentScreen === 'game') {
        if (e.code === 'Escape') {
          e.preventDefault();
          handleBackToSettings();
          return;
        }

        // Space to restart / next round when round ended
        if (e.code === 'Space' && roundState !== 'active') {
          e.preventDefault();
          startNewRound();
          return;
        }

        // Active gameplay key validation
        if (roundState === 'active') {
          if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
            e.preventDefault();
          }

          // If currently in a stumble delay, inputs are temporarily locked/frozen
          if (isStumblingRef.current) {
            return;
          }

          const pressed = e.key.toUpperCase();
          const expected = sequence[currentIndex];

          if (!expected) return;

          if (pressed === expected) {
            sounds.playKey();
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);

            if (nextIndex >= sequence.length) {
              const finishTime = (performance.now() - startTimeRef.current) / 1000;
              triggerSuccess(finishTime);
            }
          } else {
            // Wrong key pressed!
            if (continueOnMiss) {
              // Stumble mechanic: pause inputs for the selective delay, but continue the sequence!
              triggerStumble(pressed, expected);
            } else {
              // Instant failure mode
              triggerFailure(`Wrong key! Pressed [${pressed}], expected [${expected}].`);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    currentIndex,
    currentScreen,
    roundState,
    sequence,
    startNewRound,
    triggerFailure,
    triggerSuccess,
    triggerStumble,
    continueOnMiss,
  ]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      clearStumble();
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
      }
    };
  }, [clearStumble, stopTimer]);

  // Calculations for Statistics
  const avgCompletionTime =
    stats.completionTimes.length > 0
      ? (
          stats.completionTimes.reduce((acc, t) => acc + t, 0) / stats.completionTimes.length
        ).toFixed(2)
      : '—';

  const progressPercent = Math.max(0, Math.min(100, (remainingTime / timeLimit) * 100));

  const getProgressColor = () => {
    const ratio = remainingTime / timeLimit;
    if (ratio > 0.45) return 'bg-[#89b4fa]'; // Catppuccin Blue
    if (ratio > 0.2) return 'bg-[#f9e2af]'; // Catppuccin Yellow
    return 'bg-[#f38ba8]'; // Catppuccin Red
  };

  const handleResetStats = () => {
    const emptyStats: Stats = {
      totalAttempts: 0,
      successes: 0,
      failures: 0,
      totalStumbles: 0,
      completionTimes: [],
      bestTime: null,
      currentStreak: 0,
      bestStreak: 0,
    };
    setStats(emptyStats);
    localStorage.removeItem(STORAGE_KEY_STATS);
  };

  return (
    <div
      id="app-root"
      className="min-h-screen bg-[#1e1e2e] text-[#cdd6f4] selection:bg-[#cba6f7] selection:text-[#11111b] flex flex-col justify-between p-4 sm:p-6 lg:p-8 font-sans"
    >
      {/* ========================================================================= */}
      {/* SCREEN 1: SETTINGS SCREEN                                                */}
      {/* ========================================================================= */}
      {currentScreen === 'settings' && (
        <div id="screen-settings" className="w-full max-w-lg mx-auto my-auto flex flex-col gap-6">
          {/* Header */}
          <div className="text-center">
            <div className="inline-flex p-3 rounded-2xl bg-[#313244] border border-[#45475a] text-[#cba6f7] mb-3 shadow-sm">
              <Zap className="w-6 h-6" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#cdd6f4] font-mono">
              QTE PRACTICE
            </h1>
            <p className="text-xs text-[#a6adc8] mt-1">
              Catppuccin Quick Time Event Trainer
            </p>
          </div>

          {/* Minimal Settings Form Card */}
          <div className="bg-[#181825] border border-[#313244] rounded-2xl p-6 sm:p-8 shadow-xl flex flex-col gap-5">
            <div className="flex items-center justify-between border-b border-[#313244] pb-3">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-[#cba6f7]" />
                <h2 className="text-xs font-semibold tracking-wider font-mono uppercase text-[#cdd6f4]">
                  Practice Setup
                </h2>
              </div>
              <button
                id="btn-toggle-sound"
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="text-xs text-[#a6adc8] hover:text-[#cdd6f4] flex items-center gap-1 transition-colors cursor-pointer"
                title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
              >
                {soundEnabled ? (
                  <Volume2 className="w-3.5 h-3.5 text-[#a6e3a1]" />
                ) : (
                  <VolumeX className="w-3.5 h-3.5 text-[#6c7086]" />
                )}
                <span>{soundEnabled ? 'Sound On' : 'Muted'}</span>
              </button>
            </div>

            {/* Input 1: Pool of allowed keys */}
            <div>
              <label
                htmlFor="input-allowed-keys"
                className="block text-xs font-semibold text-[#a6adc8] mb-1.5"
              >
                Allowed Keys Pool
              </label>
              <input
                id="input-allowed-keys"
                type="text"
                value={allowedKeysInput}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().replace(/\s+/g, '');
                  setAllowedKeysInput(val || 'QWER');
                }}
                placeholder="e.g. QWERASDF"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11111b] border border-[#313244] text-[#cdd6f4] font-mono text-sm tracking-wider focus:outline-none focus:border-[#cba6f7] transition-colors"
              />

              {/* Quick preset chips */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[11px] text-[#6c7086]">Presets:</span>
                {PRESET_POOLS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setAllowedKeysInput(preset.pool)}
                    className={`text-[11px] px-2 py-0.5 rounded-md font-mono border transition-colors cursor-pointer ${
                      allowedKeysInput === preset.pool
                        ? 'bg-[#cba6f7]/20 text-[#cba6f7] border-[#cba6f7]/50'
                        : 'bg-[#313244] text-[#a6adc8] border-transparent hover:border-[#45475a]'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Input 2: Total time limit */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="input-time-limit"
                  className="text-xs font-semibold text-[#a6adc8]"
                >
                  Total Time Limit (Seconds)
                </label>
                <span className="text-xs font-mono font-bold text-[#89b4fa]">
                  {timeLimit.toFixed(1)}s
                </span>
              </div>
              <input
                id="input-time-limit"
                type="number"
                step="0.1"
                min="0.5"
                max="30"
                value={timeLimit}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && val > 0) {
                    setTimeLimit(Math.min(30, Math.max(0.5, val)));
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11111b] border border-[#313244] text-[#cdd6f4] font-mono text-sm focus:outline-none focus:border-[#cba6f7] transition-colors"
              />
            </div>

            {/* Input 3: Total amount of keys */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="input-sequence-length"
                  className="text-xs font-semibold text-[#a6adc8]"
                >
                  Amount of Keys in Sequence
                </label>
                <span className="text-xs font-mono font-bold text-[#a6e3a1]">
                  {sequenceLength} Keys
                </span>
              </div>
              <input
                id="input-sequence-length"
                type="number"
                min="1"
                max="20"
                step="1"
                value={sequenceLength}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val > 0) {
                    setSequenceLength(Math.min(20, Math.max(1, val)));
                  }
                }}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#11111b] border border-[#313244] text-[#cdd6f4] font-mono text-sm focus:outline-none focus:border-[#cba6f7] transition-colors"
              />
            </div>

            {/* NEW: Continue Key-Presses & Stumble Delay Setting */}
            <div className="pt-2 border-t border-[#313244] flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-[#cdd6f4] block">
                    Continue on Miss (Stumble)
                  </span>
                  <span className="text-[11px] text-[#a6adc8]">
                    {continueOnMiss
                      ? 'Wrong keys stumble & pause input'
                      : 'Wrong keys cause instant failure'}
                  </span>
                </div>
                <button
                  id="btn-toggle-continue-miss"
                  type="button"
                  onClick={() => setContinueOnMiss(!continueOnMiss)}
                  className={`text-xs px-3 py-1 rounded-lg border font-mono transition-colors cursor-pointer ${
                    continueOnMiss
                      ? 'bg-[#fab387]/20 text-[#fab387] border-[#fab387]/50'
                      : 'bg-[#11111b] text-[#6c7086] border-[#313244]'
                  }`}
                >
                  {continueOnMiss ? 'CONTINUE' : 'INSTANT FAIL'}
                </button>
              </div>

              {/* Selective Delay Slider & Presets (when Continue on Miss is active) */}
              {continueOnMiss && (
                <div className="p-3 rounded-xl bg-[#11111b] border border-[#313244] flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[#fab387] flex items-center gap-1.5">
                      <Hourglass className="w-3.5 h-3.5" />
                      Stumble Delay (Selective Delay)
                    </span>
                    <span className="text-xs font-mono font-bold text-[#fab387]">
                      {stumbleDelay.toFixed(2)}s
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      id="input-stumble-delay"
                      type="range"
                      min="0.1"
                      max="1.5"
                      step="0.05"
                      value={stumbleDelay}
                      onChange={(e) => setStumbleDelay(parseFloat(e.target.value))}
                      className="flex-1 accent-[#fab387] h-1.5 bg-[#313244] rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    {STUMBLE_DELAY_PRESETS.map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setStumbleDelay(preset.value)}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono border transition-colors cursor-pointer ${
                          Math.abs(stumbleDelay - preset.value) < 0.01
                            ? 'bg-[#fab387]/25 text-[#fab387] border-[#fab387]'
                            : 'bg-[#181825] text-[#a6adc8] border-[#313244] hover:border-[#45475a]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Auto Next sequence toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-[#313244]">
              <span className="text-xs text-[#a6adc8]">Auto-start next sequence:</span>
              <button
                type="button"
                onClick={() => setAutoNext(!autoNext)}
                className={`text-xs px-2.5 py-1 rounded-lg border font-mono transition-colors cursor-pointer ${
                  autoNext
                    ? 'bg-[#cba6f7]/20 text-[#cba6f7] border-[#cba6f7]/40'
                    : 'bg-[#11111b] text-[#6c7086] border-[#313244]'
                }`}
              >
                {autoNext ? 'ON' : 'OFF'}
              </button>
            </div>

            {/* The Main Start Button */}
            <button
              id="btn-start-game"
              type="button"
              onClick={handleStartPractice}
              className="w-full mt-2 py-3.5 rounded-xl bg-[#cba6f7] text-[#11111b] font-bold font-mono text-base flex items-center justify-center gap-2 shadow-lg hover:bg-[#b4befe] active:scale-[0.99] transition-all cursor-pointer border border-[#b4befe]"
            >
              <Play className="w-4 h-4 fill-current" />
              Start Practice
            </button>
          </div>

          {/* Statistics Section (Clean Minimalist Summary) */}
          <section
            id="statistics-section"
            className="bg-[#181825] border border-[#313244] rounded-2xl p-5 shadow-md"
          >
            <div className="flex items-center justify-between border-b border-[#313244] pb-2.5 mb-3">
              <div className="flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5 text-[#fab387]" />
                <h3 className="text-xs font-semibold tracking-wider font-mono uppercase text-[#cdd6f4]">
                  Practice Statistics
                </h3>
              </div>
              {stats.totalAttempts > 0 && (
                <button
                  id="btn-reset-stats"
                  type="button"
                  onClick={handleResetStats}
                  className="text-[11px] text-[#f38ba8] hover:underline font-mono cursor-pointer"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Required Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
              <div className="p-2.5 rounded-xl bg-[#11111b] border border-[#313244]">
                <span className="text-[11px] text-[#a6adc8] block">Total Attempts</span>
                <span className="text-lg font-bold font-mono text-[#cdd6f4]">
                  {stats.totalAttempts}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#11111b] border border-[#313244]">
                <span className="text-[11px] text-[#a6e3a1] block">Successes</span>
                <span className="text-lg font-bold font-mono text-[#a6e3a1]">
                  {stats.successes}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#11111b] border border-[#313244]">
                <span className="text-[11px] text-[#f38ba8] block">Failures</span>
                <span className="text-lg font-bold font-mono text-[#f38ba8]">
                  {stats.failures}
                </span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#11111b] border border-[#313244]">
                <span className="text-[11px] text-[#89b4fa] block">Avg Time</span>
                <span className="text-lg font-bold font-mono text-[#89b4fa]">
                  {avgCompletionTime !== '—' ? `${avgCompletionTime}s` : '—'}
                </span>
              </div>
            </div>

            {/* Extra context: Stumble stats */}
            {stats.totalStumbles > 0 && (
              <div className="mt-2.5 pt-2 border-t border-[#313244] flex items-center justify-between text-xs text-[#a6adc8]">
                <span className="flex items-center gap-1 text-[#fab387]">
                  <AlertTriangle className="w-3 h-3" />
                  Total Stumbles Recovered:
                </span>
                <span className="font-mono font-bold text-[#fab387]">
                  {stats.totalStumbles}
                </span>
              </div>
            )}
          </section>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SCREEN 2: GAMEPLAY SCREEN (SEPARATE DEDICATED SCREEN)                    */}
      {/* ========================================================================= */}
      {currentScreen === 'game' && (
        <div id="screen-game" className="w-full max-w-3xl mx-auto my-auto flex flex-col gap-6">
          {/* Game Top Navigation */}
          <div className="w-full flex items-center justify-between border-b border-[#313244] pb-4">
            <button
              id="btn-back-settings"
              type="button"
              onClick={handleBackToSettings}
              className="px-3 py-1.5 rounded-xl bg-[#181825] border border-[#313244] text-xs font-mono text-[#a6adc8] hover:text-[#cdd6f4] hover:bg-[#313244] transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Settings (Esc)</span>
            </button>

            {/* Quick Mini Stats Bar */}
            <div className="flex items-center gap-3 font-mono text-xs">
              <span className="text-[#a6e3a1]">✓ {stats.successes}</span>
              <span className="text-[#f38ba8]">✕ {stats.failures}</span>
              {stumbleCountInRound > 0 && (
                <span className="text-[#fab387] flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" />
                  {stumbleCountInRound} stumble{stumbleCountInRound > 1 ? 's' : ''}
                </span>
              )}
              {stats.currentStreak > 1 && (
                <span className="flex items-center gap-0.5 text-[#fab387]">
                  <Flame className="w-3 h-3 fill-current" />
                  {stats.currentStreak}
                </span>
              )}
            </div>

            {/* Sound Toggle */}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-1.5 rounded-lg bg-[#181825] border border-[#313244] text-[#a6adc8] hover:text-[#cdd6f4] transition-colors cursor-pointer"
              title={soundEnabled ? 'Mute' : 'Unmute'}
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-[#a6e3a1]" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-[#6c7086]" />
              )}
            </button>
          </div>

          {/* Focused QTE Arena Card */}
          <div
            id="gameplay-card"
            className={`w-full rounded-2xl bg-[#181825] border-2 p-6 sm:p-10 flex flex-col items-center justify-center transition-all duration-150 shadow-2xl ${
              roundState === 'active'
                ? isStumbling
                  ? 'border-[#fab387] ring-4 ring-[#fab387]/20 animate-wobble'
                  : 'border-[#cba6f7] ring-4 ring-[#cba6f7]/10'
                : roundState === 'success'
                ? 'border-[#a6e3a1] ring-4 ring-[#a6e3a1]/15'
                : roundState === 'failed'
                ? 'border-[#f38ba8] ring-4 ring-[#f38ba8]/15 animate-shake'
                : 'border-[#313244]'
            }`}
          >
            {/* Status & Timer Header */}
            <div className="w-full flex items-center justify-between mb-8">
              <span
                id="round-status-pill"
                className={`text-xs font-mono font-bold px-3 py-1 rounded-full uppercase tracking-wider ${
                  roundState === 'active'
                    ? isStumbling
                      ? 'bg-[#fab387]/20 text-[#fab387] border border-[#fab387]/40 animate-pulse'
                      : 'bg-[#cba6f7]/20 text-[#cba6f7] border border-[#cba6f7]/40'
                    : roundState === 'success'
                    ? 'bg-[#a6e3a1]/20 text-[#a6e3a1] border border-[#a6e3a1]/40'
                    : 'bg-[#f38ba8]/20 text-[#f38ba8] border border-[#f38ba8]/40'
                }`}
              >
                {roundState === 'active' && !isStumbling && 'Press Keys Now'}
                {roundState === 'active' && isStumbling && `Stumbled! Delayed ${stumbleDelay.toFixed(1)}s`}
                {roundState === 'success' && 'Sequence Cleared!'}
                {roundState === 'failed' && 'Attempt Failed'}
              </span>

              {/* Time display */}
              <div className="font-mono text-sm sm:text-base flex items-center gap-1.5 text-[#bac2de]">
                <Timer className="w-4 h-4 text-[#89b4fa]" />
                <span className="font-bold text-[#cdd6f4]">{remainingTime.toFixed(2)}s</span>
                <span className="text-xs text-[#6c7086]">/ {timeLimit.toFixed(1)}s</span>
              </div>
            </div>

            {/* Smooth Dynamic Timer Bar */}
            <div className="w-full h-2.5 bg-[#313244] rounded-full overflow-hidden mb-8 shadow-inner">
              <div
                id="qte-countdown-bar"
                className={`h-full transition-all duration-75 ease-linear rounded-full ${getProgressColor()}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Stumble Indicator Banner (During Active Gameplay) */}
            {roundState === 'active' && isStumbling && (
              <div
                id="feedback-stumble"
                className="mb-4 px-4 py-2 rounded-xl bg-[#fab387]/15 border border-[#fab387]/40 text-[#fab387] flex items-center gap-2 text-xs font-mono animate-pulse"
              >
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Stumbling! {lastStumbleInfo} — Inputs paused for {stumbleDelay.toFixed(1)}s!
                </span>
              </div>
            )}

            {/* Immediate Visual Feedback Banner */}
            {roundState === 'success' && (
              <div
                id="feedback-success"
                className="mb-6 px-4 py-2.5 rounded-xl bg-[#a6e3a1]/15 border border-[#a6e3a1]/40 text-[#a6e3a1] flex items-center gap-2 text-sm font-medium animate-pulse-subtle"
              >
                <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
                <span>
                  Success! Cleared in{' '}
                  <strong className="font-mono underline">
                    {lastCompletionTime ? `${lastCompletionTime.toFixed(2)}s` : ''}
                  </strong>
                  {stumbleCountInRound > 0 && (
                    <span className="text-xs text-[#fab387] ml-2">
                      ({stumbleCountInRound} stumble{stumbleCountInRound > 1 ? 's' : ''})
                    </span>
                  )}
                </span>
              </div>
            )}

            {roundState === 'failed' && (
              <div
                id="feedback-failure"
                className="mb-6 px-4 py-2.5 rounded-xl bg-[#f38ba8]/15 border border-[#f38ba8]/40 text-[#f38ba8] flex items-center gap-2 text-sm font-medium"
              >
                <XCircle className="w-5 h-5 flex-shrink-0" />
                <span>{failReason || 'Failed!'}</span>
              </div>
            )}

            {/* The Keycaps Sequence */}
            <div
              id="game-keycaps-container"
              className="w-full flex flex-wrap items-center justify-center gap-3 sm:gap-4 my-4 min-h-[110px]"
            >
              {sequence.map((keyChar, index) => {
                const isCompleted = index < currentIndex;
                const isCurrent = roundState === 'active' && index === currentIndex;
                const isFailedAtThis = roundState === 'failed' && index === currentIndex;

                let keycapStyle =
                  'bg-[#313244] text-[#cdd6f4] border-[#45475a] shadow-[0_4px_0_0_#181825]';

                if (isCompleted) {
                  keycapStyle =
                    'bg-[#a6e3a1]/25 text-[#a6e3a1] border-[#a6e3a1] shadow-[0_4px_0_0_#45475a] scale-95';
                } else if (isCurrent && isStumbling) {
                  // Stumbling on active key
                  keycapStyle =
                    'bg-[#fab387] text-[#11111b] font-black border-[#eba0ac] shadow-[0_4px_0_0_#45475a] scale-105 animate-wobble ring-4 ring-[#fab387]/30';
                } else if (isCurrent) {
                  keycapStyle =
                    'bg-[#cba6f7] text-[#11111b] font-black border-[#b4befe] shadow-[0_6px_0_0_#89b4fa] scale-110 ring-4 ring-[#cba6f7]/30';
                } else if (isFailedAtThis) {
                  keycapStyle =
                    'bg-[#f38ba8] text-[#11111b] border-[#eba0ac] shadow-[0_4px_0_0_#45475a]';
                }

                return (
                  <div key={index} className="flex flex-col items-center">
                    <div
                      id={`game-keycap-${index}`}
                      className={`w-14 h-16 sm:w-16 sm:h-20 rounded-xl border-2 flex flex-col items-center justify-center font-mono text-xl sm:text-2xl font-bold transition-all duration-100 select-none ${keycapStyle}`}
                    >
                      <span>{keyChar}</span>
                      <span className="text-[10px] font-sans font-normal opacity-75 mt-0.5">
                        #{index + 1}
                      </span>
                    </div>

                    {/* Indicator under the active keycap */}
                    <div className="h-4 mt-1 flex items-center justify-center">
                      {isCurrent && isStumbling && (
                        <span className="text-xs font-mono font-bold text-[#fab387] animate-pulse">
                          STUMBLE
                        </span>
                      )}
                      {isCurrent && !isStumbling && (
                        <span className="text-xs font-mono font-bold text-[#cba6f7] animate-bounce">
                          ▲
                        </span>
                      )}
                      {isCompleted && (
                        <span className="text-xs text-[#a6e3a1] font-bold">✓</span>
                      )}
                      {isFailedAtThis && (
                        <span className="text-xs text-[#f38ba8] font-bold">✕</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Actions in Game */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                id="btn-retry-round"
                type="button"
                onClick={startNewRound}
                className="px-6 py-2.5 rounded-xl bg-[#cba6f7] text-[#11111b] font-bold font-mono text-sm flex items-center gap-2 shadow-md hover:bg-[#b4befe] active:scale-95 transition-all cursor-pointer border border-[#b4befe]"
              >
                {roundState === 'active' ? (
                  <>
                    <RotateCcw className="w-4 h-4" /> Restart Sequence
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" /> Next Sequence (Space)
                  </>
                )}
              </button>

              <button
                id="btn-game-to-settings"
                type="button"
                onClick={handleBackToSettings}
                className="px-4 py-2.5 rounded-xl bg-[#313244] text-[#cdd6f4] font-mono text-sm hover:bg-[#45475a] transition-colors border border-[#45475a] cursor-pointer"
              >
                Change Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="w-full max-w-lg mx-auto text-center text-xs text-[#6c7086] mt-6">
        <span>Catppuccin Mocha • Minimalist QTE Practice</span>
      </footer>
    </div>
  );
}
