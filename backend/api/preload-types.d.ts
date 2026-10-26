import type { FrontierBridge } from './contract';

declare global {
  interface Window {
    frontier: FrontierBridge;
  }
}

export {};
