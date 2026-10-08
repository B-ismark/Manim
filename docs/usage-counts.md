# Reading the usage counts

The app counts a small, fixed set of anonymous events (see [analytics-proposal.md](analytics-proposal.md)
for what and why). They land in Cloudflare **Workers Analytics Engine**, dataset
`manim_usage`, kept three months. Nothing to set up: the dataset is created by the
first count after a deploy.

Each row: `blob1` = event, `blob2` / `blob3` = its two details, `double1` = 1.

| event | blob2 | blob3 |
|---|---|---|
| `landing` | phone / desktop | — |
| `new_call` | phone / desktop | — |
| `prejoin` | `new` / `link` | phone / desktop |
| `joined` | `cam_on` / `cam_off` | `low_on` / `low_off` |
| `left` | `lt1` `1-5` `5-15` `15-30` `30-60` `60plus` (minutes) | phone / desktop |
| `knock_rejected` | reason (`host_denied`, `timed_out`, `locked`, `link_expired`, …) | — |
| `permission_denied` | `camera` / `mic` / `both` | phone / desktop |
| `join_error` | `permission` / `network` / `server` / `other` (refusals with a reason are `knock_rejected`) | phone / desktop |
| `rating` | `good` / `bad` ("How was the call?" on the end page) | phone / desktop |
| `rating_issue` | `audio` / `video` / `connection` / `other` (only after `bad`) | phone / desktop |
| `call_rtt` | round trip to the LiveKit edge, ms: `lt100` `100-200` `200-300` `300plus` | edge continent: `af` `eu` `na` `sa` `as` `oc` `other` |
| `call_loss` | incoming packets lost, %: `lt1` `1-3` `3-10` `10plus` | edge continent |
| `call_fps` | frame rate of the video you watched: `lt10` `10-20` `20plus` | phone / desktop |
| `call_limit` | why your camera was held back most of the call: `none` / `cpu` / `bandwidth` / `other` | phone / desktop |

The four `call_*` rows are one summary per person per call, sent when they leave
(`src/lib/callQuality.ts`; calls under ~30s send nothing). They exist to tell the
causes of "the call lags" apart: `call_limit = cpu` with low `call_fps` is the
device (blur, encoder), high `call_rtt` / `call_loss` is the network and distance.
The edge continent is the LiveKit SERVER's region, never where the person is;
`other` means a region name `edgeRegion` doesn't recognise yet.

## Run a query

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → Custom, permission
   **Account · Account Analytics · Read**. Copy it.
2. Your account id is in the dashboard URL (`dash.cloudflare.com/<account id>/…`).
3. In a terminal:

```bash
ACCOUNT_ID=your-account-id
TOKEN=your-token
q() { curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $TOKEN" --data "$1"; }
```

**The join funnel, last 7 days** (people opening an invite link skip the home
page, so `prejoin` can be higher than `landing`; `phone` means a touch screen,
tablets included)

```bash
q "SELECT blob1 AS event, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '7' DAY
     AND blob1 IN ('landing', 'prejoin', 'joined', 'left')
   GROUP BY event ORDER BY n DESC"
```

**Why people didn't get in**

```bash
q "SELECT blob1 AS event, blob2 AS why, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '30' DAY
     AND blob1 IN ('knock_rejected', 'join_error', 'permission_denied')
   GROUP BY event, why ORDER BY n DESC"
```

**How long calls last**

```bash
q "SELECT blob2 AS minutes, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '30' DAY AND blob1 = 'left'
   GROUP BY minutes ORDER BY n DESC"
```

Local and test runs send nothing: counting is on in production builds only.

**Is the lag the device or the network?** (last 14 days)

```bash
q "SELECT blob1 AS event, blob2 AS range, blob3 AS by, SUM(_sample_interval * double1) AS n
   FROM manim_usage
   WHERE timestamp > NOW() - INTERVAL '14' DAY
     AND blob1 IN ('call_rtt', 'call_loss', 'call_fps', 'call_limit')
   GROUP BY event, range, by ORDER BY event, by, range"
```
