## Configuration sweep (plan keyword list)

| config | recall clean | recall SNR10 | recall SNR5 | recall SNR0 | false alarms, core list (neg. set) | latency after keyword end ms (med / p95) | CPU cores @RT | peak RSS MB |
|---|---|---|---|---|---|---|---|---|
| sherpa-zh-en/chunk8-int8/s1.5-t0.25/thr1 | 36.3% | 19.8% | 13.9% | 10.9% | 2 (3.0/h; all keywords 2) | 289 / 438 | 0.126 | 276 |
| sherpa-zh-en/chunk8-int8/s3-t0.15/thr1 | 36.3% | 19.1% | 14.5% | 9.8% | 3 (4.5/h; all keywords 3) | 275 / 428 | 0.124 | 276 |
| sherpa-zh-en/chunk8-int8/s4-t0.08/thr1 | 35.8% | 18.6% | 13.2% | 7.5% | 8 (12.0/h; all keywords 9) | 272 / 413 | 0.108 | 257 |
| sherpa-zh-en/chunk8-int8/s5-t0.04/thr1 | 12.3% | 12.7% | 8.7% | 5.6% | 10 (15.0/h; all keywords 15) | 284 / 413 | 0.108 | 257 |

## Recall at SNR >= 5 dB per keyword and configuration

| keyword | chunk8-int8/s1.5-t0.25/thr1 | chunk8-int8/s3-t0.15/thr1 | chunk8-int8/s4-t0.08/thr1 | chunk8-int8/s5-t0.04/thr1 |
|---|---|---|---|---|
| 停下 | 0.0% | 0.0% | 1.4% | 4.2% |
| 站住 | 30.6% | 33.3% | 27.8% | 16.7% |
| 莫动 | 9.7% | 9.7% | 11.1% | 8.3% |
| 歇倒 | 0.0% | 0.0% | 4.2% | 6.9% |
| Stop | 37.5% | 29.2% | 25.0% | 12.5% |
| Halt | 0.0% | 0.0% | 0.0% | 0.0% |
| 回巢 | 0.0% | 1.4% | 2.8% | 1.4% |
| 回去充电 | 23.6% | 36.1% | 34.7% | 26.4% |
| 回基地 | 23.6% | 27.8% | 23.6% | 13.9% |
| Return to base | 29.2% | 27.8% | 26.4% | 13.9% |
| 跟我走 | 8.3% | 2.8% | 1.4% | 5.6% |
| 跟着我 | 31.9% | 37.5% | 33.3% | 27.8% |
| Follow me | 2.8% | 2.8% | 2.8% | 1.4% |
| 开始巡检 | 47.2% | 38.9% | 31.9% | 25.0% |
| 巡一圈 | 1.4% | 1.4% | 5.6% | 4.2% |
| Start patrol | 36.1% | 34.7% | 34.7% | 12.5% |
| 小铁小铁 | 4.2% | 2.8% | 4.2% | 1.4% |
| 别动 (extra) | 16.7% | 19.4% | 20.8% | 20.8% |
| 马上停下 (extra) | 27.8% | 30.6% | 27.8% | 15.3% |
| 停下来 (extra) | 5.6% | 8.3% | 8.3% | 5.6% |
| 随我走 (extra) | 1.4% | 0.0% | 1.4% | 0.0% |
| 跟着我走 (extra) | 1.4% | 2.8% | 2.8% | 1.4% |
| 开始巡一圈 (extra) | 44.4% | 47.2% | 34.7% | 26.4% |
| 去巡检 (extra) | 25.0% | 31.9% | 30.6% | 18.1% |
| 你好小铁 (extra) | 48.6% | 51.4% | 51.4% | 51.4% |
| false alarms (all keywords) | 2 | 3 | 9 | 15 |

## Per-keyword results - sherpa-zh-en/chunk8-int8/s1.5-t0.25/thr1

| keyword | intent | clips | recall clean | recall 10 dB | recall 5 dB | recall 0 dB | false alarms |
|---|---|---|---|---|---|---|---|
| 停下 | STOP | 120 | 8.3% | 0.0% | 0.0% | 2.8% | 0 |
| 站住 | STOP | 120 | 58.3% | 36.1% | 25.0% | 13.9% | 0 |
| 莫动 | STOP | 120 | 8.3% | 11.1% | 8.3% | 2.8% | 0 |
| 歇倒 | STOP | 120 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| Stop | STOP | 120 | 91.7% | 36.1% | 38.9% | 27.8% | 2 |
| Halt | STOP | 120 | 8.3% | 0.0% | 0.0% | 0.0% | 0 |
| 回巢 | RETURN_HOME | 120 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| 回去充电 | RETURN_HOME | 120 | 41.7% | 22.2% | 25.0% | 25.0% | 0 |
| 回基地 | RETURN_HOME | 120 | 41.7% | 30.6% | 16.7% | 16.7% | 0 |
| Return to base | RETURN_HOME | 120 | 100.0% | 36.1% | 22.2% | 13.9% | 0 |
| 跟我走 | FOLLOW_ME | 120 | 8.3% | 8.3% | 8.3% | 11.1% | 0 |
| 跟着我 | FOLLOW_ME | 120 | 41.7% | 38.9% | 25.0% | 30.6% | 0 |
| Follow me | FOLLOW_ME | 120 | 41.7% | 2.8% | 2.8% | 0.0% | 0 |
| 开始巡检 | START_PATROL | 120 | 75.0% | 61.1% | 33.3% | 25.0% | 0 |
| 巡一圈 | START_PATROL | 120 | 0.0% | 2.8% | 0.0% | 0.0% | 0 |
| Start patrol | START_PATROL | 120 | 83.3% | 44.4% | 27.8% | 11.1% | 0 |
| 小铁小铁 | WAKE | 120 | 8.3% | 5.6% | 2.8% | 5.6% | 0 |
| 别动 (extra) | STOP | 120 | 33.3% | 19.4% | 13.9% | 16.7% | 0 |
| 马上停下 (extra) | STOP | 120 | 25.0% | 33.3% | 22.2% | 13.9% | 0 |
| 停下来 (extra) | STOP | 120 | 8.3% | 8.3% | 2.8% | 8.3% | 0 |
| 随我走 (extra) | FOLLOW_ME | 120 | 16.7% | 0.0% | 2.8% | 0.0% | 0 |
| 跟着我走 (extra) | FOLLOW_ME | 120 | 0.0% | 2.8% | 0.0% | 0.0% | 0 |
| 开始巡一圈 (extra) | START_PATROL | 120 | 41.7% | 52.8% | 36.1% | 25.0% | 0 |
| 去巡检 (extra) | START_PATROL | 120 | 50.0% | 33.3% | 16.7% | 8.3% | 0 |
| 你好小铁 (extra) | WAKE | 120 | 50.0% | 50.0% | 47.2% | 36.1% | 0 |

## Noise type x SNR (recall, plan keyword list)

| noise \ SNR | 10 dB | 5 dB | 0 dB |
|---|---|---|---|
| esc | 22.1% | 12.7% | 14.2% |
| white | 15.2% | 6.9% | 3.4% |
| yard | 22.1% | 22.1% | 15.2% |

## Voice bank (recall, plan keyword list)

| voice bank | clean | 10 dB | 5 dB | 0 dB |
|---|---|---|---|---|
| aishell3 | 21.9% | 14.6% | 8.3% | 9.7% |
| libritts | 65.0% | 23.9% | 18.3% | 10.6% |
| melo | 29.2% | 25.0% | 19.4% | 13.9% |

## Per intent

| intent | role | clips | recall (exact keyword) | recall (any keyword of intent) |
|---|---|---|---|---|
| FOLLOW_ME | core | 360 | 15.8% | 15.8% |
| RETURN_HOME | core | 480 | 20.2% | 20.2% |
| START_PATROL | core | 360 | 25.8% | 25.8% |
| STOP | core | 720 | 13.1% | 15.0% |
| WAKE | wake | 120 | 5.0% | 5.0% |

## Wake-word gating

- observed false alarms: wake words 0, commands 2 in 0.67 h
- measured wake→command pairs within 5 s: **0**
- independent-Poisson model of the gated rate: 0.0000 /h
- hours of keyword-free audio with ZERO events needed to claim <1/h at 95 %: **3.0 h** (this run: 0.67 h)
