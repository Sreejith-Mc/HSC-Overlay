/**
 * Operator account management.
 *
 *   npm run operator -- list
 *   npm run operator -- add <name>       (prompts for a password, hidden)
 *   npm run operator -- passwd <name>    (change an existing password)
 *   npm run operator -- remove <name>
 *
 * Passwords are read from a hidden prompt and stored as scrypt hashes —
 * they're never echoed, never passed as an argument (which would land in your
 * shell history), and never written in plaintext.
 */

import readline from 'node:readline';
import { loadAuth, saveAuth, findOperator, upsertOperator } from '../server/auth.js';

const [, , cmd, name] = process.argv;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      // Swallow echo while still letting readline see the keystrokes.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
        else process.stdout.write('\x1b[2K\x1b[200D' + question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

async function readPassword() {
  const a = await ask('Password: ', { hidden: true });
  if (a.length < 6) { console.error('\nPassword must be at least 6 characters.'); process.exit(1); }
  const b = await ask('Confirm:  ', { hidden: true });
  if (a !== b) { console.error('\nPasswords did not match.'); process.exit(1); }
  return a;
}

const auth = loadAuth();

switch (cmd) {
  case 'list': {
    if (!auth.operators.length) {
      console.log('\nNo operators yet — the panel is currently OPEN to anyone who can reach it.');
      console.log('Add one with:  npm run operator -- add <name>\n');
    } else {
      console.log(`\n${auth.operators.length} operator(s):`);
      for (const o of auth.operators) console.log(`  · ${o.name}`);
      console.log('');
    }
    break;
  }

  case 'add': {
    if (!name) { console.error('Usage: npm run operator -- add <name>'); process.exit(1); }
    if (findOperator(auth, name)) { console.error(`"${name}" already exists — use "passwd" to change their password.`); process.exit(1); }
    const pw = await readPassword();
    saveAuth(upsertOperator(auth, name, pw));
    console.log(`\nAdded operator "${name}". Sign-in is now required for the panel.`);
    console.log('Restart the server if it is already running.\n');
    break;
  }

  case 'passwd': {
    if (!name || !findOperator(auth, name)) { console.error(`Unknown operator "${name || ''}".`); process.exit(1); }
    const pw = await readPassword();
    saveAuth(upsertOperator(auth, name, pw));
    console.log(`\nPassword updated for "${name}".\n`);
    break;
  }

  case 'remove': {
    const op = findOperator(auth, name);
    if (!op) { console.error(`Unknown operator "${name || ''}".`); process.exit(1); }
    auth.operators = auth.operators.filter((o) => o !== op);
    saveAuth(auth);
    console.log(`\nRemoved "${op.name}".`);
    if (!auth.operators.length) console.log('⚠ No operators left — the panel is OPEN again.\n');
    else console.log('');
    break;
  }

  default:
    console.log(`
HSC Overlay — operator accounts

  npm run operator -- list
  npm run operator -- add <name>
  npm run operator -- passwd <name>
  npm run operator -- remove <name>
`);
}
