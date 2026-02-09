import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';

export type AdversarialReplayTeam = {
  id: string;
  name: string;
  color: string;
};

export type AdversarialReplayUnit = {
  id: string;
  team: string;
  role: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
};

export type AdversarialReplayEvent = {
  t: number;
  type: 'kill' | 'focus_fire' | 'objective' | 'swing';
  actor: string;
  target?: string;
  text: string;
};

export type AdversarialReplayData = {
  kind: 'rl_adversarial_replay_v1';
  title: string;
  map: string;
  durationSec: number;
  fps: number;
  seed: number;
  arena: { width: number; height: number };
  teams: AdversarialReplayTeam[];
  units: AdversarialReplayUnit[];
  events: AdversarialReplayEvent[];
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatClock = (seconds: number) => {
  const value = Math.max(0, seconds);
  const mins = Math.floor(value / 60);
  const secs = Math.floor(value % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const bounce = (value: number, min: number, max: number) => {
  const span = max - min;
  if (span <= 0) return min;
  const mod = ((value - min) % (span * 2) + span * 2) % (span * 2);
  return mod <= span ? min + mod : max - (mod - span);
};

const phaseFor = (id: string, seed: number) => {
  let hash = seed;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return (hash % 360) * (Math.PI / 180);
};

const BASE_WIDTH = 960;
const BASE_HEIGHT = 540;

export const isAdversarialReplayData = (value: unknown): value is AdversarialReplayData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'rl_adversarial_replay_v1'
    && typeof candidate.title === 'string'
    && typeof candidate.map === 'string'
    && typeof candidate.durationSec === 'number'
    && Array.isArray(candidate.units)
    && Array.isArray(candidate.events);
};

type Props = {
  replay: AdversarialReplayData;
};

export const AdversarialReplayPlayer: React.FC<Props> = ({ replay }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  useEffect(() => {
    setCurrentTime(0);
    setIsPlaying(false);
  }, [replay.title, replay.seed, replay.durationSec]);

  useEffect(() => {
    if (!isPlaying) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = ((now - last) / 1000) * speed;
      last = now;
      setCurrentTime(prev => {
        const next = prev + delta;
        if (next >= replay.durationSec) {
          setIsPlaying(false);
          return replay.durationSec;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, speed, replay.durationSec]);

  const teamByUnit = useMemo(() => {
    const map = new Map<string, string>();
    replay.units.forEach(unit => map.set(unit.id, unit.team));
    return map;
  }, [replay.units]);

  const deadAt = useMemo(() => {
    const map = new Map<string, number>();
    replay.events
      .filter(event => event.type === 'kill' && event.target)
      .forEach(event => {
        const target = event.target as string;
        if (!map.has(target) || (map.get(target) as number) > event.t) {
          map.set(target, event.t);
        }
      });
    return map;
  }, [replay.events]);

  const scores = useMemo(() => {
    const values: Record<string, number> = {};
    replay.teams.forEach(team => {
      values[team.id] = 0;
    });
    replay.events.forEach(event => {
      if (event.t > currentTime) return;
      const actorTeam = teamByUnit.get(event.actor);
      if (!actorTeam) return;
      if (event.type === 'kill') values[actorTeam] += 1;
      if (event.type === 'objective') values[actorTeam] += 2;
      if (event.type === 'swing') values[actorTeam] += 1;
    });
    return values;
  }, [currentTime, replay.events, replay.teams, teamByUnit]);

  const recentEvents = useMemo(
    () => replay.events.filter(event => event.t <= currentTime).slice(-4).reverse(),
    [currentTime, replay.events],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const sx = BASE_WIDTH / replay.arena.width;
    const sy = BASE_HEIGHT / replay.arena.height;
    const scale = Math.min(sx, sy);
    const padX = (BASE_WIDTH - replay.arena.width * scale) / 2;
    const padY = (BASE_HEIGHT - replay.arena.height * scale) / 2;

    const toX = (x: number) => padX + x * scale;
    const toY = (y: number) => padY + y * scale;

    ctx.clearRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    const bg = ctx.createLinearGradient(0, 0, 0, BASE_HEIGHT);
    bg.addColorStop(0, '#0b1220');
    bg.addColorStop(1, '#0f172a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, BASE_WIDTH, BASE_HEIGHT);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= replay.arena.width; x += 8) {
      ctx.beginPath();
      ctx.moveTo(toX(x), toY(0));
      ctx.lineTo(toX(x), toY(replay.arena.height));
      ctx.stroke();
    }
    for (let y = 0; y <= replay.arena.height; y += 8) {
      ctx.beginPath();
      ctx.moveTo(toX(0), toY(y));
      ctx.lineTo(toX(replay.arena.width), toY(y));
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(toX(0), toY(0), replay.arena.width * scale, replay.arena.height * scale);

    const now = currentTime;
    replay.units.forEach(unit => {
      const deathTime = deadAt.get(unit.id);
      const alive = deathTime === undefined || deathTime > now;
      const phase = phaseFor(unit.id, replay.seed);

      const px = bounce(unit.x + unit.vx * now + Math.sin(now * 1.25 + phase) * 2.1, 4, replay.arena.width - 4);
      const py = bounce(unit.y + unit.vy * now + Math.cos(now * 1.05 + phase) * 1.8, 4, replay.arena.height - 4);

      const radius = clamp(4.8 + (unit.role.includes('tank') ? 1.5 : 0), 4.8, 7.2) * scale * 0.35;
      const x = toX(px);
      const y = toY(py);
      const teamColor = replay.teams.find(team => team.id === unit.team)?.color || '#60a5fa';
      const hpDrop = replay.events.reduce((sum, event) => {
        if (event.t > now) return sum;
        if (event.target === unit.id && event.type !== 'objective') return sum + 26;
        return sum;
      }, 0);
      const hp = clamp(unit.hp - hpDrop, 0, unit.hp);

      ctx.globalAlpha = alive ? 1 : 0.25;
      ctx.beginPath();
      ctx.fillStyle = teamColor;
      ctx.shadowColor = teamColor;
      ctx.shadowBlur = 14;
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(unit.id.toUpperCase(), x, y - radius - 8);

      const hpWidth = radius * 2.2;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(x - hpWidth / 2, y + radius + 6, hpWidth, 4);
      ctx.fillStyle = hp > 55 ? '#22c55e' : hp > 28 ? '#f59e0b' : '#ef4444';
      ctx.fillRect(x - hpWidth / 2, y + radius + 6, hpWidth * (hp / unit.hp), 4);
      ctx.globalAlpha = 1;
    });

    const progress = replay.durationSec > 0 ? currentTime / replay.durationSec : 0;
    ctx.fillStyle = 'rgba(15,23,42,0.75)';
    ctx.fillRect(20, BASE_HEIGHT - 26, BASE_WIDTH - 40, 8);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(20, BASE_HEIGHT - 26, (BASE_WIDTH - 40) * clamp(progress, 0, 1), 8);
  }, [currentTime, deadAt, replay]);

  const handleExportWebm = () => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      window.alert('MediaRecorder is not available in this browser.');
      return;
    }
    if (isExporting) return;

    const prevTime = currentTime;
    const prevSpeed = speed;
    const prevPlaying = isPlaying;
    const stream = canvas.captureStream(replay.fps || 24);
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks: BlobPart[] = [];

    recorder.ondataavailable = event => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${replay.title.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'adversarial_replay'}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIsExporting(false);
      setIsPlaying(prevPlaying);
      setSpeed(prevSpeed);
      setCurrentTime(prevTime);
      stream.getTracks().forEach(track => track.stop());
    };

    setIsExporting(true);
    setCurrentTime(0);
    setSpeed(1);
    setIsPlaying(true);
    recorder.start(200);

    window.setTimeout(() => {
      setIsPlaying(false);
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, replay.durationSec * 1000 + 350);
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-3">
      <div className="rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
        <canvas
          ref={canvasRef}
          width={BASE_WIDTH}
          height={BASE_HEIGHT}
          className="w-full h-auto"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setIsPlaying(prev => !prev)}
          className="inline-flex items-center px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          {isPlaying ? <Pause className="w-4 h-4 mr-1.5" /> : <Play className="w-4 h-4 mr-1.5" />}
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button
          onClick={handleExportWebm}
          disabled={isExporting}
          className="inline-flex items-center px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          <Download className="w-4 h-4 mr-1.5" />
          {isExporting ? 'Exporting...' : 'Export WebM'}
        </button>
        <div className="text-sm font-mono text-gray-700 min-w-[84px]">
          {formatClock(currentTime)} / {formatClock(replay.durationSec)}
        </div>
        <input
          type="range"
          min={0}
          max={replay.durationSec}
          step={0.05}
          value={currentTime}
          onChange={(event) => setCurrentTime(Number(event.target.value))}
          className="flex-1 min-w-[200px]"
        />
        <select
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          className="px-2 py-1 rounded-md border border-gray-300 text-sm"
        >
          <option value={0.5}>0.5x</option>
          <option value={1}>1.0x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2.0x</option>
        </select>
      </div>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{replay.title} · {replay.map}</span>
        <div className="flex items-center gap-3 font-mono">
          {replay.teams.map(team => (
            <span key={team.id} style={{ color: team.color }}>
              {team.name}:{' '}
              <span className="text-gray-700">{scores[team.id] ?? 0}</span>
            </span>
          ))}
        </div>
      </div>

      {recentEvents.length > 0 && (
        <div className="grid grid-cols-1 gap-1">
          {recentEvents.map((event, idx) => (
            <div key={`${event.t}_${event.actor}_${idx}`} className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">
              <span className="font-mono text-gray-500 mr-2">{formatClock(event.t)}</span>
              {event.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
