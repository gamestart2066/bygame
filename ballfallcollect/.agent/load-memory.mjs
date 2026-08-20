#!/usr/bin/env node
/**
 * 项目记忆加载器
 *
 * 用途：一条命令输出全部项目记忆，供 AI 会话启动时快速加载，
 *      避免逐个读取多个文件。
 *
 * 用法：
 *   node .agent/load-memory.mjs          输出全部记忆（完整）
 *   node .agent/load-memory.mjs --brief  只输出关键状态摘要
 *   node .agent/load-memory.mjs --list   只列出记忆文件与更新时间
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/** 记忆文件按加载优先级排序 */
const MEMORY_FILES = [
    { path: 'AGENT.md',              label: '开发规则（入口）', core: true },
    { path: '.agent/GAME_DESIGN.md', label: '游戏设计',        core: true },
    { path: '.agent/PROGRESS.md',    label: '开发进度',        core: true },
    { path: '.agent/TECH_NOTES.md',  label: '技术决策与踩坑',  core: false },
    { path: '.agent/TODO.md',        label: '待办事项',        core: false },
];

const args = process.argv.slice(2);
const mode = args.includes('--brief') ? 'brief'
           : args.includes('--list')  ? 'list'
           : 'full';

const out = [];
const w = (s = '') => out.push(s);

w('='.repeat(64));
w('  PROJECT MEMORY / 项目记忆  —  ballfallcollect (Cocos Creator 3.8.6)');
w(`  加载时间: ${new Date().toLocaleString('zh-CN')}`);
w(`  模式: ${mode}`);
w('='.repeat(64));
w();

if (mode === 'list') {
    for (const f of MEMORY_FILES) {
        const abs = join(ROOT, f.path);
        if (!existsSync(abs)) {
            w(`  [缺失] ${f.path}`);
            continue;
        }
        const st = statSync(abs);
        const mtime = st.mtime.toLocaleString('zh-CN');
        w(`  [${f.core ? '核心' : '按需'}] ${f.path.padEnd(24)} ${String(st.size).padStart(6)} B   ${mtime}`);
    }
    w();
    w('  完整加载: node .agent/load-memory.mjs');
    console.log(out.join('\n'));
    process.exit(0);
}

if (mode === 'brief') {
    // 摘要模式：抽取每个文件中的关键状态行
    const KEY_PATTERNS = [
        /^\*\*当前阶段\*\*/,
        /^\*\*设计确定度\*\*/,
        /^\*\*最后更新\*\*/,
    ];
    for (const f of MEMORY_FILES) {
        const abs = join(ROOT, f.path);
        if (!existsSync(abs)) continue;
        const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
        const hits = lines.filter((l) => KEY_PATTERNS.some((p) => p.test(l.trim())));
        if (hits.length) {
            w(`## ${f.path}`);
            hits.forEach((h) => w(`   ${h.trim()}`));
            w();
        }
    }
    // 抽取未完成的 P0 待办
    const todoAbs = join(ROOT, '.agent/TODO.md');
    if (existsSync(todoAbs)) {
        const todo = readFileSync(todoAbs, 'utf8').split(/\r?\n/);
        const p0 = [];
        let inP0 = false;
        for (const line of todo) {
            if (/^##\s+P0/.test(line)) { inP0 = true; continue; }
            if (/^##\s/.test(line) && inP0) break;
            if (inP0 && /^\s*-\s*\[ \]/.test(line)) p0.push(line.trim());
        }
        if (p0.length) {
            w('## 未完成的 P0 阻塞项');
            p0.forEach((t) => w(`   ${t}`));
            w();
        }
    }
    w('  完整加载: node .agent/load-memory.mjs');
    console.log(out.join('\n'));
    process.exit(0);
}

// full 模式
let missing = 0;
for (const f of MEMORY_FILES) {
    const abs = join(ROOT, f.path);
    w('');
    w('─'.repeat(64));
    w(`### ${f.path}  —  ${f.label}`);
    w('─'.repeat(64));
    if (!existsSync(abs)) {
        w('  ⚠️ 文件缺失，请检查项目记忆是否完整。');
        missing++;
        continue;
    }
    w(readFileSync(abs, 'utf8').trimEnd());
}

w();
w('='.repeat(64));
w(missing === 0
    ? '  ✅ 项目记忆加载完毕。开始开发前请遵守 AGENT.md 中的红线条款。'
    : `  ⚠️ 有 ${missing} 个记忆文件缺失。`);
w('='.repeat(64));

console.log(out.join('\n'));
