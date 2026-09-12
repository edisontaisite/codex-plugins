#!/usr/bin/env node
// porter —— 一个极小的 MCP server（stdio，行分隔 JSON-RPC，无外部依赖）。
//
// 存在理由：聊天里的文件链接拖不出去，插件也够不着对话渲染层
// （扩展面只有 MCP + skills，跑在 UI 进程外）。所以换一条路——把文件送进剪贴板/打成包，
// 让「拖」这个动作根本不需要发生。

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, basename, join, extname } from 'node:path';
import { createInterface } from 'node:readline';

const HERE = dirname(fileURLToPath(import.meta.url));
const PBCOPY = join(HERE, 'pbcopy-files.js');
const DESKTOP = join(homedir(), 'Desktop');
// zip 默认落在这里而不是桌面：交付包是一次性的中转物，
// 留在桌面就得用户自己删。放暂存区 + 每次运行清理旧的，桌面保持干净。
const STAGE_DIR = join(tmpdir(), 'codex-porter');
const STAGE_TTL_MS = 24 * 60 * 60 * 1000;

// 只清暂存区里自己产的 .zip，且只清超过 TTL 的 —— 不碰用户指定的 dest_dir。
function cleanStage() {
  if (!existsSync(STAGE_DIR)) return 0;
  const now = Date.now();
  let n = 0;
  for (const f of readdirSync(STAGE_DIR)) {
    if (!f.endsWith('.zip')) continue;
    const full = join(STAGE_DIR, f);
    try {
      if (now - statSync(full).mtimeMs > STAGE_TTL_MS) { rmSync(full, { force: true }); n++; }
    } catch {}
  }
  return n;
}

/* ---------- 小工具 ---------- */

function sh(cmd, args) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', rej);
    p.on('close', (code) =>
      code === 0 ? res(out.trim()) : rej(new Error(`${cmd} exited ${code}: ${err.trim() || out.trim()}`))
    );
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 解析入参路径：绝对路径直接用，相对路径按 base 解析。缺一个就报缺一个，
// 不静默跳过 —— 交付时少一个文件就是一次返工。
function resolvePaths(paths, base) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('paths 不能为空');
  const root = base ? resolve(base) : process.cwd();
  const out = paths.map((p) => resolve(root, String(p).replace(/^~(?=$|\/)/, homedir())));
  const missing = out.filter((p) => !existsSync(p));
  if (missing.length) throw new Error(`这些路径不存在：\n${missing.map((m) => '  ' + m).join('\n')}`);
  return out;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function toClipboard(paths) {
  await sh('/usr/bin/osascript', ['-l', 'JavaScript', PBCOPY, ...paths]);
}

async function reveal(paths) {
  await sh('/usr/bin/open', ['-R', ...paths]);
}

// 目标文件名撞车就加后缀，绝不覆盖 —— 交付包被悄悄盖掉是最难查的错。
function freePath(dir, base, ext) {
  let candidate = join(dir, base + ext);
  let n = 2;
  while (existsSync(candidate)) candidate = join(dir, `${base}-${n++}${ext}`);
  return candidate;
}

// 单个目录：直接 ditto --keepParent，包里保留目录名。
// 多个条目：先在临时目录里搭一层，再整体打包，保证解开是一个文件夹而不是一地散件。
async function zipPaths(paths, name, destDir) {
  const dir = destDir ? resolve(destDir) : STAGE_DIR;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const onlyDir = paths.length === 1 && statSync(paths[0]).isDirectory();
  const base = name || (onlyDir ? basename(paths[0]) : `porter-${stamp()}`);
  const zip = freePath(dir, base, '.zip');

  if (onlyDir) {
    await sh('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', paths[0], zip]);
  } else {
    const stage = join(tmpdir(), `porter-${stamp()}-${process.pid}`, base);
    mkdirSync(stage, { recursive: true });
    for (const p of paths) await sh('/bin/cp', ['-R', p, join(stage, basename(p))]);
    await sh('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', stage, zip]);
  }
  return zip;
}

function describe(paths) {
  return paths
    .map((p) => {
      const st = statSync(p);
      return st.isDirectory() ? `  ${basename(p)}/  (目录)` : `  ${basename(p)}  ${humanSize(st.size)}`;
    })
    .join('\n');
}

/* ---------- 工具定义 ---------- */

const PATHS_SCHEMA = {
  type: 'array',
  items: { type: 'string' },
  description: '文件或目录路径。绝对路径最稳；相对路径按 base_dir（默认当前工作目录）解析。',
};

const TOOLS = [
  {
    name: 'porter_zip',
    description:
      '【默认动作】把这些文件打成一个 zip（放在暂存区，不脏桌面）并写进 macOS 剪贴板。' +
      '用户切到目标窗口（微信/邮件/Finder/上传框）按 Cmd+V 就能粘出文件本体。' +
      '需要把一批文件交给别人时优先用这个：一个包，对方少漏文件。',
    inputSchema: {
      type: 'object',
      properties: {
        paths: PATHS_SCHEMA,
        name: { type: 'string', description: 'zip 的文件名（不带 .zip）。省略时：单个目录用目录名，否则用 porter-时间戳。' },
        dest_dir: { type: 'string', description: 'zip 放哪。默认暂存区（$TMPDIR/codex-porter，24 小时后自动清理）。想留存就显式传 ~/Desktop。' },
        base_dir: { type: 'string', description: '相对路径的解析基准目录。' },
        reveal: { type: 'boolean', description: '顺便在 Finder 里选中这个 zip。默认 false。' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'porter_clipboard',
    description:
      '把这些文件**原样**（不打包）写进 macOS 剪贴板，用户 Cmd+V 直接粘出文件本体。' +
      '适合一两个文件、或者对方要的就是散件的时候。',
    inputSchema: {
      type: 'object',
      properties: {
        paths: PATHS_SCHEMA,
        base_dir: { type: 'string', description: '相对路径的解析基准目录。' },
        reveal: { type: 'boolean', description: '顺便在 Finder 里把它们全选中。默认 false。' },
      },
      required: ['paths'],
    },
  },
  {
    name: 'porter_reveal',
    description:
      '在 Finder 里打开并一次性选中这些文件，不碰剪贴板。' +
      '用户明确说「我要自己拖」的时候用——省掉逐层点进文件夹。',
    inputSchema: {
      type: 'object',
      properties: { paths: PATHS_SCHEMA, base_dir: { type: 'string' } },
      required: ['paths'],
    },
  },
];

/* ---------- 工具实现 ---------- */

async function callTool(name, args = {}) {
  const paths = resolvePaths(args.paths, args.base_dir);

  if (name === 'porter_reveal') {
    await reveal(paths);
    return `已在 Finder 中选中 ${paths.length} 项：\n${describe(paths)}\n\n剪贴板没动。直接拖走即可。`;
  }

  if (name === 'porter_clipboard') {
    await toClipboard(paths);
    if (args.reveal) await reveal(paths);
    return (
      `已放进剪贴板（文件本体，不是路径文本），共 ${paths.length} 项：\n${describe(paths)}\n\n` +
      `切到目标窗口按 Cmd+V 即可。` +
      (args.reveal ? '\nFinder 里也已经全选好了。' : '')
    );
  }

  if (name === 'porter_zip') {
    const swept = args.dest_dir ? 0 : cleanStage();
    const zip = await zipPaths(paths, args.name, args.dest_dir);
    await toClipboard([zip]);
    if (args.reveal) await reveal([zip]);
    return (
      `已打包并放进剪贴板：\n  ${zip}\n  ${humanSize(statSync(zip).size)}\n\n` +
      `包含 ${paths.length} 项：\n${describe(paths)}\n\n` +
      `切到目标窗口按 Cmd+V 即可。` +
      (args.dest_dir ? '' : `\n\n（放在暂存区，24 小时后自动清理，不用手动删${swept ? `；本次已清掉 ${swept} 个旧包` : ''}。要留存请传 dest_dir。）`)
    );
  }

  throw new Error(`未知工具：${name}`);
}

/* ---------- MCP stdio 循环 ---------- */

// 剪贴板是进程外的全局单例：两个调用同时写就是互相覆盖，
// 结果取决于谁先跑完 —— 所以工具调用一律排队串行执行。
let queue = Promise.resolve();
let inflight = 0;

function enqueue(fn) {
  inflight++;
  const task = queue.then(fn, fn);
  queue = task.then(() => {}, () => {});
  return task.finally(() => inflight--);
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyErr(id, message) {
  send({ jsonrpc: '2.0', id, error: { code: -32000, message } });
}

const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;

  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }

  // 通知（无 id）不需要回应
  if (msg.id === undefined || msg.id === null) return;

  try {
    switch (msg.method) {
      case 'initialize':
        reply(msg.id, {
          protocolVersion: msg.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'porter', version: '0.1.0' },
        });
        break;

      case 'ping':
        reply(msg.id, {});
        break;

      case 'tools/list':
        reply(msg.id, { tools: TOOLS });
        break;

      case 'tools/call': {
        const text = await enqueue(() => callTool(msg.params?.name, msg.params?.arguments || {}));
        reply(msg.id, { content: [{ type: 'text', text }] });
        break;
      }

      case 'resources/list':
        reply(msg.id, { resources: [] });
        break;

      case 'prompts/list':
        reply(msg.id, { prompts: [] });
        break;

      default:
        replyErr(msg.id, `不支持的方法：${msg.method}`);
    }
  } catch (e) {
    // 失败走 isError，让模型能把原因转述给用户，而不是整个调用炸掉
    if (msg.method === 'tools/call') {
      reply(msg.id, { content: [{ type: 'text', text: `失败：${e.message}` }], isError: true });
    } else {
      replyErr(msg.id, e.message);
    }
  }
});

// stdin 关掉时可能还有 ditto / osascript 在跑。直接 exit 会把它们拦腰砍断，
// 用户看到的是「调了但什么都没发生」。等队列排空再退。
rl.on('close', async () => {
  const deadline = Date.now() + 30_000;
  while (inflight > 0 && Date.now() < deadline) {
    await queue.catch(() => {});
    if (inflight > 0) await new Promise((r) => setTimeout(r, 50));
  }
  // process.exit() 会截断还没写完的 stdout —— 表现是「最后一次调用没回应」。
  // 用回调确保前面的回复都落盘了再退。
  process.stdout.write('', () => process.exit(0));
});
