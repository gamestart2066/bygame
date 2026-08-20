#!/usr/bin/env node
/**
 * TypeScript 代码静态自检（无需引擎类型声明即可运行）。
 *
 * 检查项：
 *   1. 括号平衡（{} () []），排除注释与字符串
 *   2. 代码区全角标点 —— 这是致命语法错误的常见来源
 *      （中文输入法下误打出 `（` `）` `，` 等）
 *   3. 可疑的 TODO / FIXME 统计
 *
 * 用法：node .agent/check-code.mjs [目录，默认 assets/scripts]
 *
 * 注意：本脚本**不能替代 TypeScript 类型检查**。
 * 本项目 temp/declarations/cc.d.ts 是占位文件，真实类型校验必须在
 * Cocos Creator 编辑器中编译，以编辑器报错为准。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const ROOT = process.argv[2] ?? 'assets/scripts';
const BACKTICK = String.fromCharCode(96);
const SINGLE = String.fromCharCode(39);

/** 代码区一旦出现这些全角字符，几乎必然是语法错误 */
const FULLWIDTH = '（）［］｛｝＝＋＊＜＞＂＇，；：！？';

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

/**
 * 逐字符扫描，剥离注释与字符串后返回「纯代码字符 + 行号」序列。
 */
function stripToCode(src) {
    const chars = [];
    let i = 0;
    let line = 1;
    // 0=代码 1=单引号 2=双引号 3=模板串 4=行注释 5=块注释
    let state = 0;

    while (i < src.length) {
        const ch = src[i];
        const next = src[i + 1];

        if (ch === '\n') {
            line++;
            i++;
            if (state === 4) state = 0;
            continue;
        }

        if (state === 0) {
            if (ch === '/' && next === '/') { state = 4; i += 2; continue; }
            if (ch === '/' && next === '*') { state = 5; i += 2; continue; }
            if (ch === SINGLE) { state = 1; i++; continue; }
            if (ch === '"') { state = 2; i++; continue; }
            if (ch === BACKTICK) { state = 3; i++; continue; }
            chars.push({ ch, line });
            i++;
            continue;
        }

        if (state === 4) { i++; continue; }

        if (state === 5) {
            if (ch === '*' && next === '/') { state = 0; i += 2; continue; }
            i++;
            continue;
        }

        // 字符串内部：处理转义
        if (ch === '\\') { i += 2; continue; }
        if (state === 1 && ch === SINGLE) state = 0;
        else if (state === 2 && ch === '"') state = 0;
        else if (state === 3 && ch === BACKTICK) state = 0;
        i++;
    }
    return chars;
}

let errorCount = 0;
let fileCount = 0;
const files = walk(ROOT);

for (const file of files) {
    fileCount++;
    const src = readFileSync(file, 'utf8');
    const code = stripToCode(src);
    const name = basename(file);
    const problems = [];

    // --- 1. 括号平衡 ---
    const stack = [];
    const pairs = { ')': '(', ']': '[', '}': '{' };
    for (const { ch, line } of code) {
        if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
        else if (ch in pairs) {
            const top = stack.pop();
            if (!top || top.ch !== pairs[ch]) {
                problems.push(`第 ${line} 行括号不匹配：遇到 '${ch}'`);
                break;
            }
        }
    }
    if (stack.length > 0) {
        problems.push(`有 ${stack.length} 个括号未闭合，最早在第 ${stack[0].line} 行 '${stack[0].ch}'`);
    }

    // --- 2. 代码区全角标点 ---
    for (const { ch, line } of code) {
        if (FULLWIDTH.includes(ch)) {
            problems.push(`第 ${line} 行出现全角字符 '${ch}'（代码区，会导致语法错误）`);
        }
    }

    // --- 3. TODO 统计（仅提示） ---
    const todos = (src.match(/TODO|FIXME/g) ?? []).length;

    if (problems.length > 0) {
        errorCount += problems.length;
        console.log(`\n[FAIL] ${name}`);
        for (const p of problems) console.log('   - ' + p);
    } else {
        console.log(`[ok]   ${name}${todos > 0 ? `  (TODO x${todos})` : ''}`);
    }
}

console.log('\n' + '='.repeat(56));
console.log(`扫描 ${fileCount} 个文件，发现 ${errorCount} 个问题。`);
console.log(errorCount === 0
    ? '✅ 静态自检通过（注意：类型检查仍需在 Cocos 编辑器中确认）'
    : '❌ 请修复上述问题');
console.log('='.repeat(56));

process.exit(errorCount === 0 ? 0 : 1);
