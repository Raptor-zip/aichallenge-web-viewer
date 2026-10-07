import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { McapIndexedReader, McapWriter } from '@mcap/core';
import { decompress } from 'fzstd';
import { readBag } from '../src/bag/readBag';
import { demoTrack } from '../src/demo';
import { parseTrack, trackAssets } from '../src/track';
import { decodeDebug, decodeStatic } from '../src/mpc/decode';

let checks = 0;
const check = (label: string, fn: () => unknown) => { fn(); checks++; console.log(`PASS ${label}`); };
const data = new Uint8Array(await readFile('public/demo.mcap'));
const file = new File([data], 'demo.mcap');
const bag = await readBag(file, undefined, trackAssets(demoTrack()));
check('zstd MCAP / CDR / chronological playback', () => {
  assert.equal(bag.duration, 60); assert.equal(bag.frames.length, 1201);
  assert.equal(bag.topics['/localization/kinematic_state'], 601);
  assert(bag.frames.every((f, i) => i === 0 || f.t > bag.frames[i - 1].t));
});
check('world origin matches imported track and MPC', () => {
  assert.equal(bag.frames[0].pose.x, 30); assert.equal(bag.frames[0].pose.y, 0);
  assert(Math.abs(bag.frames[0].pose.yaw_deg - 90) < 1e-8);
  assert.deepEqual(bag.mpcStatic!.ref_path[0], [30, 0]);
  assert(Math.abs(bag.frames[0].mpc!.pose.x - 30) < 1e-3);
});
check('candidate trajectories, speed cap, constrained interval', () => {
  assert.equal(bag.frames[240].mpc!.cands.length, 9);
  assert.equal(bag.frames[240].mpc!.v_cap, 4);
  assert.equal(bag.frames[0].mpc!.v_cap, null);
  assert.equal(bag.frames[540].mpc!.n_safe, 0);
  assert.equal(bag.frames[0].mpc!.best_traj.length, 12);
});
check('missing IMU stays missing rather than zero', () => assert(Number.isNaN(bag.frames[0].accel.actual_mps2)));
const reader = await McapIndexedReader.Initialize({ readable: {
  size: async () => BigInt(data.length), read: async (off, len) => data.subarray(Number(off), Number(off + len)),
}, decompressHandlers: { zstd: (b, n) => decompress(b, new Uint8Array(Number(n))) } });
async function fixture(name: string, start: number, end: number, odomOnly = false, indexed = true) {
  const chunks: Uint8Array[] = []; let length = 0;
  const w = new McapWriter({ useChunks: indexed, useStatistics: indexed, useSummaryOffsets: indexed,
    writable: { write: async (b) => { chunks.push(b.slice()); length += b.length; }, position: () => BigInt(length) } });
  await w.start({ profile: 'ros2', library: 'test' });
  const ids = new Map<number, number>();
  for (const c of reader.channelsById.values()) {
    if (odomOnly && c.topic !== '/localization/kinematic_state') continue;
    const s = reader.schemasById.get(c.schemaId)!;
    const schemaId = await w.registerSchema(s);
    ids.set(c.id, await w.registerChannel({ ...c, schemaId }));
  }
  const base = 1_700_000_000_000_000_000n;
  for await (const m of reader.readMessages()) {
    const t = Number(m.logTime - base) / 1e9;
    if (t < start || t > end || !ids.has(m.channelId)) continue;
    await w.addMessage({ ...m, channelId: ids.get(m.channelId)! });
  }
  await w.end(); return new File(chunks, name);
}
const plain = await readBag(await fixture('odom-stream.mcap', 0, 3, true, false));
check('unindexed stream, odometry alone, no invented signals', () => {
  assert.equal(plain.duration, 3); assert.equal(plain.hasMpc, false);
  assert.equal(plain.frames[0].pose.x, 0); assert.equal(plain.frames[0].pose.y, 0);
  assert(Math.abs(plain.frames[0].pose.yaw_deg - 90) < 1e-8);
  assert(Number.isNaN(plain.frames[0].steer.cmd_deg));
  assert(Number.isNaN(plain.frames[0].session.session_time));
});
const split = await readBag([await fixture('second.mcap', 30.1, 60), await fixture('first.mcap', 0, 30)], undefined, trackAssets(demoTrack()));
check('split recordings selected in reverse order', () => {
  assert.equal(split.duration, 60); assert.equal(split.topics['/localization/kinematic_state'], 601);
  assert.deepEqual(split.frames[600].pose, bag.frames[600].pose);
});
await assert.rejects(readBag(new File(['broken'], 'invalid.mcap')), /MCAP形式/); checks++; console.log('PASS invalid file is rejected');
await assert.rejects(readBag(await fixture('empty.mcap', 99, 100)), /トピック|メッセージ|自己位置/); checks++; console.log('PASS empty recording is rejected');
check('track validation rejects missing or non-finite origin', () => {
  assert.throws(() => parseTrack({ raceline: [] }), /origin/);
  assert.throws(() => parseTrack({ origin: [NaN, 0] }), /origin/);
  assert.throws(() => parseTrack({ origin: [0, 0], walls: [[0, Infinity]] }), /walls/);
});
check('unknown MPC version is never silently decoded', () => {
  assert.equal(decodeDebug([999, ...Array(100).fill(0)], [0, 0]), null);
  assert.equal(decodeStatic([999, ...Array(100).fill(0)], [0, 0]), null);
});
console.log(`${checks} checks passed`);
