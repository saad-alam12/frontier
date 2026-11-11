import { AgentSdkProvider } from './AgentSdkProvider';
import { AnthropicApiProvider } from './AnthropicApiProvider';
import { ThrottledProvider } from './queue';
import type { LlmProvider, Role } from './provider';
import type { Settings } from '../settings/schema';
import { modelChoice } from '../settings/schema';

/** The provider the settings choose, without the queue. */
export function createInnerProvider(settings: Settings, cwd: string): LlmProvider {
  const pick = (role: Role) => modelChoice(settings, role);
  return settings.provider === 'anthropicApi' ? new AnthropicApiProvider({ apiKey: settings.apiKey, modelForRole: pick }) : new AgentSdkProvider({ modelForRole: pick, cwd });
}

export function createProvider(settings: Settings, cwd: string, onError?: (role: Role, error: unknown) => void): ThrottledProvider {
  return new ThrottledProvider(createInnerProvider(settings, cwd), settings.concurrency, onError);
}

export type { LlmProvider, Role, CompleteRequest, CompleteResult, HelperTool, LlmMessage } from './provider';
