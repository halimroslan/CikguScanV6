import { execSync } from 'child_process';
execSync('git checkout -- src/main.ts index.html');
console.log('Restored');
