const fs = require('fs');
const content = fs.readFileSync('packages/ui/src/context/dialog.tsx', 'utf8');

const updated = content.replace('globalThis.crypto.randomUUID()', `(globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : Math.random().toString(36).slice(2))`);

fs.writeFileSync('packages/ui/src/context/dialog.tsx', updated);
