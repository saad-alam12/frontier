/**
 * Errors from the backend are written for developers ("goalCompiler: submit payload still invalid
 * after 4 attempts: ..."). The screens say what happened in plain words; the original stays in the
 * notice's hover text for a bug report.
 */
const PLAIN: [RegExp, string][] = [
  [/submit payload still invalid|ended without calling the submit tool|returned no (card|grade)/i, 'The model gave an answer Frontier could not use.'],
  [/overloaded|rate.?limit|too many requests|\b(429|529)\b|usage limit/i, 'The model is busy or your plan limit is reached for now.'],
  [/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|network|socket hang up/i, 'Frontier could not reach the model. Check the internet connection.'],
  [/not logged in|log ?in|authenticat|unauthori[sz]ed|\b401\b|invalid api key|x-api-key/i, 'The model login did not work. Use Test connection in Settings.'],
  [/timed? ?out/i, 'The model took too long to answer.'],
];

/** One plain sentence for an error message from the backend. */
export function plainError(message: string): string {
  // a validation error arrives as the JSON list of its issues; the first one's message is for people
  const issue = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(message);
  if (message.trimStart().startsWith('[') && issue?.[1]) return plainError(issue[1]);
  for (const [pattern, plain] of PLAIN) if (pattern.test(message)) return plain;
  // drop a role prefix ("tutor: ...") and make it a sentence
  const said = message.replace(/^[a-zA-Z]+: /, '').trim().replace(/\.?$/, '.');
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
}

/**
 * What to do about a failed connection test, in plain words, for the two providers; null when the error
 * says nothing the learner can act on. The Claude login expires from time to time: it is renewed in
 * Claude Code, not here.
 */
export function connectionAdvice(provider: 'agentSdk' | 'anthropicApi', error: string): string | null {
  if (provider === 'agentSdk' && /oauth|session expired|not logged in|please run \/login|failed to authenticate|\b401\b/i.test(error)) {
    return 'Your Claude login has expired. In Terminal run claude, type /login, sign in, then press Test connection again.';
  }
  if (provider === 'anthropicApi' && /\b401\b|authentication_error|invalid (x-api-key|bearer|api key)/i.test(error)) {
    return 'The API key was refused. Check it, or remove it and enter it again.';
  }
  return null;
}
