import { reviewVerifiedSearch } from './check-verified-search.mjs';

let input = '';
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
const result = reviewVerifiedSearch(JSON.parse(input));
if (result) process.stdout.write(JSON.stringify(result));
