import { subscribe } from 'node:diagnostics_channel';

// Opt-in protocol diagnostics: report error classification without headers or payloads.
subscribe('undici:request:error', (message: unknown) => {
  if (typeof message !== 'object' || message === null || !('error' in message)) return;
  const error = message.error;
  if (!(error instanceof Error)) return;
  console.error('protocol transport error', JSON.stringify({
    name: error.name,
    code: 'code' in error && typeof error.code === 'string' ? error.code : undefined,
    message: error.message,
  }));
});
