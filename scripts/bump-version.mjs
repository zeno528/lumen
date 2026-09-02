import { readFileSync, writeFileSync } from "node:fs";

// 版本号批量递增：真值源 = 根目录 VERSION，一处命令同步全部触点。
// 用法：pnpm version:patch|minor|major（见根 package.json scripts）
const increment = process.argv[2];
if (!new Set(["patch", "minor", "major"]).has(increment)) {
  throw new Error("用法：pnpm version:patch|minor|major");
}

const versionFile = new URL("../VERSION", import.meta.url);
const current = readFileSync(versionFile, "utf8").trim();
const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
if (!match) {
  throw new Error(`VERSION 必须是稳定 SemVer（x.y.z），当前为：${current}`);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (increment === "major") {
  major += 1;
  minor = 0;
  patch = 0;
} else if (increment === "minor") {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const next = `${major}.${minor}.${patch}`;
writeFileSync(versionFile, `${next}\n`);

// 触点 1：web/package.json（仅镜像元数据；界面显示走 vite.config 直读 VERSION）
const pkgFile = new URL("../web/package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
pkg.version = next;
writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`版本号已从 ${current} 更新为 ${next}`);
console.log("下一步：git add + commit，推送后 CI 部署生效");
