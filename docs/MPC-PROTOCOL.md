# MPCデバッグ配列の接続

MPC内部表示はKSK独自の`std_msgs/msg/Float32MultiArray`プロトコルです。既存のMPCが同名のトピックを発行していても、配列の順序・版・意味が一致しない限り対応しません。

対応版: `1`。唯一の定義は[mpc_schema.json](../mpc_schema.json)です。送信側は`_version`にこの値を入れ、world座標を使用します。ビューアー側でコース原点を引きます。

- `/rl_raceline/mpc_static`: 起動時の参照経路・回廊・設定。ライブ配信ではTRANSIENT_LOCALのQoSで送信します。
- `/rl_raceline/mpc_debug`: 制御ステップごとの予測、候補、コスト、状態。

配列はヘッダーを以下の順に並べ、その後にスキーマのblocks/sectionsを順に追加します。`xy`はX座標をN個、続いてY座標をN個です。候補のrecordsもヘッダーと付随軌跡を順に連結します。具体的な送信例は[scripts/make-demo.ts](../scripts/make-demo.ts)を参照してください。

型の意味: `i`=整数、`b`=0/1、`f`=実数、`fpos`=負なら未設定、`wx/wy`=world座標、`enum:*`=enumsにある順序の番号。これは大会共通の標準プロトコルではありません。

## static ヘッダー

| offset | name | type |
| --- | --- | --- |
| 0 | `_version` | `i` |
| 1 | `n` | `i` |
| 2 | `total_len` | `f` |
| 3 | `horizon` | `i` |
| 4 | `dt` | `f` |
| 5 | `n_steer` | `i` |
| 6 | `n_steer2` | `i` |
| 7 | `n_off` | `i` |
| 8 | `n_accel` | `i` |
| 9 | `n_accel_v2x` | `i` |
| 10 | `max_steer` | `f` |
| 11 | `wheel_base` | `f` |
| 12 | `safe` | `f` |
| 13 | `safe_pass` | `f` |
| 14 | `w_wall` | `f` |
| 15 | `w_wall_pass` | `f` |
| 16 | `cbf_alpha` | `f` |
| 17 | `cbf_rmin` | `f` |
| 18 | `box_lon` | `f` |
| 19 | `box_lat` | `f` |
| 20 | `clear_w` | `f` |
| 21 | `off_max_m` | `f` |
| 22 | `lon_min` | `f` |
| 23 | `v_max` | `f` |
| 24 | `plan_on` | `b` |
| 25 | `v2x_enable` | `b` |
| 26 | `hard_box` | `b` |
| 27 | `smoothed` | `b` |
| 28 | `w_lat` | `f` |
| 29 | `w_head` | `f` |
| 30 | `w_prog` | `f` |
| 31 | `w_dsteer` | `f` |

後続部分:

```json
[
  {
    "name": "ref_path",
    "kind": "xy",
    "count": "n"
  },
  {
    "name": "off_lo",
    "kind": "scalar",
    "count": "n",
    "round": 3
  },
  {
    "name": "off_hi",
    "kind": "scalar",
    "count": "n",
    "round": 3
  },
  {
    "name": "v_prof",
    "kind": "scalar",
    "count": "n",
    "round": 3
  },
  {
    "name": "s",
    "kind": "scalar",
    "count": "n",
    "round": 3
  }
]
```

## debug ヘッダー

| offset | name | type |
| --- | --- | --- |
| 0 | `_version` | `i` |
| 1 | `horizon` | `i` |
| 2 | `dt` | `f` |
| 3 | `n_cand` | `i` |
| 4 | `n_opp_pred` | `i` |
| 5 | `n_opp_raw` | `i` |
| 6 | `best.steer` | `f` |
| 7 | `best.accel` | `f` |
| 8 | `best.off` | `f` |
| 9 | `best.cost` | `f` |
| 10 | `off_cmd` | `f` |
| 11 | `off_delta` | `f` |
| 12 | `plan_tgt` | `f` |
| 13 | `v_cap` | `fpos` |
| 14 | `acc_cap` | `fpos` |
| 15 | `threat` | `b` |
| 16 | `passing` | `b` |
| 17 | `plan_active` | `b` |
| 18 | `plan_ok` | `b` |
| 19 | `plan_hold` | `b` |
| 20 | `plan_why` | `enum:plan_why` |
| 21 | `side` | `f` |
| 22 | `side_left` | `i` |
| 23 | `follow_hold` | `i` |
| 24 | `launched` | `b` |
| 25 | `pen_hold` | `i` |
| 26 | `clearance` | `f` |
| 27 | `lat` | `f` |
| 28 | `idx` | `i` |
| 29 | `s_ego` | `f` |
| 30 | `speed` | `f` |
| 31 | `steer_actual` | `f` |
| 32 | `steer_prev` | `f` |
| 33 | `cbf_used` | `b` |
| 34 | `step_ms` | `f` |
| 35 | `mode_code` | `i` |
| 36 | `n_safe` | `i` |
| 37 | `lat_slope` | `f` |
| 38 | `plan_keep` | `i` |
| 39 | `pose.x` | `wx` |
| 40 | `pose.y` | `wy` |
| 41 | `pose.yaw` | `f` |
| 42 | `boost_remaining` | `f` |
| 43 | `is_boosting` | `b` |
| 44 | `race_live` | `b` |
| 45 | `lap_time` | `f` |
| 46 | `session_time` | `f` |
| 47 | `rollout_ext` | `b` |

後続部分:

```json
[
  {
    "name": "best_traj",
    "kind": "xy",
    "count": "horizon"
  },
  {
    "name": "ref_points",
    "kind": "xy",
    "count": "horizon"
  },
  {
    "name": "ref_shifted",
    "kind": "xy",
    "count": "horizon"
  },
  {
    "name": "corridor_lo",
    "kind": "scalar",
    "count": "horizon",
    "round": 3
  },
  {
    "name": "corridor_hi",
    "kind": "scalar",
    "count": "horizon",
    "round": 3
  },
  {
    "name": "s_ref",
    "kind": "scalar",
    "count": "horizon",
    "round": 3
  },
  {
    "name": "cands",
    "kind": "records",
    "count": "n_cand",
    "fields": [
      {
        "name": "steer",
        "type": "f",
        "round": 5
      },
      {
        "name": "cost",
        "type": "f",
        "round": 2
      },
      {
        "name": "hit",
        "type": "b"
      }
    ],
    "trailing": {
      "name": "pts",
      "kind": "xy",
      "count": "horizon"
    }
  },
  {
    "name": "opp_pred",
    "kind": "records",
    "count": "n_opp_pred",
    "fields": [
      {
        "name": "w",
        "type": "f",
        "round": 3
      }
    ],
    "trailing": {
      "name": "pts",
      "kind": "xy",
      "count": "horizon"
    }
  },
  {
    "name": "opp",
    "kind": "records",
    "count": "n_opp_raw",
    "fields": [
      {
        "name": "x",
        "type": "wx",
        "round": 3
      },
      {
        "name": "y",
        "type": "wy",
        "round": 3
      },
      {
        "name": "v",
        "type": "f",
        "round": 3
      },
      {
        "name": "s",
        "type": "f",
        "round": 2
      },
      {
        "name": "lat",
        "type": "f",
        "round": 3
      },
      {
        "name": "vlat",
        "type": "f",
        "round": 3
      },
      {
        "name": "gap",
        "type": "f",
        "round": 2
      },
      {
        "name": "nobs",
        "type": "i"
      }
    ]
  }
]
```
