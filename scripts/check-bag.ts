/**
 * rosbag(.mcap)の読み込みをブラウザ抜きで確かめる。
 *
 * 画面で確かめようとすると 20MB 超のファイルをドラッグする手作業が要り、
 * 「MCAPが読めない」のか「CDRのデコードがずれている」のか「表示が悪い」のかを
 * 切り分けられない。ここは **readBag() の出口だけ** を見る。
 *
 *   npx vite-node scripts/check-bag.ts <path/to/rosbag.mcap>
 *
 * vite 経由で走らせるのは、`@mpc-schema`(= ../mpc_schema.json)のエイリアスを
 * アプリとまったく同じ解決で通すため。
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { readBag } from "../src/bag/readBag";

function fail(msg: string): never {
  console.error(`NG: ${msg}`);
  process.exit(1);
}

const path = process.argv[2];
if (!path) fail("bag のパスを指定してください");

const buf = await readFile(path);
const file = new File([buf], basename(path));
console.log(`${basename(path)}  ${(buf.byteLength / 1e6).toFixed(1)} MB`);

let lastPhase = "";
const bag = await readBag(file, (frac, phase) => {
  if (phase !== lastPhase) {
    lastPhase = phase;
    process.stdout.write(`  ${phase}...\n`);
  }
  void frac;
});

console.log(`\n全長 ${bag.duration.toFixed(1)}s / ${bag.frames.length} フレーム (dt=${bag.dt}s)`);
console.log("トピック:");
for (const [t, n] of Object.entries(bag.topics).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(7)}  ${t}`);
}
console.log(`MPCの中身: ${bag.hasMpc ? "あり" : "なし"}`);
console.log(`mpc_static: ${bag.mpcStatic ? `${bag.mpcStatic.n} 点の参照経路` : "なし"}`);

if (bag.frames.length === 0) fail("フレームが0本");

// 自己位置が動いていること(全フレーム同じなら Odometry のデコードが壊れている)
const xs = bag.frames.map((f) => f.pose.x);
const span = Math.max(...xs) - Math.min(...xs);
console.log(`\n自車x の振れ幅 ${span.toFixed(1)} m`);
if (span < 1) fail("自己位置が動いていない。Odometry のデコードを疑う");

const mid = bag.frames[Math.floor(bag.frames.length / 2)];
console.log(
  `中央フレーム t=${mid.t.toFixed(1)}s  pose=(${mid.pose.x.toFixed(1)}, ${mid.pose.y.toFixed(1)})` +
    ` yaw=${mid.pose.yaw_deg.toFixed(1)}°  v=${mid.speed_mps.toFixed(2)} m/s` +
    `  舵cmd=${mid.steer.cmd_deg.toFixed(1)}°  accel=${mid.accel.cmd_mps2.toFixed(2)}` +
    `  相手=${mid.v2x.length}台`,
);

const withCmd = bag.frames.filter((f) => f.steer.cmd_deg !== 0).length;
console.log(`舵指令が0でないフレーム: ${withCmd}/${bag.frames.length}`);
if (withCmd === 0) fail("制御指令が全フレーム0。AckermannControlCommand のデコードを疑う");

const withOpp = bag.frames.filter((f) => f.v2x.length > 0).length;
console.log(`相手が見えているフレーム: ${withOpp}/${bag.frames.length}`);

if (bag.hasMpc) {
  const m = bag.frames.find((f) => f.mpc)!.mpc!;
  console.log(
    `MPC: 候補${m.n_cand}本 / 安全${m.n_safe} / cost ${m.best.cost} / ` +
      `予測${m.best_traj.length}点 / mode ${m.mode}`,
  );
}
console.log("\nOK");
