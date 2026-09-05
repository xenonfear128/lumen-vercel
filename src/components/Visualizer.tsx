import { useEffect, useRef } from "react";
import type { AudioEngine } from "../lib/audioEngine";
import type { VizMode } from "../lib/types";
import { cn } from "../utils/cn";

interface Props {
  engine: AudioEngine;
  mode: VizMode;
  playing: boolean;
  className?: string;
  dark: boolean;
}

export function Visualizer({ engine, mode, playing, className, dark }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const smooth = useRef<Float32Array>(new Float32Array(64));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || mode === "off") return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const color = dark ? "242,242,240" : "17,17,16";
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let time: Uint8Array<ArrayBuffer> | null = null;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      raf.current = requestAnimationFrame(draw);
      const an = engine.analyserNode;
      const { width: w, height: h } = canvas.getBoundingClientRect();
      // Hidden tabs have no drawable area; resume automatically on the next visible frame.
      if (w <= 0 || h <= 0) return;
      ctx2d.clearRect(0, 0, w, h);

      if (an) {
        if (!freq || freq.length !== an.frequencyBinCount) {
          freq = new Uint8Array(an.frequencyBinCount);
          time = new Uint8Array(an.fftSize);
        }
        an.getByteFrequencyData(freq);
        an.getByteTimeDomainData(time!);
      }

      const BARS = 64;
      const s = smooth.current;
      // Log-spaced band aggregation so bass doesn't dominate
      if (freq && an) {
        const nyq = (engine.context?.sampleRate ?? 44100) / 2;
        const fMin = 30;
        const fMax = Math.min(16000, nyq);
        for (let i = 0; i < BARS; i++) {
          const f0 = fMin * Math.pow(fMax / fMin, i / BARS);
          const f1 = fMin * Math.pow(fMax / fMin, (i + 1) / BARS);
          let b0 = Math.floor((f0 / nyq) * freq.length);
          let b1 = Math.max(b0 + 1, Math.floor((f1 / nyq) * freq.length));
          b0 = Math.min(b0, freq.length - 1);
          b1 = Math.min(b1, freq.length);
          let sum = 0;
          for (let b = b0; b < b1; b++) sum += freq[b];
          const v = sum / (b1 - b0) / 255;
          // tilt: gentle high-frequency lift
          const tilt = 1 + (i / BARS) * 0.6;
          const target = playing ? Math.min(1, v * tilt) : 0;
          s[i] += (target - s[i]) * (target > s[i] ? 0.5 : 0.12);
        }
      } else {
        for (let i = 0; i < BARS; i++) s[i] += (0 - s[i]) * 0.1;
      }

      if (mode === "bars") {
        const gap = Math.min(3, w / (BARS * 2));
        const bw = (w - gap * (BARS - 1)) / BARS;
        for (let i = 0; i < BARS; i++) {
          const v = s[i];
          const bh = Math.max(2, v * h * 0.92);
          const x = i * (bw + gap);
          const y = h - bh;
          ctx2d.fillStyle = `rgba(${color},${0.25 + v * 0.65})`;
          roundRect(ctx2d, x, y, bw, bh, Math.min(bw / 2, 3));
          ctx2d.fill();
        }
      } else if (mode === "wave") {
        ctx2d.lineWidth = 1.5;
        ctx2d.strokeStyle = `rgba(${color},0.85)`;
        ctx2d.beginPath();
        const n = time ? time.length : 512;
        for (let i = 0; i < n; i++) {
          const v = time && playing ? (time[i] - 128) / 128 : 0;
          const x = (i / (n - 1)) * w;
          const y = h / 2 + v * (h / 2) * 0.9;
          if (i === 0) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        // baseline
        ctx2d.strokeStyle = `rgba(${color},0.12)`;
        ctx2d.beginPath();
        ctx2d.moveTo(0, h / 2);
        ctx2d.lineTo(w, h / 2);
        ctx2d.stroke();
      } else if (mode === "ring") {
        const cx = w / 2;
        const cy = h / 2;
        const rBase = Math.min(w, h) * 0.3;
        const maxLen = Math.min(w, h) * 0.18;
        ctx2d.lineCap = "round";
        for (let i = 0; i < BARS; i++) {
          const v = s[i];
          const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
          const len = 2 + v * maxLen;
          const x0 = cx + Math.cos(a) * rBase;
          const y0 = cy + Math.sin(a) * rBase;
          const x1 = cx + Math.cos(a) * (rBase + len);
          const y1 = cy + Math.sin(a) * (rBase + len);
          ctx2d.lineWidth = 2;
          ctx2d.strokeStyle = `rgba(${color},${0.25 + v * 0.7})`;
          ctx2d.beginPath();
          ctx2d.moveTo(x0, y0);
          ctx2d.lineTo(x1, y1);
          ctx2d.stroke();
        }
        ctx2d.strokeStyle = `rgba(${color},0.15)`;
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.arc(cx, cy, Math.max(0, rBase - 6), 0, Math.PI * 2);
        ctx2d.stroke();
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, [engine, mode, playing, dark]);

  if (mode === "off") return null;
  return <canvas ref={ref} className={cn("block h-full w-full", className)} />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
