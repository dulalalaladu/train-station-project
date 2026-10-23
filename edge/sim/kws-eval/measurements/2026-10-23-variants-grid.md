## Configuration sweep (plan keyword list)

| config | recall clean | recall SNR10 | recall SNR5 | recall SNR0 | false alarms, core list (neg. set) | latency after keyword end ms (med / p95) | CPU cores @RT | peak RSS MB |
|---|---|---|---|---|---|---|---|---|
| sherpa-zh-en/chunk8-int8/s3-t0.15/thr1 | 36.3% | 19.1% | 14.5% | 9.8% | 3 (4.5/h; all keywords 3) | 275 / 428 | 0.126 | 275 |
| sherpa-zh-en/chunk16-int8/s3-t0.15/thr1 | 37.3% | 21.2% | 15.5% | 11.1% | 5 (7.5/h; all keywords 5) | 299 / 504 | 0.087 | 279 |
| sherpa-zh-en/chunk8-fp32/s3-t0.15/thr1 | 40.2% | 21.9% | 17.6% | 12.3% | 3 (4.5/h; all keywords 3) | 282 / 434 | 0.120 | 261 |

## Recall at SNR >= 5 dB per keyword and configuration

| keyword | chunk8-int8/s3-t0.15/thr1 | chunk16-int8/s3-t0.15/thr1 | chunk8-fp32/s3-t0.15/thr1 |
|---|---|---|---|
| 停下 | 0.0% | 1.4% | 4.2% |
| 站住 | 33.3% | 36.1% | 30.6% |
| 莫动 | 9.7% | 12.5% | 8.3% |
| 歇倒 | 0.0% | 0.0% | 0.0% |
| Stop | 29.2% | 11.1% | 34.7% |
| Halt | 0.0% | 0.0% | 0.0% |
| 回巢 | 1.4% | 6.9% | 4.2% |
| 回去充电 | 36.1% | 40.3% | 40.3% |
| 回基地 | 27.8% | 33.3% | 41.7% |
| Return to base | 27.8% | 34.7% | 27.8% |
| 跟我走 | 2.8% | 6.9% | 9.7% |
| 跟着我 | 37.5% | 40.3% | 37.5% |
| Follow me | 2.8% | 2.8% | 2.8% |
| 开始巡检 | 38.9% | 44.4% | 55.6% |
| 巡一圈 | 1.4% | 1.4% | 1.4% |
| Start patrol | 34.7% | 36.1% | 30.6% |
| 小铁小铁 | 2.8% | 4.2% | 6.9% |
| 别动 (extra) | 19.4% | 26.4% | 23.6% |
| 马上停下 (extra) | 30.6% | 36.1% | 25.0% |
| 停下来 (extra) | 8.3% | 12.5% | 12.5% |
| 随我走 (extra) | 0.0% | 1.4% | 2.8% |
| 跟着我走 (extra) | 2.8% | 0.0% | 4.2% |
| 开始巡一圈 (extra) | 47.2% | 52.8% | 56.9% |
| 去巡检 (extra) | 31.9% | 36.1% | 34.7% |
| 你好小铁 (extra) | 51.4% | 52.8% | 51.4% |
| false alarms (all keywords) | 3 | 5 | 3 |

## Per-keyword results - sherpa-zh-en/chunk8-fp32/s3-t0.15/thr1

| keyword | intent | clips | recall clean | recall 10 dB | recall 5 dB | recall 0 dB | false alarms |
|---|---|---|---|---|---|---|---|
| 停下 | STOP | 120 | 16.7% | 2.8% | 5.6% | 2.8% | 0 |
| 站住 | STOP | 120 | 50.0% | 30.6% | 30.6% | 22.2% | 1 |
| 莫动 | STOP | 120 | 8.3% | 11.1% | 5.6% | 2.8% | 0 |
| 歇倒 | STOP | 120 | 0.0% | 0.0% | 0.0% | 0.0% | 0 |
| Stop | STOP | 120 | 91.7% | 33.3% | 36.1% | 22.2% | 2 |
| Halt | STOP | 120 | 16.7% | 0.0% | 0.0% | 0.0% | 0 |
| 回巢 | RETURN_HOME | 120 | 8.3% | 2.8% | 5.6% | 2.8% | 0 |
| 回去充电 | RETURN_HOME | 120 | 75.0% | 38.9% | 41.7% | 22.2% | 0 |
| 回基地 | RETURN_HOME | 120 | 58.3% | 47.2% | 36.1% | 19.4% | 0 |
| Return to base | RETURN_HOME | 120 | 100.0% | 36.1% | 19.4% | 13.9% | 0 |
| 跟我走 | FOLLOW_ME | 120 | 16.7% | 8.3% | 11.1% | 8.3% | 0 |
| 跟着我 | FOLLOW_ME | 120 | 50.0% | 41.7% | 33.3% | 36.1% | 0 |
| Follow me | FOLLOW_ME | 120 | 50.0% | 2.8% | 2.8% | 0.0% | 0 |
| 开始巡检 | START_PATROL | 120 | 66.7% | 63.9% | 47.2% | 38.9% | 0 |
| 巡一圈 | START_PATROL | 120 | 0.0% | 2.8% | 0.0% | 0.0% | 0 |
| Start patrol | START_PATROL | 120 | 75.0% | 38.9% | 22.2% | 16.7% | 0 |
| 小铁小铁 | WAKE | 120 | 0.0% | 11.1% | 2.8% | 0.0% | 0 |
| 别动 (extra) | STOP | 120 | 16.7% | 27.8% | 19.4% | 19.4% | 0 |
| 马上停下 (extra) | STOP | 120 | 33.3% | 27.8% | 22.2% | 13.9% | 0 |
| 停下来 (extra) | STOP | 120 | 25.0% | 11.1% | 13.9% | 13.9% | 0 |
| 随我走 (extra) | FOLLOW_ME | 120 | 25.0% | 5.6% | 0.0% | 2.8% | 0 |
| 跟着我走 (extra) | FOLLOW_ME | 120 | 0.0% | 0.0% | 8.3% | 0.0% | 0 |
| 开始巡一圈 (extra) | START_PATROL | 120 | 66.7% | 63.9% | 50.0% | 25.0% | 0 |
| 去巡检 (extra) | START_PATROL | 120 | 50.0% | 41.7% | 27.8% | 16.7% | 0 |
| 你好小铁 (extra) | WAKE | 120 | 58.3% | 52.8% | 50.0% | 30.6% | 0 |

## Noise type x SNR (recall, plan keyword list)

| noise \ SNR | 10 dB | 5 dB | 0 dB |
|---|---|---|---|
| esc | 23.5% | 14.7% | 13.2% |
| white | 17.2% | 11.8% | 5.4% |
| yard | 25.0% | 26.5% | 18.1% |

## Voice bank (recall, plan keyword list)

| voice bank | clean | 10 dB | 5 dB | 0 dB |
|---|---|---|---|---|
| aishell3 | 26.0% | 19.4% | 14.2% | 9.7% |
| libritts | 66.7% | 22.2% | 16.1% | 10.6% |
| melo | 35.4% | 26.4% | 26.4% | 19.4% |

## Per intent

| intent | role | clips | recall (exact keyword) | recall (any keyword of intent) |
|---|---|---|---|---|
| FOLLOW_ME | core | 360 | 18.3% | 18.3% |
| RETURN_HOME | core | 480 | 27.5% | 27.5% |
| START_PATROL | core | 360 | 27.8% | 27.8% |
| STOP | core | 720 | 13.3% | 16.4% |
| WAKE | wake | 120 | 4.2% | 6.7% |

## Wake-word gating

- observed false alarms: wake words 0, commands 3 in 0.67 h
- measured wake→command pairs within 5 s: **0**
- independent-Poisson model of the gated rate: 0.0000 /h
- hours of keyword-free audio with ZERO events needed to claim <1/h at 95 %: **3.0 h** (this run: 0.67 h)
