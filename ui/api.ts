import type { ApiEvents, ApiInput, ApiName, ApiOutput, EventName } from '../backend/api/contract';

/** Typed client for the backend. The preload script exposes window.frontier. */
export function call<N extends ApiName>(name: N, ...args: ApiInput<N> extends undefined ? [] : [ApiInput<N>]): Promise<ApiOutput<N>> {
  return window.frontier.invoke(name, (args[0] ?? undefined) as ApiInput<N>);
}

export function onEvent<E extends EventName>(event: E, handler: (payload: ApiEvents[E]) => void): () => void {
  return window.frontier.on(event, handler);
}

/** True when a call failed because the learner stopped it (Esc). */
export function isCancelled(error: unknown): boolean {
  return error instanceof Error && error.message.endsWith('cancelled');
}
