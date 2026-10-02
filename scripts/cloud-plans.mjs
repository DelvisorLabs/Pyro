import { readFile } from 'node:fs/promises';
const [command, argument, planId] = process.argv.slice(2);
const base = process.env.CLOUD_OPERATOR_URL, token = process.env.CLOUD_PLATFORM_TOKEN;
if (!base || !token) throw new Error('Set CLOUD_OPERATOR_URL and CLOUD_PLATFORM_TOKEN. Never put the platform token in browser code.');
let path = '/platform/plans', method = 'GET', body;
if (command === 'save' && argument) { method = 'PUT'; body = JSON.parse(await readFile(argument, 'utf8')); }
else if (command === 'assign' && argument && planId) { method = 'PUT'; path = `/platform/organizations/${encodeURIComponent(argument)}/plan`; body = { planId }; }
else if (command !== 'list') throw new Error('Usage: pnpm cloud:plans list | save plan.json | assign ORGANIZATION_ID PLAN_ID');
const response = await fetch(new URL(path, base), { method, redirect: "error", headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
const data = await response.json(); if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
console.log(JSON.stringify(data, null, 2));
