import { afterHierarchyRead } from './hierarchy-review.mjs';

let input = '';
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
const event = JSON.parse(input);
const output = afterHierarchyRead(event);
if (output) process.stdout.write(JSON.stringify(output));
