import { reviewMapping } from './mapping-review.mjs';

let input = '';
for await (const chunk of process.stdin.setEncoding('utf8')) input += chunk;
const output = reviewMapping(JSON.parse(input));
if (output) process.stdout.write(JSON.stringify(output));
