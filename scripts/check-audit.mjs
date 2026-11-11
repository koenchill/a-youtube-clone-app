import { readFileSync } from 'node:fs';
const report=JSON.parse(readFileSync('npm-audit.json','utf8'));
if (report.error || !report.metadata?.vulnerabilities) throw new Error('Audit did not produce a valid vulnerability report');
console.log('Audit counts:', JSON.stringify(report.metadata.vulnerabilities));
