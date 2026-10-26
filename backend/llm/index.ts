import { AgentSdkProvider } from './AgentSdkProvider';
import { AnthropicApiProvider } from './AnthropicApiProvider';
import { ThrottledProvider } from './queue';
import type { LlmProvider, Role } from './provider';
import type { Settings } from '../settings/schema';
import { modelForRole } from '../settings/schema';

export function createProvider(settings: Settings, cwd: string): LlmProvider {
  const pick = (role: Role) => modelForRole(settings, role);
  const inner: LlmProvider =
    settings.provider === 'anthropicApi'
      ? new AnthropicApiProvider({ apiKey: settings.apiKey, modelForRole: pick })
      : new AgentSdkProvider({ modelForRole: pick, cwd });
  return new ThrottledProvider(inner, settings.concurrency);
}

export type { LlmProvider, Role, CompleteRequest, CompleteResult, HelperTool, LlmMessage } from './provider';
