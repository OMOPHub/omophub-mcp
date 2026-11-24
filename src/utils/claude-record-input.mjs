import { terminologyScopeFeedback } from './terminology-scope.mjs';

let input = '';
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
const { prompt } = JSON.parse(input);
if (typeof prompt === 'string' && /\bOMOPHub\b/i.test(prompt)) {
  const request = prompt.trim().replace(/^\/omophub:omophub\s+/i, '');
  const stopReason = terminologyScopeFeedback(request);
  // Claude appends the submitted prompt to a block decision. Stopping shows only the reason.
  if (stopReason) process.stdout.write(JSON.stringify({ continue: false, stopReason }));
}
