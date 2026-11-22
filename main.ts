// Tiny stack VM for make.fun's tiny-stack-vm-01 ISA (kit: ISA.md).
// One run answers every instance under /input/<id>/, writing
// /output/<id>/stdout.bin and /output/<id>/exit.txt for each.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const IN_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

function run(prog: Buffer, input: Buffer): [Buffer, number] {
  const mem = new Int32Array(256);
  const stack = new Int32Array(256);
  const calls = new Int32Array(64);
  const out: number[] = [];
  let sp = 0, cp = 0, pc = 0, steps = 0, ip = 0;
  const done = (code: number): [Buffer, number] => [Buffer.from(out), code];

  while (true) {
    if (steps >= 1000000) return done(10);
    if (pc < 0 || pc >= prog.length) return done(9);
    const op = prog[pc];
    steps++;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: { // PUSH8, sign-extended byte
        if (pc + 1 >= prog.length) return done(9);
        if (sp >= 256) return done(3);
        stack[sp++] = (prog[pc + 1] << 24) >> 24;
        pc += 2; break;
      }
      case 0x02: { // PUSH32
        if (pc + 4 >= prog.length) return done(9);
        if (sp >= 256) return done(3);
        stack[sp++] = prog[pc + 1] | (prog[pc + 2] << 8) | (prog[pc + 3] << 16) | (prog[pc + 4] << 24);
        pc += 5; break;
      }
      case 0x03:
        if (sp < 1) return done(2);
        sp--; pc++; break;
      case 0x04:
        if (sp < 1) return done(2);
        if (sp >= 256) return done(3);
        stack[sp] = stack[sp - 1]; sp++; pc++; break;
      case 0x05: {
        if (sp < 2) return done(2);
        const t = stack[sp - 1]; stack[sp - 1] = stack[sp - 2]; stack[sp - 2] = t;
        pc++; break;
      }
      case 0x06:
        if (sp < 2) return done(2);
        if (sp >= 256) return done(3);
        stack[sp] = stack[sp - 2]; sp++; pc++; break;
      case 0x07: {
        if (sp < 3) return done(2);
        const a = stack[sp - 3];
        stack[sp - 3] = stack[sp - 2]; stack[sp - 2] = stack[sp - 1]; stack[sp - 1] = a;
        pc++; break;
      }
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: { // binary ops, b is on top
        if (sp < 2) return done(2);
        const b = stack[--sp];
        const a = stack[sp - 1];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) { if (b === 0) return done(4); r = (a / b) | 0; }
        else if (op === 0x14) { if (b === 0) return done(4); r = (a % b) | 0; }
        else if (op === 0x15) { if (b === 0) return done(4); r = Math.trunc((a >>> 0) / (b >>> 0)) | 0; }
        else if (op === 0x16) { if (b === 0) return done(4); r = ((a >>> 0) % (b >>> 0)) | 0; }
        else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << b;
        else if (op === 0x1d) r = a >> b;
        else if (op === 0x1e) r = (a >>> b) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        stack[sp - 1] = r;
        pc++; break;
      }
      case 0x17:
        if (sp < 1) return done(2);
        stack[sp - 1] = (-stack[sp - 1]) | 0;
        pc++; break;
      case 0x1b:
        if (sp < 1) return done(2);
        stack[sp - 1] = ~stack[sp - 1];
        pc++; break;
      case 0x30: case 0x31: case 0x32: {
        if (pc + 2 >= prog.length) return done(9);
        let off = prog[pc + 1] | (prog[pc + 2] << 8);
        if (off >= 32768) off -= 65536;
        if (op === 0x30) { pc = pc + 3 + off; break; }
        if (sp < 1) return done(2);
        const v = stack[--sp];
        if ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) pc = pc + 3 + off;
        else pc += 3;
        break;
      }
      case 0x33: {
        if (pc + 2 >= prog.length) return done(9);
        if (cp >= 64) return done(7);
        calls[cp++] = pc + 3;
        pc = prog[pc + 1] | (prog[pc + 2] << 8);
        break;
      }
      case 0x34:
        if (cp === 0) return done(8);
        pc = calls[--cp]; break;
      case 0x40: {
        if (sp < 1) return done(2);
        const addr = stack[sp - 1];
        if (addr < 0 || addr > 255) return done(6);
        stack[sp - 1] = mem[addr];
        pc++; break;
      }
      case 0x41: { // STORE, addr is on top
        if (sp < 2) return done(2);
        const addr = stack[--sp];
        const v = stack[--sp];
        if (addr < 0 || addr > 255) return done(6);
        mem[addr] = v;
        pc++; break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const s = String(stack[--sp]);
        if (out.length + s.length > 65536) return done(11);
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
        pc++; break;
      }
      case 0x51: {
        if (sp < 1) return done(2);
        if (out.length + 1 > 65536) return done(11);
        out.push(stack[--sp] & 255);
        pc++; break;
      }
      case 0x52:
        if (sp >= 256) return done(3);
        stack[sp++] = ip < input.length ? input[ip++] : -1;
        pc++; break;
      case 0x53:
        if (sp < 1) return done(2);
        return done(stack[--sp] & 255);
      default:
        return done(5);
    }
  }
}

for (const id of readdirSync(IN_DIR).sort()) {
  const dir = join(IN_DIR, id);
  if (!existsSync(join(dir, 'program.bin'))) continue; // a stray file must not kill the whole run
  const prog = readFileSync(join(dir, 'program.bin'));
  const input = existsSync(join(dir, 'input.bin')) ? readFileSync(join(dir, 'input.bin')) : Buffer.alloc(0);
  const [stdout, code] = run(prog, input);
  mkdirSync(join(OUT_DIR, id), { recursive: true });
  writeFileSync(join(OUT_DIR, id, 'stdout.bin'), stdout);
  writeFileSync(join(OUT_DIR, id, 'exit.txt'), String(code) + '\n');
}
