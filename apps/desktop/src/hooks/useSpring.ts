import { useEffect, useRef, useState } from "react";

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

const DEFAULT_CONFIG: SpringConfig = { stiffness: 320, damping: 30, mass: 1 };

/**
 * 可中断的数值弹簧。
 *
 * 用 rAF 自己积分，而不是 CSS transition：中途改目标值时，
 * 它会带着当前速度继续跑（速度连续），CSS 做不到这一点。
 */
export function useSpring(target: number, overrides: Partial<SpringConfig> = {}): number {
  const { stiffness, damping, mass } = { ...DEFAULT_CONFIG, ...overrides };
  const [value, setValue] = useState(target);
  const state = useRef({ pos: target, vel: 0 });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      state.current = { pos: target, vel: 0 };
      setValue(target);
      return;
    }

    let last = performance.now();

    const step = (now: number) => {
      // 掉帧时限制步长，避免积分爆炸
      const dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;

      const { pos, vel } = state.current;
      const force = -stiffness * (pos - target) - damping * vel;
      const nextVel = vel + (force / mass) * dt;
      const nextPos = pos + nextVel * dt;

      if (Math.abs(nextPos - target) < 0.001 && Math.abs(nextVel) < 0.001) {
        state.current = { pos: target, vel: 0 };
        setValue(target);
        frame.current = null;
        return;
      }

      state.current = { pos: nextPos, vel: nextVel };
      setValue(nextPos);
      frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, stiffness, damping, mass]);

  return value;
}
